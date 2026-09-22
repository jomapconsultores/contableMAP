"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Download, ExternalLink, Plus, Receipt, RotateCw, Send, Settings, Trash2 } from "lucide-react";
import { useCarga } from "@/lib/carga";
import { calcularTotales, type ItemFactura } from "@/lib/sri/xml";
import { FORMAS_PAGO } from "@/lib/sri/catalogos";
import {
  Aviso,
  Encabezado,
  Esqueleto,
  Insignia,
  Tarjeta,
  Vacio,
  boton,
  campo,
  etiqueta,
  tabla,
  type Tono,
} from "@/components/ui";

/**
 * Emisión de facturas electrónicas.
 *
 * El formulario calcula bases e IVA con la misma función que usa el servidor
 * para armar el XML, así que lo que se ve antes de emitir es exactamente lo
 * que va a firmarse. Quien decide sigue siendo el SRI: hasta que responde
 * "AUTORIZADO" la factura no existe, y la pantalla no dice otra cosa.
 */

interface Punto {
  id: string;
  establecimiento: string;
  punto_emision: string;
  nombre: string | null;
  activo: boolean;
}

interface Factura {
  id: string;
  fecha: string;
  numero: string;
  razon_social_cliente: string;
  id_cliente: string | null;
  total: number;
  sri_estado: string;
  sri_ambiente: number | null;
  clave_acceso: string;
  autorizacion: string | null;
  sri_fecha_autorizacion: string | null;
  sri_mensajes: { tipo: string; mensaje: string; informacionAdicional?: string | null }[];
}

interface Config {
  configurado: boolean;
  ambiente: number;
  certificado: { caducado: boolean; hasta: string } | null;
  puntos_emision: Punto[];
}

interface Linea extends ItemFactura {
  clave: number;
}

/** Campo compacto para las celdas del detalle. */
const CELDA = `${campo} py-1.5`;

const TARIFAS: { valor: string; texto: string }[] = [
  { valor: "15", texto: "IVA 15 %" },
  { valor: "5", texto: "IVA 5 %" },
  { valor: "8", texto: "IVA 8 %" },
  { valor: "0", texto: "IVA 0 %" },
  { valor: "EXENTO", texto: "Exento" },
  { valor: "NO_OBJETO", texto: "No objeto" },
];

const lineaVacia = (clave: number): Linea => ({
  clave,
  codigoPrincipal: "",
  descripcion: "",
  cantidad: 1,
  precioUnitario: 0,
  descuento: 0,
  tarifa: "15",
});

const dinero = (v: number) =>
  v.toLocaleString("es-EC", { style: "currency", currency: "USD" });

export default function Facturar() {
  const [config, setConfig] = useState<Config | null>(null);
  const [facturas, setFacturas] = useState<Factura[]>([]);
  const [cargando, setCargando] = useState(true);

  const pedir = useCallback(async () => {
    const [c, f] = await Promise.all([
      fetch("/api/sri/config").then((r) => r.json()),
      fetch("/api/sri/facturas?limite=50").then((r) => r.json()),
    ]);
    return {
      config: c.ok ? (c.datos as Config) : null,
      facturas: f.ok ? (f.datos as Factura[]) : [],
    };
  }, []);

  const aplicar = useCallback((r: { config: Config | null; facturas: Factura[] } | Error) => {
    if (!(r instanceof Error)) {
      setConfig(r.config);
      setFacturas(r.facturas);
    }
    setCargando(false);
  }, []);

  const recargar = useCarga(pedir, aplicar);

  const listo =
    config?.configurado && config.certificado && !config.certificado.caducado &&
    config.puntos_emision.length > 0;

  return (
    <div className="space-y-6">
      <Encabezado
        titulo="Facturar"
        descripcion="Facturas electrónicas firmadas y enviadas al SRI. Solo valen cuando el SRI las autoriza."
        acciones={
          config?.configurado && (
            <Insignia tono={config.ambiente === 2 ? "exito" : "aviso"}>
              {config.ambiente === 2 ? "Producción" : "Ambiente de pruebas · sin validez tributaria"}
            </Insignia>
          )
        }
      />

      {cargando ? (
        <Tarjeta titulo="Nueva factura">
          <div className="space-y-3">
            <Esqueleto className="h-9 w-full" />
            <Esqueleto className="h-9 w-full" />
            <Esqueleto className="h-24 w-full" />
          </div>
        </Tarjeta>
      ) : !listo ? (
        <SinConfigurar config={config} />
      ) : (
        <Formulario config={config as Config} alEmitir={recargar} />
      )}

      <Listado facturas={facturas} alCambiar={recargar} />
    </div>
  );
}

function SinConfigurar({ config }: { config: Config | null }) {
  const faltan: string[] = [];
  if (!config?.configurado) faltan.push("indicar la dirección de la matriz y el ambiente");
  if (!config?.certificado) faltan.push("cargar el certificado de firma (.p12)");
  else if (config.certificado.caducado) faltan.push("renovar el certificado, que está caducado");
  if ((config?.puntos_emision.length ?? 0) === 0) {
    faltan.push("crear al menos un punto de emisión (por ejemplo 001-001)");
  }

  return (
    <Aviso
      tono="aviso"
      titulo="Falta configurar la facturación electrónica"
      acciones={
        <Link href="/ajustes" className={boton("secundario", "sm")}>
          <Settings size={14} /> Ir a Ajustes
        </Link>
      }
    >
      <ul className="mt-1 list-disc space-y-1 pl-5">
        {faltan.map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>
    </Aviso>
  );
}

function Formulario({ config, alEmitir }: { config: Config; alEmitir: () => Promise<void> }) {
  const [lineas, setLineas] = useState<Linea[]>([lineaVacia(1)]);
  const [tipoId, setTipoId] = useState("RUC");
  const [formaPago, setFormaPago] = useState("01");
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<{
    estado: string;
    numero: string;
    clave_acceso: string;
    venta_id: string;
    autorizacion: string | null;
    mensajes: { tipo: string; mensaje: string; informacionAdicional?: string | null }[];
    asiento_id?: string;
    error_contable?: string;
    xml_firmado?: string;
  } | null>(null);
  const [ocupado, setOcupado] = useState<null | "emitir" | "simular">(null);
  // Qué botón se pulsó. En un ref y no en estado porque el `submit` llega
  // inmediatamente después del `click` y todavía no habría re-renderizado.
  const simular = useRef(false);

  const totales = useMemo(() => {
    try {
      return calcularTotales({ items: lineas.filter((l) => l.descripcion.trim() !== "") });
    } catch {
      return null;
    }
  }, [lineas]);

  const cambiar = (clave: number, campo: keyof ItemFactura, valor: string | number) =>
    setLineas((ls) => ls.map((l) => (l.clave === clave ? { ...l, [campo]: valor } : l)));

  async function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const soloGenerar = simular.current;
    setOcupado(soloGenerar ? "simular" : "emitir");
    setError(null);
    setResultado(null);

    const utiles = lineas.filter((l) => l.descripcion.trim() !== "");
    const total = totales?.importeTotal ?? 0;

    const res = await fetch("/api/sri/facturas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        punto_emision_id: f.get("punto_emision_id"),
        fecha: f.get("fecha") || null,
        tipo_id_cliente: f.get("tipo_id_cliente"),
        id_cliente: f.get("id_cliente") || "9999999999999",
        razon_social_cliente: f.get("razon_social_cliente") || "CONSUMIDOR FINAL",
        direccion_cliente: f.get("direccion_cliente"),
        email_cliente: f.get("email_cliente") || null,
        telefono_cliente: f.get("telefono_cliente"),
        concepto: f.get("concepto"),
        items: utiles.map((l) => ({
          codigo_principal: l.codigoPrincipal || "001",
          descripcion: l.descripcion,
          cantidad: Number(l.cantidad),
          precio_unitario: Number(l.precioUnitario),
          descuento: Number(l.descuento),
          tarifa: l.tarifa,
        })),
        pagos: [{ forma_pago: f.get("forma_pago"), total }],
        a_credito: f.get("a_credito") === "on",
        simular: soloGenerar,
      }),
    });

    const json = await res.json();
    setOcupado(null);

    if (!json.ok) {
      setError(json.error);
      return;
    }
    setResultado(json.datos);
    setLineas([lineaVacia(Date.now())]);
    await alEmitir();
  }

  const sinTotal = ocupado !== null || !totales || totales.importeTotal <= 0;

  return (
    <Tarjeta titulo="Nueva factura" descripcion="Lo que ves aquí es exactamente lo que se firma y se envía.">
      <form onSubmit={enviar} className="space-y-6">
        {/* Datos de la emisión */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block">
            <span className={etiqueta}>Punto de emisión</span>
            <select name="punto_emision_id" className={campo}>
              {config.puntos_emision
                .filter((p) => p.activo)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.establecimiento}-{p.punto_emision}
                    {p.nombre ? ` · ${p.nombre}` : ""}
                  </option>
                ))}
            </select>
          </label>

          <label className="block">
            <span className={etiqueta}>Fecha de emisión</span>
            <input
              type="date"
              name="fecha"
              defaultValue={new Date().toISOString().slice(0, 10)}
              className={campo}
            />
          </label>

          <label className="block">
            <span className={etiqueta}>Forma de pago</span>
            <select
              name="forma_pago"
              value={formaPago}
              onChange={(e) => setFormaPago(e.target.value)}
              className={campo}
            >
              {Object.entries(FORMAS_PAGO).map(([codigo, texto]) => (
                <option key={codigo} value={codigo}>
                  {texto}
                </option>
              ))}
            </select>
          </label>

          <label className="flex h-9 items-center gap-2 self-end rounded-lg border border-slate-200 px-3 text-sm text-slate-700 hover:bg-slate-50">
            <input
              type="checkbox"
              name="a_credito"
              className="h-4 w-4 rounded border-slate-300 accent-emerald-600"
            />
            <span>A crédito</span>
          </label>
        </div>

        {/* Cliente */}
        <fieldset className="rounded-lg border border-slate-200 bg-slate-50/50 p-4">
          <legend className="px-1 text-sm font-semibold text-slate-900">Cliente</legend>

          <div className="grid gap-4 sm:grid-cols-3">
            <label className="block">
              <span className={etiqueta}>Tipo de identificación</span>
              <select
                name="tipo_id_cliente"
                value={tipoId}
                onChange={(e) => setTipoId(e.target.value)}
                className={campo}
              >
                <option value="RUC">RUC</option>
                <option value="CEDULA">Cédula</option>
                <option value="PASAPORTE">Pasaporte</option>
                <option value="IDENT_EXTERIOR">Identificación del exterior</option>
                <option value="CONSUMIDOR_FINAL">Consumidor final</option>
              </select>
            </label>

            <label className="block">
              <span className={etiqueta}>Identificación</span>
              <input
                name="id_cliente"
                required={tipoId !== "CONSUMIDOR_FINAL"}
                disabled={tipoId === "CONSUMIDOR_FINAL"}
                placeholder={tipoId === "CONSUMIDOR_FINAL" ? "9999999999999" : ""}
                className={`${campo} tabular-nums`}
              />
            </label>

            <label className="block">
              <span className={etiqueta}>Razón social</span>
              <input
                name="razon_social_cliente"
                required={tipoId !== "CONSUMIDOR_FINAL"}
                disabled={tipoId === "CONSUMIDOR_FINAL"}
                className={campo}
              />
            </label>

            <label className="block sm:col-span-2">
              <span className={etiqueta}>Dirección</span>
              <input name="direccion_cliente" className={campo} />
            </label>

            <label className="block">
              <span className={etiqueta}>Correo (para enviarle la factura)</span>
              <input type="email" name="email_cliente" className={campo} />
            </label>

            {tipoId === "CONSUMIDOR_FINAL" && (
              <div className="sm:col-span-3">
                <Aviso tono="info">
                  El SRI solo admite consumidor final hasta $50. Por encima hay que
                  identificar al comprador.
                </Aviso>
              </div>
            )}
          </div>
        </fieldset>

        {/* Detalle */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">Detalle</h3>
            <button
              type="button"
              onClick={() => setLineas((ls) => [...ls, lineaVacia(Date.now())])}
              className={boton("secundario", "sm")}
            >
              <Plus size={14} /> Añadir línea
            </button>
          </div>

          <div className={`${tabla.contenedor} rounded-lg border border-slate-200`}>
            <table className={`${tabla.tabla} min-w-[760px]`}>
              <thead className={tabla.cabecera}>
                <tr>
                  <th className={`${tabla.th} w-28`}>Código</th>
                  <th className={tabla.th}>Descripción</th>
                  <th className={`${tabla.th} w-24 text-right`}>Cantidad</th>
                  <th className={`${tabla.th} w-28 text-right`}>P. unitario</th>
                  <th className={`${tabla.th} w-24 text-right`}>Descuento</th>
                  <th className={`${tabla.th} w-32`}>IVA</th>
                  <th className={`${tabla.th} w-28 text-right`}>Subtotal</th>
                  <th className={`${tabla.th} w-12`}>
                    <span className="sr-only">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody className={tabla.cuerpo}>
                {lineas.map((l) => {
                  const base = Math.max(0, l.cantidad * l.precioUnitario - l.descuento);
                  return (
                    <tr key={l.clave}>
                      <td className="px-2 py-2 pl-4">
                        <input
                          aria-label="Código"
                          value={l.codigoPrincipal}
                          onChange={(e) => cambiar(l.clave, "codigoPrincipal", e.target.value)}
                          className={CELDA}
                        />
                      </td>
                      <td className="px-2 py-2">
                        <input
                          aria-label="Descripción"
                          value={l.descripcion}
                          onChange={(e) => cambiar(l.clave, "descripcion", e.target.value)}
                          className={`${CELDA} min-w-[180px]`}
                        />
                      </td>
                      <td className="px-2 py-2">
                        <input
                          aria-label="Cantidad"
                          type="number"
                          step="0.000001"
                          min="0"
                          value={l.cantidad}
                          onChange={(e) => cambiar(l.clave, "cantidad", Number(e.target.value))}
                          className={`${CELDA} text-right tabular-nums`}
                        />
                      </td>
                      <td className="px-2 py-2">
                        <input
                          aria-label="Precio unitario"
                          type="number"
                          step="0.000001"
                          min="0"
                          value={l.precioUnitario}
                          onChange={(e) => cambiar(l.clave, "precioUnitario", Number(e.target.value))}
                          className={`${CELDA} text-right tabular-nums`}
                        />
                      </td>
                      <td className="px-2 py-2">
                        <input
                          aria-label="Descuento"
                          type="number"
                          step="0.01"
                          min="0"
                          value={l.descuento}
                          onChange={(e) => cambiar(l.clave, "descuento", Number(e.target.value))}
                          className={`${CELDA} text-right tabular-nums`}
                        />
                      </td>
                      <td className="px-2 py-2">
                        <select
                          aria-label="IVA"
                          value={l.tarifa}
                          onChange={(e) => cambiar(l.clave, "tarifa", e.target.value)}
                          className={CELDA}
                        >
                          {TARIFAS.map((t) => (
                            <option key={t.valor} value={t.valor}>
                              {t.texto}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className={`px-2 py-2 ${tabla.numero} font-medium text-slate-900`}>
                        {dinero(base)}
                      </td>
                      <td className="px-2 py-2 pr-4 text-right">
                        {lineas.length > 1 && (
                          <button
                            type="button"
                            onClick={() => setLineas((ls) => ls.filter((x) => x.clave !== l.clave))}
                            aria-label="Quitar línea"
                            title="Quitar línea"
                            className={`${boton("fantasma", "sm")} px-2 text-rose-600 hover:bg-rose-50 hover:text-rose-700`}
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Concepto y totales */}
        <div className="flex flex-wrap items-start justify-between gap-6">
          <label className="block min-w-64 flex-1">
            <span className={etiqueta}>Concepto (para el asiento contable)</span>
            <input name="concepto" className={campo} />
          </label>

          {totales && (
            <dl className="w-full space-y-1.5 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm sm:w-72">
              <div className="flex justify-between">
                <dt className="text-slate-500">Subtotal</dt>
                <dd className="tabular-nums text-slate-900">{dinero(totales.totalSinImpuestos)}</dd>
              </div>
              {totales.totalDescuento > 0 && (
                <div className="flex justify-between">
                  <dt className="text-slate-500">Descuento</dt>
                  <dd className="tabular-nums text-slate-900">{dinero(totales.totalDescuento)}</dd>
                </div>
              )}
              <div className="flex justify-between">
                <dt className="text-slate-500">IVA</dt>
                <dd className="tabular-nums text-slate-900">{dinero(totales.totalIva)}</dd>
              </div>
              <div className="flex items-baseline justify-between border-t border-slate-200 pt-2">
                <dt className="font-semibold text-slate-900">Total</dt>
                <dd className="text-lg font-semibold tabular-nums tracking-tight text-slate-900">
                  {dinero(totales.importeTotal)}
                </dd>
              </div>
            </dl>
          )}
        </div>

        {error && <Aviso tono="peligro">{error}</Aviso>}

        {resultado && <Resultado resultado={resultado} />}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-5">
          <p className="max-w-md text-xs text-slate-500">
            «Generar sin enviar» firma la factura y consume un secuencial, pero no
            la manda al SRI: sirve para revisar el XML la primera vez.
          </p>
          {/* «Emitir» va primero en el DOM a propósito: Enter en el formulario
              pulsa el primer botón de envío. Se muestra a la derecha con
              flex-row-reverse. */}
          <div className="flex flex-row-reverse flex-wrap gap-2">
            <button
              type="submit"
              onClick={() => (simular.current = false)}
              disabled={sinTotal}
              className={boton("primario")}
            >
              <Send size={16} />
              {ocupado === "emitir" ? "Enviando al SRI…" : "Emitir y enviar al SRI"}
            </button>
            <button
              type="submit"
              onClick={() => (simular.current = true)}
              disabled={sinTotal}
              className={boton("secundario")}
            >
              {ocupado === "simular" ? "Generando…" : "Generar sin enviar"}
            </button>
          </div>
        </div>
      </form>
    </Tarjeta>
  );
}

function Resultado({
  resultado,
}: {
  resultado: {
    estado: string;
    numero: string;
    clave_acceso: string;
    venta_id: string;
    autorizacion: string | null;
    mensajes: { tipo: string; mensaje: string; informacionAdicional?: string | null }[];
    asiento_id?: string;
    error_contable?: string;
  };
}) {
  const bien = resultado.estado === "AUTORIZADA";
  return (
    <Aviso
      tono={bien ? "exito" : "aviso"}
      titulo={`Factura ${resultado.numero} · ${resultado.estado.toLowerCase().replace(/_/g, " ")}`}
      acciones={
        <>
          <a
            className={boton("secundario", "sm")}
            href={`/api/sri/facturas/${resultado.venta_id}/ride`}
            target="_blank"
          >
            <ExternalLink size={14} /> Ver RIDE
          </a>
          <a className={boton("secundario", "sm")} href={`/api/sri/facturas/${resultado.venta_id}/xml`}>
            <Download size={14} /> Descargar XML
          </a>
        </>
      }
    >
      <div className="break-all font-mono text-xs">{resultado.clave_acceso}</div>
      {resultado.mensajes.length > 0 && (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
          {resultado.mensajes.map((m, i) => (
            <li key={i}>
              <strong>{m.tipo}</strong> · {m.mensaje}
              {m.informacionAdicional ? ` — ${m.informacionAdicional}` : ""}
            </li>
          ))}
        </ul>
      )}
      {resultado.error_contable && (
        <p className="mt-2 rounded-md border border-amber-300 bg-amber-100 px-2 py-1.5 text-xs text-amber-900">
          La factura está autorizada, pero no se pudo contabilizar sola:{" "}
          {resultado.error_contable} Contabilízala desde Comprobantes.
        </p>
      )}
      {resultado.asiento_id && (
        <p className="mt-2 text-xs">Contabilizada automáticamente, con su cuenta por cobrar en cartera.</p>
      )}
    </Aviso>
  );
}

const TONO_ESTADO: Record<string, Tono> = {
  AUTORIZADA: "exito",
  RECIBIDA: "info",
  FIRMADA: "neutro",
  DEVUELTA: "peligro",
  NO_AUTORIZADA: "peligro",
  ANULADA: "neutro",
};

function Listado({ facturas, alCambiar }: { facturas: Factura[]; alCambiar: () => Promise<void> }) {
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reintentar(id: string) {
    setOcupado(id);
    setError(null);
    const res = await fetch(`/api/sri/facturas/${id}/reintentar`, { method: "POST" });
    const json = await res.json();
    setOcupado(null);
    if (!json.ok) setError(json.error);
    await alCambiar();
  }

  if (facturas.length === 0) {
    return (
      <Tarjeta titulo="Facturas emitidas" sinRelleno>
        <Vacio
          icono={Receipt}
          titulo="Todavía no has emitido ninguna"
          descripcion="Las facturas que emitas aparecerán aquí con su estado en el SRI."
        />
      </Tarjeta>
    );
  }

  return (
    <Tarjeta titulo="Facturas emitidas" descripcion="Las últimas 50, con su estado en el SRI." sinRelleno>
      {error && (
        <div className="border-b border-slate-100 px-5 py-3">
          <Aviso tono="peligro">{error}</Aviso>
        </div>
      )}

      <div className={`${tabla.contenedor} max-h-[70vh]`}>
        <table className={`${tabla.tabla} min-w-[760px]`}>
          <thead className={tabla.cabecera}>
            <tr>
              <th className={tabla.th}>Fecha</th>
              <th className={tabla.th}>Número</th>
              <th className={tabla.th}>Cliente</th>
              <th className={`${tabla.th} text-right`}>Total</th>
              <th className={tabla.th}>Estado</th>
              <th className={tabla.th}>
                <span className="sr-only">Acciones</span>
              </th>
            </tr>
          </thead>
          <tbody className={tabla.cuerpo}>
            {facturas.map((f) => (
              <tr key={f.id} className={`${tabla.fila} align-top`}>
                <td className={`${tabla.td} whitespace-nowrap text-slate-500`}>
                  {new Date(`${f.fecha}T12:00:00`).toLocaleDateString("es-EC")}
                </td>
                <td className={`${tabla.td} whitespace-nowrap font-medium tabular-nums text-slate-900`}>
                  {f.numero}
                </td>
                <td className={tabla.td}>
                  <div className="text-slate-900">{f.razon_social_cliente}</div>
                  <div className="text-xs tabular-nums text-slate-400">{f.id_cliente}</div>
                </td>
                <td className={`${tabla.td} ${tabla.numero} font-medium text-slate-900`}>
                  {dinero(Number(f.total))}
                </td>
                <td className={tabla.td}>
                  <Insignia tono={TONO_ESTADO[f.sri_estado] ?? "neutro"}>
                    {f.sri_estado.toLowerCase().replace(/_/g, " ")}
                  </Insignia>
                  {f.sri_mensajes?.length > 0 && (
                    <div className="mt-1 max-w-xs text-xs text-rose-700">
                      {f.sri_mensajes.map((m, i) => (
                        <div key={i}>{m.mensaje}</div>
                      ))}
                    </div>
                  )}
                </td>
                <td className={`${tabla.td} whitespace-nowrap text-right`}>
                  <div className="flex justify-end gap-1">
                    <a
                      className={boton("fantasma", "sm")}
                      href={`/api/sri/facturas/${f.id}/ride`}
                      target="_blank"
                    >
                      RIDE
                    </a>
                    <a className={boton("fantasma", "sm")} href={`/api/sri/facturas/${f.id}/xml`}>
                      XML
                    </a>
                    {f.sri_estado !== "AUTORIZADA" && (
                      <button
                        onClick={() => reintentar(f.id)}
                        disabled={ocupado === f.id}
                        className={boton("secundario", "sm")}
                      >
                        <RotateCw size={14} className={ocupado === f.id ? "animate-spin" : ""} />
                        {ocupado === f.id ? "Consultando…" : "Reintentar"}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Tarjeta>
  );
}
