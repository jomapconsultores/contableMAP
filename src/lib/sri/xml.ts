import {
  CODIGO_IVA,
  IMPUESTO_IVA,
  PORCENTAJE_IVA,
  TIPO_ID_COMPRADOR,
  TIPO_COMPROBANTE,
} from "./catalogos";

/**
 * XML de la factura, esquema `factura_V2.1.0` — el que el SRI autoriza hoy
 * para este emisor. Con 1.1.0 la recepción devolvía el comprobante.
 *
 * Se emite en una sola línea, sin indentación ni comentarios y con los
 * atributos en orden alfabético. No es por ahorrar bytes: así el texto que
 * generamos coincide con su propia forma canónica (C14N) y el resumen que
 * firmamos es exactamente el que el SRI recalcula al validar. Cualquier
 * "embellecido" posterior invalida la firma.
 */

export class ErrorXml extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ErrorXml";
  }
}

/** Los caracteres de control no son XML válido; solo sobreviven tab y salto. */
function sinControl(valor: string): string {
  let salida = "";
  for (const c of valor) {
    const n = c.codePointAt(0) ?? 0;
    if (n >= 32 || n === 9 || n === 10 || n === 13) salida += c;
  }
  return salida;
}

/** Escapa texto y descarta los caracteres de control que el XSD rechaza. */
export function escapar(valor: string | number | null | undefined): string {
  if (valor === null || valor === undefined) return "";
  return sinControl(String(valor))
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Elemento con contenido. C14N no admite `<x/>`: siempre par de etiquetas. */
const el = (nombre: string, valor: string | number) => `<${nombre}>${valor}</${nombre}>`;

/** Elemento opcional: se omite si no hay valor, en vez de ir vacío. */
const opt = (nombre: string, valor: string | null | undefined) =>
  valor === null || valor === undefined || String(valor).trim() === ""
    ? ""
    : el(nombre, escapar(valor));

const txt = (nombre: string, valor: string | number) => el(nombre, escapar(valor));

/** Importes monetarios: siempre dos decimales. */
export const n2 = (v: number) => (Math.round((v + Number.EPSILON) * 100) / 100).toFixed(2);
/** Cantidades y precios unitarios: hasta seis decimales. */
export const n6 = (v: number) => (Math.round((v + Number.EPSILON) * 1e6) / 1e6).toFixed(6);

export interface ItemFactura {
  codigoPrincipal: string;
  codigoAuxiliar?: string | null;
  descripcion: string;
  cantidad: number;
  precioUnitario: number;
  descuento: number;
  /** "0" | "5" | "8" | "15" | "NO_OBJETO" | "EXENTO" */
  tarifa: string;
}

export interface PagoFactura {
  formaPago: string;
  total: number;
  plazo?: number | null;
  unidadTiempo?: string | null;
}

export interface DatosFactura {
  ambiente: number;
  tipoEmision: number;
  razonSocial: string;
  nombreComercial?: string | null;
  ruc: string;
  claveAcceso: string;
  establecimiento: string;
  puntoEmision: string;
  secuencial: string;
  dirMatriz: string;
  contribuyenteRimpe?: string | null;
  agenteRetencion?: string | null;
  /** Fecha de emisión. En el XML va como dd/mm/aaaa. */
  fechaEmision: Date;
  dirEstablecimiento?: string | null;
  contribuyenteEspecial?: string | null;
  obligadoContabilidad: boolean;
  tipoIdComprador: string;
  razonSocialComprador: string;
  identificacionComprador: string;
  direccionComprador?: string | null;
  propina?: number;
  moneda?: string;
  items: ItemFactura[];
  pagos: PagoFactura[];
  infoAdicional?: { nombre: string; valor: string }[];
}

/** Línea con sus importes ya resueltos. */
export interface ItemCalculado extends ItemFactura {
  base: number;
  iva: number;
  porcentaje: number;
  codigoPorcentaje: string;
}

export interface TotalesFactura {
  items: ItemCalculado[];
  totalSinImpuestos: number;
  totalDescuento: number;
  /** Una entrada por tarifa presente en el detalle. */
  porTarifa: { tarifa: string; codigoPorcentaje: string; porcentaje: number; base: number; valor: number }[];
  totalIva: number;
  propina: number;
  importeTotal: number;
}

/**
 * Resuelve base e IVA de cada línea y los agrupa por tarifa.
 *
 * El redondeo se hace en la línea y los totales se suman ya redondeados: es
 * el criterio del SRI, y sumar antes de redondear produce diferencias de un
 * centavo que devuelven el comprobante.
 */
export function calcularTotales(datos: {
  items: ItemFactura[];
  propina?: number;
}): TotalesFactura {
  if (datos.items.length === 0) throw new ErrorXml("La factura no tiene ninguna línea de detalle.");

  const items: ItemCalculado[] = datos.items.map((it) => {
    const codigoPorcentaje = CODIGO_IVA[it.tarifa];
    if (!codigoPorcentaje) throw new ErrorXml(`Tarifa de IVA desconocida: "${it.tarifa}".`);

    const porcentaje = PORCENTAJE_IVA[it.tarifa];
    const bruto = Number(n2(it.cantidad * it.precioUnitario));
    const base = Number(n2(bruto - it.descuento));
    if (base < 0) {
      throw new ErrorXml(`El descuento de "${it.descripcion}" supera el importe de la línea.`);
    }
    return { ...it, base, iva: Number(n2((base * porcentaje) / 100)), porcentaje, codigoPorcentaje };
  });

  const totalSinImpuestos = Number(n2(items.reduce((s, i) => s + i.base, 0)));
  const totalDescuento = Number(n2(items.reduce((s, i) => s + i.descuento, 0)));

  const grupos = new Map<string, { tarifa: string; codigoPorcentaje: string; porcentaje: number; base: number; valor: number }>();
  for (const i of items) {
    const g = grupos.get(i.tarifa) ?? {
      tarifa: i.tarifa,
      codigoPorcentaje: i.codigoPorcentaje,
      porcentaje: i.porcentaje,
      base: 0,
      valor: 0,
    };
    g.base = Number(n2(g.base + i.base));
    g.valor = Number(n2(g.valor + i.iva));
    grupos.set(i.tarifa, g);
  }

  const porTarifa = [...grupos.values()].sort((a, b) => a.codigoPorcentaje.localeCompare(b.codigoPorcentaje));
  const totalIva = Number(n2(porTarifa.reduce((s, g) => s + g.valor, 0)));
  const propina = Number(n2(datos.propina ?? 0));

  return {
    items,
    totalSinImpuestos,
    totalDescuento,
    porTarifa,
    totalIva,
    propina,
    importeTotal: Number(n2(totalSinImpuestos + totalIva + propina)),
  };
}

const dosDigitos = (v: number) => String(v).padStart(2, "0");

/** dd/mm/aaaa, que es como el SRI espera la fecha de emisión. */
export function fechaSri(f: Date): string {
  return `${dosDigitos(f.getDate())}/${dosDigitos(f.getMonth() + 1)}/${f.getFullYear()}`;
}

export function generarXmlFactura(datos: DatosFactura): { xml: string; totales: TotalesFactura } {
  const t = calcularTotales(datos);

  const pagado = Number(n2(datos.pagos.reduce((s, p) => s + p.total, 0)));
  if (datos.pagos.length === 0) throw new ErrorXml("Hay que indicar al menos una forma de pago.");
  if (Math.abs(pagado - t.importeTotal) > 0.005) {
    throw new ErrorXml(
      `Las formas de pago suman ${pagado} y el total de la factura es ${t.importeTotal}.`,
    );
  }

  const infoTributaria =
    "<infoTributaria>" +
    txt("ambiente", datos.ambiente) +
    txt("tipoEmision", datos.tipoEmision) +
    txt("razonSocial", datos.razonSocial) +
    opt("nombreComercial", datos.nombreComercial) +
    txt("ruc", datos.ruc) +
    txt("claveAcceso", datos.claveAcceso) +
    txt("codDoc", TIPO_COMPROBANTE.FACTURA) +
    txt("estab", datos.establecimiento) +
    txt("ptoEmi", datos.puntoEmision) +
    txt("secuencial", datos.secuencial) +
    txt("dirMatriz", datos.dirMatriz) +
    opt("contribuyenteRimpe", datos.contribuyenteRimpe) +
    opt("agenteRetencion", datos.agenteRetencion) +
    "</infoTributaria>";

  const totalConImpuestos =
    "<totalConImpuestos>" +
    t.porTarifa
      .map(
        (g) =>
          "<totalImpuesto>" +
          txt("codigo", IMPUESTO_IVA) +
          txt("codigoPorcentaje", g.codigoPorcentaje) +
          txt("baseImponible", n2(g.base)) +
          txt("tarifa", n2(g.porcentaje)) +
          txt("valor", n2(g.valor)) +
          "</totalImpuesto>",
      )
      .join("") +
    "</totalConImpuestos>";

  const pagos =
    "<pagos>" +
    datos.pagos
      .map(
        (p) =>
          "<pago>" +
          txt("formaPago", p.formaPago) +
          txt("total", n2(p.total)) +
          (p.plazo ? txt("plazo", n2(p.plazo)) : "") +
          (p.plazo ? txt("unidadTiempo", p.unidadTiempo ?? "dias") : "") +
          "</pago>",
      )
      .join("") +
    "</pagos>";

  const infoFactura =
    "<infoFactura>" +
    txt("fechaEmision", fechaSri(datos.fechaEmision)) +
    opt("dirEstablecimiento", datos.dirEstablecimiento) +
    opt("contribuyenteEspecial", datos.contribuyenteEspecial) +
    txt("obligadoContabilidad", datos.obligadoContabilidad ? "SI" : "NO") +
    txt("tipoIdentificacionComprador", datos.tipoIdComprador) +
    txt("razonSocialComprador", datos.razonSocialComprador) +
    txt("identificacionComprador", datos.identificacionComprador) +
    opt("direccionComprador", datos.direccionComprador) +
    txt("totalSinImpuestos", n2(t.totalSinImpuestos)) +
    txt("totalDescuento", n2(t.totalDescuento)) +
    totalConImpuestos +
    // En el esquema 2.1.0 la propina es opcional. Se omite cuando es cero:
    // así sale el mismo XML que el SRI viene autorizando para este emisor.
    (t.propina > 0 ? txt("propina", n2(t.propina)) : "") +
    txt("importeTotal", n2(t.importeTotal)) +
    txt("moneda", datos.moneda ?? "DOLAR") +
    pagos +
    "</infoFactura>";

  const detalles =
    "<detalles>" +
    t.items
      .map(
        (i) =>
          "<detalle>" +
          txt("codigoPrincipal", i.codigoPrincipal) +
          opt("codigoAuxiliar", i.codigoAuxiliar) +
          txt("descripcion", i.descripcion) +
          txt("cantidad", n6(i.cantidad)) +
          txt("precioUnitario", n6(i.precioUnitario)) +
          txt("descuento", n2(i.descuento)) +
          txt("precioTotalSinImpuesto", n2(i.base)) +
          "<impuestos><impuesto>" +
          txt("codigo", IMPUESTO_IVA) +
          txt("codigoPorcentaje", i.codigoPorcentaje) +
          txt("tarifa", n2(i.porcentaje)) +
          txt("baseImponible", n2(i.base)) +
          txt("valor", n2(i.iva)) +
          "</impuesto></impuestos>" +
          "</detalle>",
      )
      .join("") +
    "</detalles>";

  const adicionales = (datos.infoAdicional ?? []).filter((c) => c.valor && c.valor.trim() !== "");
  const infoAdicional =
    adicionales.length === 0
      ? ""
      : "<infoAdicional>" +
        adicionales
          .map(
            (c) =>
              `<campoAdicional nombre="${escapar(c.nombre)}">${escapar(c.valor)}</campoAdicional>`,
          )
          .join("") +
        "</infoAdicional>";

  const xml =
    '<factura id="comprobante" version="2.1.0">' +
    infoTributaria +
    infoFactura +
    detalles +
    infoAdicional +
    "</factura>";

  return { xml, totales: t };
}

/** Traduce el tipo de identificación del modelo al código de la tabla 6. */
export function codigoIdentificacion(tipo: string): string {
  const codigo = TIPO_ID_COMPRADOR[tipo];
  if (!codigo) throw new ErrorXml(`Tipo de identificación no admitido por el SRI: "${tipo}".`);
  return codigo;
}
