import { createHash, createSign } from "node:crypto";
import type { Certificado } from "./certificado";

/**
 * Firma XAdES-BES sobre el comprobante, tal como la valida el SRI.
 *
 * Por qué se construye con cadenas y no con un DOM: la firma se calcula sobre
 * la forma canónica (C14N inclusivo) de tres fragmentos, y el validador del
 * SRI recanonicaliza y compara resumen a resumen. Un DOM que reordene
 * atributos, reindente o cierre un elemento vacío como `<x/>` cambia el
 * resumen y el comprobante vuelve con "FIRMA INVALIDA". Aquí cada fragmento
 * se escribe ya en forma canónica y se firma ese texto exacto.
 *
 * Las tres referencias firmadas son:
 *   1. `#comprobante`  · el XML entero, menos la propia firma (enveloped)
 *   2. `#Certificate…` · el bloque KeyInfo con el certificado del firmante
 *   3. `#…SignedProperties` · hora de firma y huella del certificado (XAdES)
 */

const NS_DS = "http://www.w3.org/2000/09/xmldsig#";
const NS_ETSI = "http://uri.etsi.org/01903/v1.3.2#";
const ALG_C14N = "http://www.w3.org/TR/2001/REC-xml-c14n-20010315";
const ALG_RSA_SHA1 = "http://www.w3.org/2000/09/xmldsig#rsa-sha1";
const ALG_SHA1 = "http://www.w3.org/2000/09/xmldsig#sha1";
const ALG_ENVELOPED = "http://www.w3.org/2000/09/xmldsig#enveloped-signature";

export class ErrorFirma extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ErrorFirma";
  }
}

/** Resumen SHA-1 en base64. Se recibe siempre el texto ya codificado en UTF-8. */
const sha1Base64 = (datos: Buffer) => createHash("sha1").update(datos).digest("base64");

/** Identificadores con la misma pinta que los del firmador del SRI. */
const id = () => String(Math.floor(Math.random() * 900000) + 100000);

const dos = (v: number) => String(v).padStart(2, "0");

/**
 * Hora de firma en la zona de Ecuador (UTC-5, sin horario de verano). El
 * servidor puede estar en UTC; el comprobante no.
 */
export function horaEcuador(fecha: Date): string {
  const local = new Date(fecha.getTime() - 5 * 60 * 60 * 1000);
  return (
    `${local.getUTCFullYear()}-${dos(local.getUTCMonth() + 1)}-${dos(local.getUTCDate())}` +
    `T${dos(local.getUTCHours())}:${dos(local.getUTCMinutes())}:${dos(local.getUTCSeconds())}-05:00`
  );
}

/** Declaraciones de espacio de nombres, en el orden que impone C14N. */
const nsDs = ` xmlns:ds="${NS_DS}"`;
const nsDsEtsi = ` xmlns:ds="${NS_DS}" xmlns:etsi="${NS_ETSI}"`;

export interface OpcionesFirma {
  fecha?: Date;
  /** Descripción del objeto firmado; el SRI no la valida, pero debe existir. */
  descripcion?: string;
}

/**
 * Devuelve el comprobante con `<ds:Signature>` insertada antes de su etiqueta
 * de cierre. El XML de entrada debe venir sin indentación y con el elemento
 * raíz marcado `id="comprobante"`.
 */
export function firmarXml(
  xmlComprobante: string,
  cert: Certificado,
  opciones: OpcionesFirma = {},
): string {
  // Fuera la marca de orden de bytes y el prólogo: C14N no los incluye, así
  // que tampoco pueden entrar en lo que se resume.
  const cuerpo = xmlComprobante
    .replace(/^﻿/, "")
    .replace(/^<\?xml[^>]*\?>/, "")
    .trim();

  if (!/\sid="comprobante"/.test(cuerpo)) {
    throw new ErrorFirma('El comprobante debe llevar el atributo id="comprobante" en su raíz.');
  }
  const cierre = cuerpo.lastIndexOf("</");
  if (cierre < 0) throw new ErrorFirma("El comprobante no es un XML válido.");
  const etiquetaCierre = cuerpo.slice(cierre);

  const idFirma = id();
  const idCert = id();
  const idSignedProps = id();
  const idReferencia = id();
  const idObjeto = id();
  const idSignedInfo = id();
  const idSignatureValue = id();
  const idRefSignedProps = id();

  const nombreFirma = `Signature${idFirma}`;
  const nombreCert = `Certificate${idCert}`;
  const nombreSignedProps = `${nombreFirma}-SignedProperties${idSignedProps}`;
  const nombreReferencia = `Reference-ID-${idReferencia}`;

  // --- Referencia 1: el comprobante entero, sin la firma ------------------
  const digestComprobante = sha1Base64(Buffer.from(cuerpo, "utf8"));

  // --- Referencia 2: KeyInfo ---------------------------------------------
  // El contenido es idéntico dentro del documento y en su forma canónica; lo
  // único que cambia es que la canónica lleva explícito el `xmlns:ds` que en
  // el documento hereda de `<ds:Signature>`.
  const keyInfoInterior =
    `<ds:X509Data><ds:X509Certificate>${cert.certificadoBase64}</ds:X509Certificate></ds:X509Data>` +
    `<ds:KeyValue><ds:RSAKeyValue>` +
    `<ds:Modulus>${cert.modulusBase64}</ds:Modulus>` +
    `<ds:Exponent>${cert.exponentBase64}</ds:Exponent>` +
    `</ds:RSAKeyValue></ds:KeyValue>`;

  const keyInfo = `<ds:KeyInfo Id="${nombreCert}">${keyInfoInterior}</ds:KeyInfo>`;
  const keyInfoC14n = `<ds:KeyInfo${nsDs} Id="${nombreCert}">${keyInfoInterior}</ds:KeyInfo>`;
  const digestCertificado = sha1Base64(Buffer.from(keyInfoC14n, "utf8"));

  // --- Referencia 3: propiedades firmadas (XAdES) -------------------------
  const huellaCertificado = sha1Base64(cert.certificadoDer);
  const signedPropsInterior =
    `<etsi:SignedSignatureProperties>` +
    `<etsi:SigningTime>${horaEcuador(opciones.fecha ?? new Date())}</etsi:SigningTime>` +
    `<etsi:SigningCertificate><etsi:Cert>` +
    `<etsi:CertDigest>` +
    `<ds:DigestMethod Algorithm="${ALG_SHA1}"></ds:DigestMethod>` +
    `<ds:DigestValue>${huellaCertificado}</ds:DigestValue>` +
    `</etsi:CertDigest>` +
    `<etsi:IssuerSerial>` +
    `<ds:X509IssuerName>${cert.emisorRfc2253}</ds:X509IssuerName>` +
    `<ds:X509SerialNumber>${cert.serie}</ds:X509SerialNumber>` +
    `</etsi:IssuerSerial>` +
    `</etsi:Cert></etsi:SigningCertificate>` +
    `</etsi:SignedSignatureProperties>` +
    `<etsi:SignedDataObjectProperties>` +
    `<etsi:DataObjectFormat ObjectReference="#${nombreReferencia}">` +
    `<etsi:Description>${opciones.descripcion ?? "contenido comprobante"}</etsi:Description>` +
    `<etsi:MimeType>text/xml</etsi:MimeType>` +
    `</etsi:DataObjectFormat>` +
    `</etsi:SignedDataObjectProperties>`;

  const signedProps = `<etsi:SignedProperties Id="${nombreSignedProps}">${signedPropsInterior}</etsi:SignedProperties>`;
  // Aquí sí hay dos espacios de nombres en juego: `ds`, heredado de
  // `<ds:Signature>`, y `etsi`, declarado en `<etsi:QualifyingProperties>`.
  // C14N los emite ordenados por prefijo.
  const signedPropsC14n = `<etsi:SignedProperties${nsDsEtsi} Id="${nombreSignedProps}">${signedPropsInterior}</etsi:SignedProperties>`;
  const digestSignedProps = sha1Base64(Buffer.from(signedPropsC14n, "utf8"));

  // --- SignedInfo y firma -------------------------------------------------
  const signedInfoInterior =
    `<ds:CanonicalizationMethod Algorithm="${ALG_C14N}"></ds:CanonicalizationMethod>` +
    `<ds:SignatureMethod Algorithm="${ALG_RSA_SHA1}"></ds:SignatureMethod>` +
    `<ds:Reference Id="${idRefSignedProps}" Type="http://uri.etsi.org/01903#SignedProperties" URI="#${nombreSignedProps}">` +
    `<ds:DigestMethod Algorithm="${ALG_SHA1}"></ds:DigestMethod>` +
    `<ds:DigestValue>${digestSignedProps}</ds:DigestValue>` +
    `</ds:Reference>` +
    `<ds:Reference URI="#${nombreCert}">` +
    `<ds:DigestMethod Algorithm="${ALG_SHA1}"></ds:DigestMethod>` +
    `<ds:DigestValue>${digestCertificado}</ds:DigestValue>` +
    `</ds:Reference>` +
    `<ds:Reference Id="${nombreReferencia}" URI="#comprobante">` +
    `<ds:Transforms>` +
    `<ds:Transform Algorithm="${ALG_ENVELOPED}"></ds:Transform>` +
    `</ds:Transforms>` +
    `<ds:DigestMethod Algorithm="${ALG_SHA1}"></ds:DigestMethod>` +
    `<ds:DigestValue>${digestComprobante}</ds:DigestValue>` +
    `</ds:Reference>`;

  const signedInfo = `<ds:SignedInfo Id="Signature-SignedInfo${idSignedInfo}">${signedInfoInterior}</ds:SignedInfo>`;
  const signedInfoC14n = `<ds:SignedInfo${nsDs} Id="Signature-SignedInfo${idSignedInfo}">${signedInfoInterior}</ds:SignedInfo>`;

  let valorFirma: string;
  try {
    const firmador = createSign("RSA-SHA1");
    firmador.update(Buffer.from(signedInfoC14n, "utf8"));
    valorFirma = firmador.sign(cert.clavePrivadaPem, "base64");
  } catch (e) {
    throw new ErrorFirma(
      `No se pudo firmar con la clave del certificado: ${e instanceof Error ? e.message : e}`,
    );
  }

  const firma =
    `<ds:Signature${nsDs} Id="${nombreFirma}">` +
    signedInfo +
    `<ds:SignatureValue Id="SignatureValue${idSignatureValue}">${valorFirma}</ds:SignatureValue>` +
    keyInfo +
    `<ds:Object Id="${nombreFirma}-Object${idObjeto}">` +
    `<etsi:QualifyingProperties xmlns:etsi="${NS_ETSI}" Target="#${nombreFirma}">` +
    signedProps +
    `</etsi:QualifyingProperties>` +
    `</ds:Object>` +
    `</ds:Signature>`;

  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    cuerpo.slice(0, cierre) +
    firma +
    etiquetaCierre
  );
}
