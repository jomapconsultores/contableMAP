"use client";

import { useCallback, useState } from "react";
import { usd } from "@/lib/formato";
import { useCarga } from "@/lib/carga";

interface Detalle {
  codigo: string;
  cuenta: string;
  tipo: string;
  subtipo: string | null;
  saldo: number;
}

interface Resultados {
  ingresos: number;
  costo_ventas: number;
  utilidad_bruta: number;
  gastos_operativos: number;
  utilidad_operativa: number;
  gastos_financieros: number;
  gastos_personales: number;
  gastos_no_deducibles: number;
  total_gastos: number;
  resultado_ejercicio: number;
  detalle: Detalle[];
}

interface Balance {
  fecha_corte: string;
  activo_corriente: number;
  activo_no_corriente: number;
  total_activo: number;
  pasivo_corriente: number;
  pasivo_no_corriente: number;
  total_pasivo: number;
  patrimonio_inicial: number;
  resultado_ejercicio: number;
  total_patrimonio: number;
  pasivo_mas_patrimonio: number;
  descuadre: number;
  detalle: Detalle[];
}

const HOY = new Date();

export default function Informes() {
  const [anio, setAnio] = useState(HOY.getUTCFullYear());
  const [desde, setDesde] = useState(`${HOY.getUTCFullYear()}-01-01`);
  const [hasta, setHasta] = useState(HOY.toISOString().slice(0, 10));
  const [pyg, setPyg] = useState<Resultados | null>(null);
  const [balance, setBalance] = useState<Balance | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const pedir = useCallback(async () => {
    const [r1, r2] = await Promise.all([
      fetch(`/api/informes?tipo=resultados&desde=${desde}&hasta=${hasta}`).then((r) => r.json()),
      fetch(`/api/informes?tipo=balance&hasta=${hasta}&anio=${anio}`).then((r) => r.json()),
    ]);
    if (!r1.ok) throw new Error(r1.error);
    if (!r2.ok) throw new Error(r2.error);
    return { pyg: r1.datos as Resultados, balance: r2.datos as Balance };
  }, [desde, hasta, anio]);

  const aplicar = useCallback((r: { pyg: Resultados; balance: Balance } | Error) => {
    if (r instanceof Error) {
      setError(r.message);
    } else {
      setError(null);
      setPyg(r.pyg);
      setBalance(r.balance);
    }
    setCargando(false);
  }, []);

  useCarga(pedir, aplicar);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-semibold">Estados financieros</h1>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-sm">
            <span className="block text-xs text-slate-500">Desde</span>
            <input
              type="date"
              value={desde}
              onChange={(e) => {
                setDesde(e.target.value);
                setAnio(Number(e.target.value.slice(0, 4)));
                setCargando(true);
              }}
              className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="text-sm">
            <span className="block text-xs text-slate-500">Hasta</span>
            <input
              type="date"
              value={hasta}
              onChange={(e) => {
                setHasta(e.target.value);
                setCargando(true);
              }}
              className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </label>
        </div>
      </div>

      {error && <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>}
      {cargando && <p className="text-sm text-slate-500">Calculando…</p>}

      {pyg && (
        <section className="rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="mb-3 font-medium">Estado de resultados</h2>
          <dl className="divide-y divide-slate-100 text-sm">
            <Fila k="Ingresos" v={pyg.ingresos} />
            <Fila k="(−) Costo de ventas" v={-pyg.costo_ventas} />
            <Fila k="Utilidad bruta" v={pyg.utilidad_bruta} destacado />
            <Fila k="(−) Gastos operativos" v={-pyg.gastos_operativos} />
            <Fila k="Utilidad operativa" v={pyg.utilidad_operativa} destacado />
            <Fila k="(−) Gastos financieros" v={-pyg.gastos_financieros} />
            <Fila k="(−) Gastos personales" v={-pyg.gastos_personales} />
            <Fila k="(−) Gastos no deducibles" v={-pyg.gastos_no_deducibles} />
            <Fila k="Resultado del ejercicio" v={pyg.resultado_ejercicio} destacado />
          </dl>
          <Desglose detalle={pyg.detalle} />
        </section>
      )}

      {balance && (
        <section className="rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="mb-3 font-medium">Balance general</h2>
          {Math.abs(Number(balance.descuadre)) > 0.01 && (
            <p className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
              El balance no cuadra por {usd(balance.descuadre)}. Suele deberse a
              asientos incompletos o a saldos iniciales sin registrar.
            </p>
          )}
          <div className="grid gap-6 sm:grid-cols-2">
            <dl className="divide-y divide-slate-100 text-sm">
              <Fila k="Activo corriente" v={balance.activo_corriente} />
              <Fila k="Activo no corriente" v={balance.activo_no_corriente} />
              <Fila k="Total activo" v={balance.total_activo} destacado />
            </dl>
            <dl className="divide-y divide-slate-100 text-sm">
              <Fila k="Pasivo corriente" v={balance.pasivo_corriente} />
              <Fila k="Pasivo no corriente" v={balance.pasivo_no_corriente} />
              <Fila k="Total pasivo" v={balance.total_pasivo} />
              <Fila k="Patrimonio" v={balance.patrimonio_inicial} />
              <Fila k="Resultado del ejercicio" v={balance.resultado_ejercicio} />
              <Fila k="Pasivo + patrimonio" v={balance.pasivo_mas_patrimonio} destacado />
            </dl>
          </div>
          <Desglose detalle={balance.detalle} />
        </section>
      )}
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

function Desglose({ detalle }: { detalle: Detalle[] }) {
  if (!detalle?.length) return null;
  return (
    <details className="mt-4">
      <summary className="cursor-pointer text-sm text-slate-500">
        Ver desglose por cuenta ({detalle.length})
      </summary>
      <table className="mt-2 w-full text-sm">
        <tbody className="divide-y divide-slate-100">
          {detalle.map((d) => (
            <tr key={d.codigo}>
              <td className="py-1 pr-3 font-mono text-xs text-slate-400">{d.codigo}</td>
              <td className="py-1">{d.cuenta}</td>
              <td className="py-1 text-right tabular-nums">{usd(d.saldo)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
