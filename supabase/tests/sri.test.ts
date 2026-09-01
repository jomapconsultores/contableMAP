/**
 * Pruebas de la emisión electrónica sin tocar el SRI ni la base de datos.
 *
 * Se genera un certificado autofirmado al vuelo, se emite una factura, se
 * firma y se verifica la firma con las mismas reglas con las que la verifica
 * el SRI: recalcular los tres resúmenes sobre la forma canónica y comprobar
 * la firma RSA del bloque SignedInfo. Si algo del generador de XML o del
 * firmador se rompe, aquí se ve antes de gastar un secuencial.
 *
 *   node --test supabase/tests/sri.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createHash, createVerify } from "node:crypto";
import forge from "node-forge";

import { claveAcceso, digitoVerificador, claveAccesoValida } from "../../src/lib/sri/clave-acceso";
import { generarXmlFactura, calcularTotales, type DatosFactura } from "../../src/lib/sri/xml";
import { firmarXml } from "../../src/lib/sri/firma";
import { leerP12, cifrar, descifrar } from "../../src/lib/sri/certificado";
import { codigoBarras128 } from "../../src/lib/sri/codigo-barras";
import { generarRide } from "../../src/lib/sri/ride";

process.env.SRI_CERT_SECRET ??= "secreto-de-pruebas-suficientemente-largo";

/** Certificado autofirmado en un .p12, como el que entrega una certificadora. */
function certificadoDePrueba(password = "clave123"): Buffer {
  const par = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = par.publicKey;
  cert.serialNumber = "0A1B2C3D";
  cert.validity.notBefore = new Date(Date.now() - 86400000);
  cert.validity.notAfter = new Date(Date.now() + 86400000 * 365);

  const sujeto = [
    { shortName: "CN", value: "MARCO ANTONIO POSLIGUA" },
    { shortName: "OU", value: "ENTIDAD DE CERTIFICACION" },
    { shortName: "O", value: "SECURITY DATA" },
    { shortName: "C", value: "EC" },
  ];
  cert.setSubject(sujeto);
  cert.setIssuer(sujeto);
  cert.sign(par.privateKey, forge.md.sha256.create());

  const p12 = forge.pkcs12.toPkcs12Asn1(par.privateKey, [cert], password, {
    algorithm: "3des",
  });
  return Buffer.from(forge.asn1.toDer(p12).getBytes(), "binary");
}

const DATOS: DatosFactura = {
  ambiente: 1,
  tipoEmision: 1,
  razonSocial: "POSLIGUA & ASOCIADOS",
  nombreComercial: "ContableMAP",
  ruc: "1790012345001",
  claveAcceso: "0".repeat(49),
  establecimiento: "001",
  puntoEmision: "001",
  secuencial: "000000123",
  dirMatriz: "Av. Amazonas N34-56 y República",
  fechaEmision: new Date(2026, 7, 21),
  obligadoContabilidad: false,
  tipoIdComprador: "04",
  razonSocialComprador: "CLIENTE DE PRUEBA S.A.",
  identificacionComprador: "1791234567001",
  items: [
    {
      codigoPrincipal: "SERV-01",
      descripcion: "Asesoría contable & tributaria <mensual>",
      cantidad: 1,
      precioUnitario: 100,
      descuento: 0,
      tarifa: "15",
    },
    {
      codigoPrincipal: "SERV-02",
      descripcion: "Servicio exento",
      cantidad: 2,
      precioUnitario: 25,
      descuento: 10,
      tarifa: "0",
    },
  ],
  pagos: [{ formaPago: "20", total: 155 }],
};

test("el dígito verificador cumple la definición del módulo 11", () => {
  // La comprobación es la propia definición: ponderando de derecha a izquierda
  // con 2..7 en ciclo, la suma más el verificador tiene que ser múltiplo de 11.
  // Los dos casos que no pueden serlo son los que el SRI resuelve por decreto:
  // resto 0 → dígito 0 y resto 1 → dígito 1, porque 10 no es un dígito.
  const ponderada = (cadena: string) => {
    let suma = 0;
    let peso = 2;
    for (let i = cadena.length - 1; i >= 0; i -= 1) {
      suma += Number(cadena[i]) * peso;
      peso = peso === 7 ? 2 : peso + 1;
    }
    return suma;
  };

  let vistoResto0 = false;
  let vistoResto1 = false;

  for (let s = 1; s <= 400; s += 1) {
    const cuerpo =
      "2108202601" + "1790012345001" + "1" + "001001" + String(s).padStart(9, "0") + "123456781";
    assert.equal(cuerpo.length, 48);

    const dv = digitoVerificador(cuerpo);
    assert.ok(dv >= 0 && dv <= 9);

    const resto = ponderada(cuerpo) % 11;
    if (resto === 0) {
      assert.equal(dv, 0);
      vistoResto0 = true;
    } else if (resto === 1) {
      assert.equal(dv, 1);
      vistoResto1 = true;
    } else {
      assert.equal((ponderada(cuerpo) + dv) % 11, 0);
    }
  }

  assert.ok(vistoResto0 && vistoResto1, "las 400 claves deberían cubrir los dos casos especiales");
  assert.throws(() => digitoVerificador("12345X"), /solo admite dígitos/);
});

test("la clave de acceso tiene 49 dígitos y se autovalida", () => {
  const clave = claveAcceso({
    fecha: new Date(2026, 7, 21),
    tipoComprobante: "01",
    ruc: "1790012345001",
    ambiente: 1,
    establecimiento: "001",
    puntoEmision: "001",
    secuencial: 123,
    codigoNumerico: "12345678",
  });
  assert.equal(clave.length, 49);
  assert.ok(claveAccesoValida(clave));
  // ddmmaaaa · tipo · RUC · ambiente · serie · secuencial · código · emisión · dv
  assert.equal(clave.slice(0, 8), "21082026");
  assert.equal(clave.slice(8, 10), "01");
  assert.equal(clave.slice(10, 23), "1790012345001");
  assert.equal(clave.slice(23, 24), "1");
  assert.equal(clave.slice(24, 30), "001001");
  assert.equal(clave.slice(30, 39), "000000123");
  assert.equal(clave.slice(39, 47), "12345678");
  assert.equal(clave.slice(47, 48), "1");
});

test("los totales se redondean por línea y agrupan por tarifa", () => {
  const t = calcularTotales(DATOS);
  assert.equal(t.totalSinImpuestos, 140); // 100 + (50 - 10)
  assert.equal(t.totalDescuento, 10);
  assert.equal(t.totalIva, 15);
  assert.equal(t.importeTotal, 155);
  assert.deepEqual(
    t.porTarifa.map((g) => [g.codigoPorcentaje, g.base, g.valor]),
    [
      ["0", 40, 0],
      ["4", 100, 15],
    ],
  );
});

test("el XML sale en una sola línea y con el texto escapado", () => {
  const { xml } = generarXmlFactura(DATOS);
  assert.ok(!xml.includes("\n"), "el XML no puede llevar saltos de línea");
  assert.ok(xml.startsWith('<factura id="comprobante" version="2.1.0">'));
  assert.ok(xml.includes("Asesoría contable &amp; tributaria &lt;mensual&gt;"));
  assert.ok(xml.includes("<obligadoContabilidad>NO</obligadoContabilidad>"));
  assert.ok(!/<\w+\/>/.test(xml), "C14N no admite elementos vacíos autocerrados");
  // La propina es opcional en 2.1.0 y el SRI devolvía el comprobante cuando
  // iba en cero: se omite salvo que exista de verdad.
  assert.ok(!xml.includes("<propina>"), "sin propina no debe aparecer el elemento");
  const conPropina = generarXmlFactura({
    ...DATOS,
    propina: 5,
    pagos: [{ formaPago: "20", total: 160 }],
  }).xml;
  assert.ok(conPropina.includes("<propina>5.00</propina>"), "con propina sí debe aparecer");
});

test("las formas de pago tienen que cuadrar con el total", () => {
  assert.throws(
    () => generarXmlFactura({ ...DATOS, pagos: [{ formaPago: "20", total: 100 }] }),
    /formas de pago suman/,
  );
});

test("la contraseña del certificado va y vuelve del cifrado", () => {
  const paquete = cifrar("clave123");
  assert.notEqual(paquete, "clave123");
  assert.equal(descifrar(paquete), "clave123");
});

test("la firma XAdES-BES resiste la verificación del validador", () => {
  const cert = leerP12(certificadoDePrueba(), "clave123");
  const { xml } = generarXmlFactura(DATOS);
  const firmado = firmarXml(xml, cert);

  const cuerpo = firmado.replace(/^<\?xml[^>]*\?>/, "");
  const sinFirma = cuerpo.replace(/<ds:Signature[\s\S]*<\/ds:Signature>/, "");
  const sha1 = (s: string) => createHash("sha1").update(Buffer.from(s, "utf8")).digest("base64");

  const leer = (etiqueta: string, texto: string) =>
    texto.match(new RegExp(`<${etiqueta}[^>]*>([\\s\\S]*?)</${etiqueta}>`))?.[1] ?? "";

  // 1 · el comprobante sin la firma, que es lo que dice el transform enveloped
  const referencias = [...cuerpo.matchAll(/<ds:Reference[^>]*>[\s\S]*?<\/ds:Reference>/g)].map(
    (m) => m[0],
  );
  const refComprobante = referencias.find((r) => r.includes('URI="#comprobante"')) as string;
  assert.equal(leer("ds:DigestValue", refComprobante), sha1(sinFirma));

  // 2 · KeyInfo, con el xmlns:ds que hereda de ds:Signature
  const keyInfo = cuerpo.match(/<ds:KeyInfo[\s\S]*?<\/ds:KeyInfo>/)?.[0] as string;
  const keyInfoC14n = keyInfo.replace(
    "<ds:KeyInfo ",
    '<ds:KeyInfo xmlns:ds="http://www.w3.org/2000/09/xmldsig#" ',
  );
  const refCert = referencias.find(
    (r) => r.includes('URI="#Certificate') && !r.includes("SignedProperties"),
  ) as string;
  assert.equal(leer("ds:DigestValue", refCert), sha1(keyInfoC14n));

  // 3 · SignedProperties, con ds y etsi en scope
  const signedProps = cuerpo.match(/<etsi:SignedProperties[\s\S]*?<\/etsi:SignedProperties>/)?.[0] as string;
  const signedPropsC14n = signedProps.replace(
    "<etsi:SignedProperties ",
    '<etsi:SignedProperties xmlns:ds="http://www.w3.org/2000/09/xmldsig#" xmlns:etsi="http://uri.etsi.org/01903/v1.3.2#" ',
  );
  const refProps = referencias.find((r) => r.includes("#SignedProperties")) as string;
  assert.equal(leer("ds:DigestValue", refProps), sha1(signedPropsC14n));

  // 4 · la firma RSA-SHA1 sobre SignedInfo
  const signedInfo = cuerpo.match(/<ds:SignedInfo[\s\S]*?<\/ds:SignedInfo>/)?.[0] as string;
  const signedInfoC14n = signedInfo.replace(
    "<ds:SignedInfo ",
    '<ds:SignedInfo xmlns:ds="http://www.w3.org/2000/09/xmldsig#" ',
  );
  const valor = leer("ds:SignatureValue", cuerpo);
  const pem = forge.pki.certificateToPem(
    forge.pki.certificateFromAsn1(
      forge.asn1.fromDer(forge.util.createBuffer(cert.certificadoDer.toString("binary"))),
    ),
  );

  const verificador = createVerify("RSA-SHA1");
  verificador.update(Buffer.from(signedInfoC14n, "utf8"));
  assert.ok(verificador.verify(pem, Buffer.from(valor, "base64")), "la firma no verifica");

  // El certificado firmante viaja dentro del comprobante
  assert.ok(cuerpo.includes(cert.certificadoBase64));
  assert.ok(cuerpo.includes("<etsi:SigningTime>"));
});

test("no se firma un comprobante sin el id que exige la referencia", () => {
  const cert = leerP12(certificadoDePrueba(), "clave123");
  assert.throws(() => firmarXml("<factura version=\"1.1.0\"></factura>", cert), /id="comprobante"/);
});

test("el código de barras es un Code 128 con su dígito de control", () => {
  const clave = "2108202601179001234500110010010000001231234567819";
  const svg = codigoBarras128(clave);

  assert.ok(svg.startsWith("<svg"));
  assert.ok(svg.includes(`aria-label="Clave de acceso ${clave}"`));

  // 49 dígitos = 24 pares en conjunto C + cambio a B + 1 dígito, más el
  // arranque, el control y la parada.
  const barras = (svg.match(/<rect/g) ?? []).length - 1; // menos el fondo
  assert.equal(barras, (1 + 24 + 2 + 1) * 3 + 4);

  assert.throws(() => codigoBarras128("no-son-digitos"), /solo admite dígitos/);
});

test("el RIDE avisa cuando la factura todavía no está autorizada", () => {
  const base = {
    emisor: {
      razonSocial: "POSLIGUA & ASOCIADOS",
      ruc: "1790012345001",
      dirMatriz: "Av. Amazonas",
      obligadoContabilidad: false,
    },
    cliente: { razonSocial: "CLIENTE S.A.", identificacion: "1791234567001" },
    items: [
      {
        codigoPrincipal: "SERV-01",
        descripcion: "Asesoría",
        cantidad: 1,
        precioUnitario: 100,
        descuento: 0,
        base: 100,
      },
    ],
    totales: {
      porTarifa: [{ etiqueta: "15 %", base: 100 }],
      totalSinImpuestos: 100,
      totalDescuento: 0,
      iva: 15,
      propina: 0,
      importeTotal: 115,
    },
    pagos: [{ formaPago: "20", total: 115 }],
  };

  const clave = "2108202601179001234500110010010000001231234567819";

  const pendiente = generarRide({
    ...base,
    comprobante: {
      numero: "001-001-000000123",
      claveAcceso: clave,
      ambiente: 1,
      tipoEmision: 1,
      fechaEmision: "21/08/2026",
      estado: "RECIBIDA",
    },
  });

  assert.ok(pendiente.includes("todavía sin autorización del SRI"));
  assert.ok(pendiente.includes("AMBIENTE DE PRUEBAS"));
  assert.ok(pendiente.includes(clave));

  const autorizada = generarRide({
    ...base,
    comprobante: {
      numero: "001-001-000000123",
      claveAcceso: clave,
      ambiente: 2,
      tipoEmision: 1,
      fechaEmision: "21/08/2026",
      estado: "AUTORIZADA",
      autorizacion: clave,
      fechaAutorizacion: "21/08/2026 10:15",
    },
  });

  assert.ok(autorizada.includes("AUTORIZADO por el SRI"));
  assert.ok(!autorizada.includes("AMBIENTE DE PRUEBAS"));
  // El total con dos decimales, como manda el comprobante
  assert.ok(autorizada.includes("$ 115.00"));
});
