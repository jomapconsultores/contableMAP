import forge from "node-forge";
import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";

/**
 * Certificado de firma electrónica: lectura del archivo .p12 y custodia de su
 * contraseña.
 *
 * La contraseña se guarda cifrada con AES-256-GCM bajo `SRI_CERT_SECRET`, que
 * vive solo en el servidor. Ni la base de datos ni una copia de seguridad
 * bastan para firmar en nombre del contribuyente: hace falta también esa
 * variable de entorno.
 */

export class ErrorCertificado extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ErrorCertificado";
  }
}

function claveMaestra(): Buffer {
  const secreto = process.env.SRI_CERT_SECRET;
  if (!secreto || secreto.length < 16) {
    throw new ErrorCertificado(
      "Falta SRI_CERT_SECRET (mínimo 16 caracteres). Sin ella no se puede guardar ni usar el certificado.",
    );
  }
  return createHash("sha256").update(secreto).digest();
}

/** Devuelve `iv.tag.datos`, todo en base64. */
export function cifrar(texto: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", claveMaestra(), iv);
  const datos = Buffer.concat([cipher.update(texto, "utf8"), cipher.final()]);
  return [iv.toString("base64"), cipher.getAuthTag().toString("base64"), datos.toString("base64")].join(".");
}

export function descifrar(paquete: string): string {
  const partes = paquete.split(".");
  if (partes.length !== 3) throw new ErrorCertificado("La contraseña guardada está corrupta.");
  const [iv, tag, datos] = partes.map((p) => Buffer.from(p, "base64"));
  const decipher = createDecipheriv("aes-256-gcm", claveMaestra(), iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(datos), decipher.final()]).toString("utf8");
  } catch {
    throw new ErrorCertificado(
      "No se pudo descifrar la contraseña del certificado. ¿Cambió SRI_CERT_SECRET?",
    );
  }
}

export interface Certificado {
  /** Clave privada en PEM, para firmar. */
  clavePrivadaPem: string;
  /** Certificado del firmante en DER. */
  certificadoDer: Buffer;
  /** El mismo, en base64: es lo que va en `<ds:X509Certificate>`. */
  certificadoBase64: string;
  modulusBase64: string;
  exponentBase64: string;
  /** Emisor en formato RFC 2253, como lo escribe Java. El SRI lo compara. */
  emisorRfc2253: string;
  /** Número de serie en decimal. */
  serie: string;
  sujeto: string;
  desde: Date;
  hasta: Date;
}

/** Nombre corto del atributo, o su OID si no lo conocemos. */
function nombreAtributo(attr: forge.pki.CertificateField): string {
  return attr.shortName ?? attr.name ?? attr.type ?? "";
}

/** Escapado de valores de un nombre distinguido según RFC 2253. */
function escaparRfc2253(valor: string): string {
  let v = valor.replace(/([\\,+"<>;=])/g, "\\$1");
  if (v.startsWith("#") || v.startsWith(" ")) v = "\\" + v;
  if (v.endsWith(" ")) v = v.slice(0, -1) + "\\ ";
  return v;
}

/**
 * `X509IssuerName` tal como lo genera `X500Principal.getName()` en Java: los
 * atributos en orden inverso al del DER y separados por coma. El validador del
 * SRI compara esta cadena carácter a carácter con la del certificado, así que
 * el orden importa.
 */
function emisorRfc2253(cert: forge.pki.Certificate): string {
  return cert.issuer.attributes
    .map((a) => `${nombreAtributo(a)}=${escaparRfc2253(String(a.value ?? ""))}`)
    .reverse()
    .join(",");
}

/** Entero positivo en hexadecimal → decimal, sin perder precisión. */
function hexADecimal(hex: string): string {
  const limpio = hex.replace(/^0+/, "") || "0";
  return BigInt("0x" + limpio).toString(10);
}

/** BigInteger de forge → base64 big-endian sin signo, como pide XMLDSig. */
function enteroABase64(entero: forge.jsbn.BigInteger): string {
  let hex = entero.toString(16);
  if (hex.length % 2 === 1) hex = "0" + hex;
  return Buffer.from(hex, "hex").toString("base64");
}

/**
 * Abre el .p12 y devuelve la clave privada junto con el certificado que le
 * corresponde. Un .p12 suele traer también la cadena de la entidad
 * certificadora: se firma con el del titular, no con los intermedios.
 */
export function leerP12(p12: Buffer, password: string): Certificado {
  let bolsas: forge.pkcs12.Pkcs12Pfx;
  try {
    const asn1 = forge.asn1.fromDer(forge.util.createBuffer(p12.toString("binary")));
    bolsas = forge.pkcs12.pkcs12FromAsn1(asn1, password);
  } catch (e) {
    const detalle = e instanceof Error ? e.message : "";
    if (/mac|invalid password|Invalid password/i.test(detalle)) {
      throw new ErrorCertificado("La contraseña del certificado no es correcta.");
    }
    throw new ErrorCertificado(`No se pudo leer el archivo .p12: ${detalle}`);
  }

  const clavesCifradas = bolsas.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
  const clavesPlanas = bolsas.getBags({ bagType: forge.pki.oids.keyBag });
  const bolsaClave =
    (clavesCifradas[forge.pki.oids.pkcs8ShroudedKeyBag] ?? [])[0] ??
    (clavesPlanas[forge.pki.oids.keyBag] ?? [])[0];

  const clave = bolsaClave?.key as forge.pki.rsa.PrivateKey | undefined;
  if (!clave) throw new ErrorCertificado("El archivo no contiene ninguna clave privada.");

  const certBags = bolsas.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? [];
  const certificados = certBags.map((b) => b.cert).filter(Boolean) as forge.pki.Certificate[];
  if (certificados.length === 0) {
    throw new ErrorCertificado("El archivo no contiene ningún certificado.");
  }

  // El certificado del titular es aquel cuya clave pública casa con la privada.
  const cert =
    certificados.find((c) => {
      const pub = c.publicKey as forge.pki.rsa.PublicKey;
      return pub?.n?.toString(16) === clave.n.toString(16);
    }) ?? certificados[0];

  const ahora = new Date();
  if (cert.validity.notAfter < ahora) {
    throw new ErrorCertificado(
      `El certificado caducó el ${cert.validity.notAfter.toLocaleDateString("es-EC")}. El SRI no autorizará comprobantes firmados con él.`,
    );
  }

  const der = Buffer.from(
    forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes(),
    "binary",
  );

  const sujeto = cert.subject.attributes
    .map((a) => `${nombreAtributo(a)}=${String(a.value ?? "")}`)
    .reverse()
    .join(",");

  return {
    clavePrivadaPem: forge.pki.privateKeyToPem(clave),
    certificadoDer: der,
    certificadoBase64: der.toString("base64"),
    modulusBase64: enteroABase64(clave.n),
    exponentBase64: enteroABase64(clave.e),
    emisorRfc2253: emisorRfc2253(cert),
    serie: hexADecimal(cert.serialNumber),
    sujeto,
    desde: cert.validity.notBefore,
    hasta: cert.validity.notAfter,
  };
}
