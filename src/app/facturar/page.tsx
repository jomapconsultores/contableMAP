"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useCarga } from "@/lib/carga";
import { calcularTotales, type ItemFactura } from "@/lib/sri/xml";
import { FORMAS_PAGO } from "@/lib/sri/catalogos";

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

const CAMPO =
  "mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500";

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
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold">Facturar</h1>
        {config?.configurado && (
          <span
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              config.ambiente === 2
                ? "bg-emerald-50 text-emerald-800"
                : "bg-amber-50 text-amber-800"
            }`}
          >
            {config.ambiente === 2 ? "Producción" : "Ambiente de pruebas · sin validez tributaria"}
          </span>
        )}
      </div>

      {cargando ? (
        <p className="text-sm text-slate-500">Cargando…</p>
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
    <section className="rounded-lg border border-amber-200 bg-amber-50 p-5">
      <h2 className="font-medium text-amber-900">Falta configurar la facturación electrónica</h2>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-900">
        {faltan.map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>
      <a href="/ajustes" className="mt-3 inline-block text-sm font-medium text-emerald-800 underline">
        Ir a Ajustes
      </a>
    </section>
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

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5">
      <h2 className="font-medium">Nueva factura</h2>

      <form onSubmit={enviar} className="mt-4 space-y-5">
        <div className="grid gap-3 sm:grid-cols-4">
          <label className="block text-sm">
            <span className="text-slate-700">Punto de emisión</span>
            <select name="punto_emision_id" className={CAMPO}>
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

          <label className="block text-sm">
            <span className="text-slate-700">Fecha de emisión</span>
            <input
              type="date"
              name="fecha"
              defaultValue={new Date().toISOString().slice(0, 10)}
              className={CAMPO}
            />
          </label>

          <label className="block text-sm">
            <span className="text-slate-700">Forma de pago</span>
            <select
              name="forma_pago"
              value={formaPago}
              onChange={(e) => setFormaPago(e.target.value)}
              className={CAMPO}
            >
              {Object.entries(FORMAS_PAGO).map(([codigo, texto]) => (
                <option key={codigo} value={codigo}>
                  {texto}
                </option>
              ))}
            </select>
          </label>

          <label className="mt-6 flex items-center gap-2 text-sm">
            <input type="checkbox" name="a_credito" />
            <span>A crédito</span>
          </label>
        </div>

        <fieldset className="grid gap-3 rounded-md border border-slate-200 p-4 sm:grid-cols-3">
          <legend className="px-1 text-sm font-medium">Cliente</legend>

          <label className="block text-sm">
            <span className="text-slate-700">Tipo de identificación</span>
            <select
              name="tipo_id_cliente"
              value={tipoId}
              onChange={(e) => setTipoId(e.target.value)}
              className={CAMPO}
            >
              <option value="RUC">RUC</option>
              <option value="CEDULA">Cédula</option>
              <option value="PASAPORTE">Pasaporte</option>
              <option value="IDENT_EXTERIOR">Identificación del exterior</option>
              <option value="CONSUMIDOR_FINAL">Consumidor final</option>
            </select>
          </label>

          <label className="block text-sm">
            <span className="text-slate-700">Identificación</span>
            <input
              name="id_cliente"
              required={tipoId !== "CONSUMIDOR_FINAL"}
              disabled={tipoId === "CONSUMIDOR_FINAL"}
              placeholder={tipoId === "CONSUMIDOR_FINAL" ? "9999999999999" : ""}
              className={`${CAMPO} disabled:bg-slate-100`}
            />
          </label>

          <label className="block text-sm">
            <span className="text-slate-700">Razón social</span>
            <input
              name="razon_social_cliente"
              required={tipoId !== "CONSUMIDOR_FINAL"}
              disabled={tipoId === "CONSUMIDOR_FINAL"}
              className={`${CAMPO} disabled:bg-slate-100`}
            />
          </label>

          <label className="block text-sm sm:col-span-2">
            <span className="text-slate-700">Dirección</span>
            <input name="direccion_cliente" className={CAMPO} />
          </label>

          <label className="block text-sm">
            <span className="text-slate-700">Correo (para enviarle la factura)</span>
            <input type="email" name="email_cliente" className={CAMPO} />
          </label>

          {tipoId === "CONSUMIDOR_FINAL" && (
            <p className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600 sm:col-span-3">
              El SRI solo admite consumidor final hasta $50. Por encima hay que
              identificar al comprador.
            </p>
          )}
        </fieldset>

        <div>
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">Detalle</h3>
            <button
              type="button"
              onClick={() => setLineas((ls) => [...ls, lineaVacia(Date.now())])}
              className="text-sm text-emerald-700 underline"
            >
              Añadir línea
            </button>
          </div>

          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="py-2 pr-2">Código</th>
                  <th className="py-2 pr-2">Descripción</th>
                  <th className="py-2 pr-2 text-right">Cantidad</th>
                  <th className="py-2 pr-2 text-right">P. unitario</th>
                  <th className="py-2 pr-2 text-right">Descuento</th>
                  <th className="py-2 pr-2">IVA</th>
                  <th className="py-2 pr-2 text-right">Subtotal</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {lineas.map((l) => {
                  const base = Math.max(0, l.cantidad * l.precioUnitario - l.descuento);
                  return (
                    <tr key={l.clave} className="border-b border-slate-100">
                      <td className="py-1 pr-2">
                        <input
                          value={l.codigoPrincipal}
                          onChange={(e) => cambiar(l.clave, "codigoPrincipal", e.target.value)}
                          className="w-24 rounded border border-slate-300 px-2 py-1"
                        />
                      </td>
                      <td className="py-1 pr-2">
                        <input
                          value={l.descripcion}
                          onChange={(e) => cambiar(l.clave, "descripcion", e.target.value)}
                          className="w-full min-w-[180px] rounded border border-slate-300 px-2 py-1"
                        />
                      </td>
                      <td className="py-1 pr-2">
                        <input
                          type="number"
                          step="0.000001"
                          min="0"
                          value={l.cantidad}
                          onChange={(e) => cambiar(l.clave, "cantidad", Number(e.target.value))}
                          className="w-20 rounded border border-slate-300 px-2 py-1 text-right"
                        />
                      </td>
                      <td className="py-1 pr-2">
                        <input
                          type="number"
                          step="0.000001"
                          min="0"
                          value={l.precioUnitario}
                          onChange={(e) => cambiar(l.clave, "precioUnitario", Number(e.target.value))}
                          className="w-24 rounded border border-slate-300 px-2 py-1 text-right"
                        />
                      </td>
                      <td className="py-1 pr-2">
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={l.descuento}
                          onChange={(e) => cambiar(l.clave, "descuento", Number(e.target.value))}
                          className="w-20 rounded border border-slate-300 px-2 py-1 text-right"
                        />
                      </td>
                      <td className="py-1 pr-2">
                        <select
                          value={l.tarifa}
                          onChange={(e) => cambiar(l.clave, "tarifa", e.target.value)}
                          className="rounded border border-slate-300 px-2 py-1"
                        >
                          {TARIFAS.map((t) => (
                            <option key={t.valor} value={t.valor}>
                              {t.texto}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-1 pr-2 text-right tabular-nums">{dinero(base)}</td>
                      <td className="py-1 text-right">
                        {lineas.length > 1 && (
                          <button
                            type="button"
                            onClick={() => setLineas((ls) => ls.filter((x) => x.clave !== l.clave))}
                            className="text-xs text-rose-700 underline"
                          >
                            Quitar
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

        <div className="flex flex-wrap items-end justify-between gap-4">
          <label className="block flex-1 text-sm">
            <span className="text-slate-700">Concepto (para el asiento contable)</span>
            <input name="concepto" className={CAMPO} />
          </label>

          {totales && (
            <dl className="min-w-[220px] space-y-1 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-600">Subtotal</dt>
                <dd className="tabular-nums">{dinero(totales.totalSinImpuestos)}</dd>
              </div>
              {totales.totalDescuento > 0 && (
                <div className="flex justify-between">
                  <dt className="text-slate-600">Descuento</dt>
                  <dd className="tabular-nums">{dinero(totales.totalDescuento)}</dd>
                </div>
              )}
              <div className="flex justify-between">
                <dt className="text-slate-600">IVA</dt>
                <dd className="tabular-nums">{dinero(totales.totalIva)}</dd>
              </div>
              <div className="flex justify-between border-t border-slate-200 pt-1 font-semibold">
                <dt>Total</dt>
                <dd className="tabular-nums">{dinero(totales.importeTotal)}</dd>
              </div>
            </dl>
          )}
        </div>

        {error && (
          <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>
        )}

        {resultado && <Resultado resultado={resultado} />}

        <div className="flex flex-wrap gap-3">
          <button
            type="submit"
            onClick={() => (simular.current = false)}
            disabled={ocupado !== null || !totales || totales.importeTotal <= 0}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {ocupado === "emitir" ? "Enviando al SRI…" : "Emitir y enviar al SRI"}
          </button>
          <button
            type="submit"
            onClick={() => (simular.current = true)}
            disabled={ocupado !== null || !totales || totales.importeTotal <= 0}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {ocupado === "simular" ? "Generando…" : "Generar sin enviar"}
          </button>
        </div>
        <p className="text-xs text-slate-500">
          «Generar sin enviar» firma la factura y consume un secuencial, pero no
          la manda al SRI: sirve para revisar el XML la primera vez.
        </p>
      </form>
    </section>
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
  };
}) {
  const bien = resultado.estado === "AUTORIZADA";
  return (
    <div
      className={`rounded-md border px-4 py-3 text-sm ${
        bien ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-amber-200 bg-amber-50 text-amber-900"
      }`}
    >
      <div className="font-medium">
        Factura {resultado.numero} · {resultado.estado.toLowerCase().replace(/_/g, " ")}
      </div>
      <div className="mt-1 break-all font-mono text-xs">{resultado.clave_acceso}</div>
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
      <div className="mt-2 flex gap-3 text-xs">
        <a className="underline" href={`/api/sri/facturas/${resultado.venta_id}/ride`} target="_blank">
          Ver RIDE
        </a>
        <a className="underline" href={`/api/sri/facturas/${resultado.venta_id}/xml`}>
          Descargar XML
        </a>
      </div>
    </div>
  );
}

const COLOR_ESTADO: Record<string, string> = {
  AUTORIZADA: "bg-emerald-50 text-emerald-800",
  RECIBIDA: "bg-sky-50 text-sky-800",
  FIRMADA: "bg-slate-100 text-slate-700",
  DEVUELTA: "bg-rose-50 text-rose-800",
  NO_AUTORIZADA: "bg-rose-50 text-rose-800",
  ANULADA: "bg-slate-100 text-slate-500",
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
      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="font-medium">Facturas emitidas</h2>
        <p className="mt-2 text-sm text-slate-500">Todavía no has emitido ninguna.</p>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5">
      <h2 className="font-medium">Facturas emitidas</h2>
      {error && <p className="mt-2 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>}

      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="py-2 pr-3">Fecha</th>
              <th className="py-2 pr-3">Número</th>
              <th className="py-2 pr-3">Cliente</th>
              <th className="py-2 pr-3 text-right">Total</th>
              <th className="py-2 pr-3">Estado</th>
              <th className="py-2"></th>
            </tr>
          </thead>
          <tbody>
            {facturas.map((f) => (
              <tr key={f.id} className="border-b border-slate-100 align-top">
                <td className="py-2 pr-3 whitespace-nowrap">
                  {new Date(`${f.fecha}T12:00:00`).toLocaleDateString("es-EC")}
                </td>
                <td className="py-2 pr-3 whitespace-nowrap font-medium">{f.numero}</td>
                <td className="py-2 pr-3">
                  {f.razon_social_cliente}
                  <div className="text-xs text-slate-500">{f.id_cliente}</div>
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">{dinero(Number(f.total))}</td>
                <td className="py-2 pr-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      COLOR_ESTADO[f.sri_estado] ?? "bg-slate-100 text-slate-700"
                    }`}
                  >
                    {f.sri_estado.toLowerCase().replace(/_/g, " ")}
                  </span>
                  {f.sri_mensajes?.length > 0 && (
                    <div className="mt-1 max-w-xs text-xs text-rose-700">
                      {f.sri_mensajes.map((m, i) => (
                        <div key={i}>{m.mensaje}</div>
                      ))}
                    </div>
                  )}
                </td>
                <td className="py-2 text-right whitespace-nowrap">
                  <a className="text-xs underline" href={`/api/sri/facturas/${f.id}/ride`} target="_blank">
                    RIDE
                  </a>
                  <a className="ml-3 text-xs underline" href={`/api/sri/facturas/${f.id}/xml`}>
                    XML
                  </a>
                  {f.sri_estado !== "AUTORIZADA" && (
                    <button
                      onClick={() => reintentar(f.id)}
                      disabled={ocupado === f.id}
                      className="ml-3 text-xs text-emerald-700 underline disabled:opacity-50"
                    >
                      {ocupado === f.id ? "Consultando…" : "Reintentar"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
