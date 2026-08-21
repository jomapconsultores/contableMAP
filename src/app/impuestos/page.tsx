"use client";

import { useCallback, useState } from "react";
import { usd, nombreMes, MESES } from "@/lib/formato";
import { useCarga, type Respuesta } from "@/lib/carga";

interface DeclaracionIva {
  ventas: Record<string, number>;
  compras: Record<string, number>;
  resumen: Record<string, number>;
}

interface RubroGP {
  rubro: string;
  gastado: number;
  tope: number;
  deducible: number;
}

interface Renta {
  anio: number;
  ingresos: { actividad_economica: number; relacion_dependencia: number; total: number };
  deducciones: { gastos_actividad: number; aporte_iess: number };
  base_imponible: number;
  impuesto_causado: number;
  gastos_personales: {
    rubros: RubroGP[];
    tope_global: number;
    total_deducible: number;
    rebaja_impuesto: number;
    canasta_basica: number;
  };
  rebaja_gastos_personales: number;
  retenciones: { en_la_fuente: number; relacion_dependencia: number };
  saldo: number;
  resultado: string;
}

const ETIQUETAS: Record<string, string> = {
  c401_ventas_gravadas: "401 · Ventas gravadas con tarifa distinta de 0 %",
  c405_ventas_tarifa_0: "405 · Ventas con tarifa 0 %",
  c411_no_objeto: "411 · Ventas no objeto de IVA",
  c412_exentas: "412 · Ventas exentas",
  c419_total_ventas: "419 · Total de ventas",
  c480_iva_generado: "480 · IVA generado en ventas",
  c500_adquisiciones_gravadas: "500 · Adquisiciones gravadas",
  c507_adquisiciones_tarifa_0: "507 · Adquisiciones con tarifa 0 %",
  c510_no_objeto: "510 · Adquisiciones no objeto de IVA",
  c511_exentas: "511 · Adquisiciones exentas",
  c517_total_adquisiciones: "517 · Total de adquisiciones",
  c520_iva_compras: "520 · IVA pagado en compras",
  c521_iva_con_derecho_credito: "521 · IVA con derecho a crédito tributario",
  c601_impuesto_causado: "601 · Impuesto causado",
  c602_credito_periodo_anterior: "602 · Crédito tributario del período anterior",
  c605_retenciones_iva_recibidas: "605 · Retenciones de IVA que le efectuaron",
  c609_credito_proximo_periodo: "609 · Crédito tributario para el próximo período",
  c619_impuesto_a_pagar: "619 · Impuesto a pagar",
  retenciones_iva_efectuadas: "Retenciones de IVA efectuadas como agente",
  c799_total_a_pagar: "799 · Total a pagar",
};

const HOY = new Date();

export default function Impuestos() {
  const [anio, setAnio] = useState(HOY.getUTCFullYear());
  const [mes, setMes] = useState(HOY.getUTCMonth() + 1);
  const [iva, setIva] = useState<DeclaracionIva | null>(null);
  const [renta, setRenta] = useState<Renta | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const pedir = useCallback(async () => {
    const [a, b] = (await Promise.all([
      fetch(`/api/informes?tipo=iva&anio=${anio}&mes=${mes}`).then((r) => r.json()),
      fetch(`/api/informes?tipo=renta&anio=${anio}`).then((r) => r.json()),
    ])) as [Respuesta<DeclaracionIva>, Respuesta<Renta>];
    if (!a.ok) throw new Error(a.error);
    return { iva: a.datos, renta: b };
  }, [anio, mes]);

  const aplicar = useCallback(
    (r: { iva: DeclaracionIva; renta: Respuesta<Renta> } | Error) => {
      if (r instanceof Error) {
        setError(r.message);
      } else {
        setError(null);
        setIva(r.iva);
        // La renta puede fallar si faltan parámetros fiscales del año.
        setRenta(r.renta.ok ? r.renta.datos : null);
        if (!r.renta.ok) setError(r.renta.error);
      }
      setCargando(false);
    },
    [],
  );

  useCarga(pedir, aplicar);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-semibold">Impuestos</h1>
        <div className="flex gap-2">
          <select
            value={mes}
            onChange={(e) => {
              setMes(Number(e.target.value));
              setCargando(true);
            }}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            {MESES.map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
              </option>
            ))}
          </select>
          <input
            type="number"
            value={anio}
            min={2000}
            max={2100}
            onChange={(e) => {
              setAnio(Number(e.target.value));
              setCargando(true);
            }}
            className="w-24 rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
      </div>

      {error && <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">{error}</p>}
      {cargando && <p className="text-sm text-slate-500">Calculando…</p>}

      {iva && (
        <section id="iva" className="scroll-mt-4 rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="font-medium">
            Declaración de IVA · formulario 104 · {nombreMes(mes)} {anio}
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Los números de casillero siguen la estructura vigente del formulario.
            Verifícalos contra el formulario publicado por el SRI antes de declarar.
          </p>
          <div className="mt-4 grid gap-6 lg:grid-cols-3">
            <Bloque titulo="Ventas" datos={iva.ventas} />
            <Bloque titulo="Compras" datos={iva.compras} />
            <Bloque titulo="Liquidación" datos={iva.resumen} destacar="c799_total_a_pagar" />
          </div>
        </section>
      )}

      {renta && (
        <section id="renta" className="scroll-mt-4 rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="font-medium">Impuesto a la renta · ejercicio {renta.anio}</h2>
          <div className="mt-4 grid gap-6 lg:grid-cols-2">
            <dl className="divide-y divide-slate-100 text-sm">
              <Fila k="Ingresos por actividad económica" v={renta.ingresos.actividad_economica} />
              <Fila k="Ingresos en relación de dependencia" v={renta.ingresos.relacion_dependencia} />
              <Fila k="(−) Gastos deducibles de la actividad" v={-renta.deducciones.gastos_actividad} />
              <Fila k="(−) Aporte personal al IESS" v={-renta.deducciones.aporte_iess} />
              <Fila k="Base imponible" v={renta.base_imponible} destacado />
              <Fila k="Impuesto causado" v={renta.impuesto_causado} />
              <Fila k="(−) Rebaja por gastos personales" v={-renta.rebaja_gastos_personales} />
              <Fila k="(−) Retenciones en la fuente" v={-renta.retenciones.en_la_fuente} />
              <Fila k="(−) Retenciones del empleador" v={-renta.retenciones.relacion_dependencia} />
              <Fila
                k={renta.saldo >= 0 ? "Impuesto a pagar" : "Crédito a favor"}
                v={Math.abs(renta.saldo)}
                destacado
              />
            </dl>

            <div>
              <h3 className="text-sm font-medium">Gastos personales deducibles</h3>
              <p className="mt-1 text-xs text-slate-500">
                Tope global {usd(renta.gastos_personales.tope_global)} · canasta
                básica {usd(renta.gastos_personales.canasta_basica)}
              </p>
              <table className="mt-2 w-full text-sm">
                <thead className="text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="py-1">Rubro</th>
                    <th className="py-1 text-right">Gastado</th>
                    <th className="py-1 text-right">Tope</th>
                    <th className="py-1 text-right">Deducible</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {renta.gastos_personales.rubros.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-3 text-slate-500">
                        Sin gastos personales registrados este ejercicio.
                      </td>
                    </tr>
                  )}
                  {renta.gastos_personales.rubros.map((r) => (
                    <tr key={r.rubro}>
                      <td className="py-1">{r.rubro}</td>
                      <td className="py-1 text-right tabular-nums">{usd(r.gastado)}</td>
                      <td className="py-1 text-right tabular-nums text-slate-400">
                        {usd(r.tope)}
                      </td>
                      <td className="py-1 text-right font-medium tabular-nums">
                        {usd(r.deducible)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-3 text-sm">
                Total deducible {usd(renta.gastos_personales.total_deducible)} → rebaja
                del impuesto {usd(renta.gastos_personales.rebaja_impuesto)}
              </p>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

function Bloque({
  titulo,
  datos,
  destacar,
}: {
  titulo: string;
  datos: Record<string, number>;
  destacar?: string;
}) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-medium">{titulo}</h3>
      <dl className="divide-y divide-slate-100 text-sm">
        {Object.entries(datos).map(([k, v]) => (
          <div
            key={k}
            className={`flex justify-between gap-3 py-1.5 ${k === destacar ? "font-semibold" : ""}`}
          >
            <dt className="text-slate-600">{ETIQUETAS[k] ?? k}</dt>
            <dd className="whitespace-nowrap tabular-nums">{usd(v)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function Fila({ k, v, destacado }: { k: string; v: number; destacado?: boolean }) {
  return (
    <div className={`flex justify-between py-1.5 ${destacado ? "font-semibold" : ""}`}>
      <dt>{k}</dt>
      <dd className={`tabular-nums ${v < 0 ? "text-rose-700" : ""}`}>{usd(v)}</dd>
    </div>
  );
}
