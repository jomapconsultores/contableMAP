import { codigoBarras128 } from "./codigo-barras";
import { escapar, n2 } from "./xml";
import { FORMAS_PAGO } from "./catalogos";

/**
 * RIDE: la representación impresa del comprobante electrónico.
 *
 * Es lo que ve el cliente, pero no es la factura: la factura es el XML
 * autorizado. Por eso el RIDE lleva siempre la clave de acceso —el número de
 * autorización— y, mientras el SRI no la autorice, lo dice en letras grandes
 * en lugar de fingir que ya es válida.
 */

export interface DatosRide {
  emisor: {
    razonSocial: string;
    nombreComercial?: string | null;
    ruc: string;
    dirMatriz: string;
    dirEstablecimiento?: string | null;
    obligadoContabilidad: boolean;
    contribuyenteEspecial?: string | null;
    leyendaRegimen?: string | null;
    email?: string | null;
    telefono?: string | null;
  };
  comprobante: {
    numero: string;
    claveAcceso: string;
    ambiente: number;
    tipoEmision: number;
    fechaEmision: string;
    estado: string;
    autorizacion?: string | null;
    fechaAutorizacion?: string | null;
  };
  cliente: {
    razonSocial: string;
    identificacion: string;
    direccion?: string | null;
    email?: string | null;
    telefono?: string | null;
  };
  items: {
    codigoPrincipal: string;
    descripcion: string;
    cantidad: number;
    precioUnitario: number;
    descuento: number;
    base: number;
  }[];
  totales: {
    porTarifa: { etiqueta: string; base: number }[];
    totalSinImpuestos: number;
    totalDescuento: number;
    iva: number;
    propina: number;
    importeTotal: number;
  };
  pagos: { formaPago: string; total: number }[];
  mensajes?: { tipo: string; mensaje: string; informacionAdicional?: string | null }[];
}

const dinero = (v: number) => `$ ${n2(v)}`;

export function generarRide(d: DatosRide): string {
  const autorizado = d.comprobante.estado === "AUTORIZADA";
  const pruebas = d.comprobante.ambiente !== 2;

  const filas = d.items
    .map(
      (i) => `<tr>
        <td>${escapar(i.codigoPrincipal)}</td>
        <td class="izq">${escapar(i.descripcion)}</td>
        <td class="num">${i.cantidad}</td>
        <td class="num">${n2(i.precioUnitario)}</td>
        <td class="num">${n2(i.descuento)}</td>
        <td class="num">${n2(i.base)}</td>
      </tr>`,
    )
    .join("");

  const tarifas = d.totales.porTarifa
    .map((t) => `<tr><th>Subtotal ${escapar(t.etiqueta)}</th><td>${dinero(t.base)}</td></tr>`)
    .join("");

  const pagos = d.pagos
    .map(
      (p) =>
        `<tr><td>${escapar(FORMAS_PAGO[p.formaPago] ?? p.formaPago)}</td><td class="num">${dinero(p.total)}</td></tr>`,
    )
    .join("");

  const avisos = (d.mensajes ?? [])
    .map(
      (m) =>
        `<li><strong>${escapar(m.tipo)}</strong> · ${escapar(m.mensaje)}${
          m.informacionAdicional ? ` — ${escapar(m.informacionAdicional)}` : ""
        }</li>`,
    )
    .join("");

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Factura ${escapar(d.comprobante.numero)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { font: 12px/1.45 "Segoe UI", system-ui, sans-serif; color: #111; margin: 0; padding: 24px; background: #f6f6f6; }
  .hoja { max-width: 820px; margin: 0 auto; background: #fff; padding: 28px; border: 1px solid #ddd; }
  .cabecera { display: flex; gap: 20px; align-items: flex-start; }
  .cabecera > div { flex: 1; }
  .marco { border: 1px solid #333; padding: 12px; }
  h1 { font-size: 15px; margin: 0 0 6px; }
  h2 { font-size: 12px; margin: 18px 0 6px; text-transform: uppercase; letter-spacing: .04em; color: #555; }
  .dato { margin: 2px 0; }
  .dato span { color: #555; }
  table { width: 100%; border-collapse: collapse; margin-top: 6px; }
  th, td { border: 1px solid #ccc; padding: 5px 7px; text-align: center; }
  th { background: #f0f0f0; font-weight: 600; }
  td.izq { text-align: left; }
  td.num, .totales td { text-align: right; }
  .totales { max-width: 320px; margin-left: auto; }
  .totales th { text-align: left; background: #fafafa; font-weight: 500; }
  .totales tr.total th, .totales tr.total td { font-weight: 700; background: #f0f0f0; }
  .barras { margin-top: 14px; text-align: center; }
  .barras svg { max-width: 100%; height: auto; }
  .clave { font-family: ui-monospace, "Cascadia Mono", monospace; font-size: 11px; letter-spacing: .04em; word-break: break-all; }
  .sello { padding: 10px 12px; margin-bottom: 16px; border: 1px solid; font-weight: 600; }
  .ok { border-color: #1a7f37; color: #1a7f37; background: #eaf6ec; }
  .pendiente { border-color: #b35309; color: #b35309; background: #fdf3e7; }
  .avisos { margin: 10px 0 0; padding-left: 18px; color: #a11; }
  @media print {
    body { background: #fff; padding: 0; }
    .hoja { border: 0; max-width: none; }
  }
</style>
</head>
<body>
<div class="hoja">
  <div class="sello ${autorizado ? "ok" : "pendiente"}">
    ${
      autorizado
        ? `Comprobante AUTORIZADO por el SRI el ${escapar(d.comprobante.fechaAutorizacion ?? "")}`
        : `Comprobante ${escapar(d.comprobante.estado)} — todavía sin autorización del SRI. No entregar al cliente como factura válida.`
    }
    ${pruebas ? " · AMBIENTE DE PRUEBAS: sin validez tributaria." : ""}
  </div>

  <div class="cabecera">
    <div>
      <h1>${escapar(d.emisor.razonSocial)}</h1>
      ${d.emisor.nombreComercial ? `<div class="dato">${escapar(d.emisor.nombreComercial)}</div>` : ""}
      <div class="dato"><span>RUC:</span> ${escapar(d.emisor.ruc)}</div>
      <div class="dato"><span>Matriz:</span> ${escapar(d.emisor.dirMatriz)}</div>
      ${d.emisor.dirEstablecimiento ? `<div class="dato"><span>Establecimiento:</span> ${escapar(d.emisor.dirEstablecimiento)}</div>` : ""}
      <div class="dato"><span>Obligado a llevar contabilidad:</span> ${d.emisor.obligadoContabilidad ? "SÍ" : "NO"}</div>
      ${d.emisor.contribuyenteEspecial ? `<div class="dato"><span>Contribuyente especial nro.:</span> ${escapar(d.emisor.contribuyenteEspecial)}</div>` : ""}
      ${d.emisor.leyendaRegimen ? `<div class="dato"><strong>${escapar(d.emisor.leyendaRegimen)}</strong></div>` : ""}
    </div>
    <div class="marco">
      <h1>FACTURA</h1>
      <div class="dato"><span>No.</span> <strong>${escapar(d.comprobante.numero)}</strong></div>
      <div class="dato"><span>Número de autorización</span></div>
      <div class="clave">${escapar(d.comprobante.autorizacion ?? d.comprobante.claveAcceso)}</div>
      <div class="dato"><span>Fecha de autorización:</span> ${escapar(d.comprobante.fechaAutorizacion ?? "pendiente")}</div>
      <div class="dato"><span>Ambiente:</span> ${pruebas ? "PRUEBAS" : "PRODUCCIÓN"}</div>
      <div class="dato"><span>Emisión:</span> NORMAL</div>
      <div class="dato"><span>Clave de acceso</span></div>
      <div class="clave">${escapar(d.comprobante.claveAcceso)}</div>
      <div class="barras">${codigoBarras128(d.comprobante.claveAcceso)}</div>
    </div>
  </div>

  <h2>Cliente</h2>
  <div class="marco">
    <div class="dato"><span>Razón social:</span> ${escapar(d.cliente.razonSocial)}</div>
    <div class="dato"><span>Identificación:</span> ${escapar(d.cliente.identificacion)}</div>
    ${d.cliente.direccion ? `<div class="dato"><span>Dirección:</span> ${escapar(d.cliente.direccion)}</div>` : ""}
    ${d.cliente.email ? `<div class="dato"><span>Correo:</span> ${escapar(d.cliente.email)}</div>` : ""}
    <div class="dato"><span>Fecha de emisión:</span> ${escapar(d.comprobante.fechaEmision)}</div>
  </div>

  <h2>Detalle</h2>
  <table>
    <thead>
      <tr><th>Código</th><th>Descripción</th><th>Cant.</th><th>P. unitario</th><th>Desc.</th><th>Total</th></tr>
    </thead>
    <tbody>${filas}</tbody>
  </table>

  <table class="totales">
    ${tarifas}
    <tr><th>Descuento</th><td>${dinero(d.totales.totalDescuento)}</td></tr>
    <tr><th>Subtotal sin impuestos</th><td>${dinero(d.totales.totalSinImpuestos)}</td></tr>
    <tr><th>IVA</th><td>${dinero(d.totales.iva)}</td></tr>
    ${d.totales.propina > 0 ? `<tr><th>Propina</th><td>${dinero(d.totales.propina)}</td></tr>` : ""}
    <tr class="total"><th>Valor total</th><td>${dinero(d.totales.importeTotal)}</td></tr>
  </table>

  <h2>Formas de pago</h2>
  <table><tbody>${pagos}</tbody></table>

  ${avisos ? `<h2>Mensajes del SRI</h2><ul class="avisos">${avisos}</ul>` : ""}
</div>
</body>
</html>`;
}
