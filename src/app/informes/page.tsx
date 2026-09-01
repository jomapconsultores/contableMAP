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
  // El desglose llega en árbol: cada cuenta con su rama y su nivel. Son
  // opcionales porque una base sin la migración 0017 aún devuelve la lista
  // plana de cuentas finales, que se pinta igual, sin nada que desplegar.
  nivel?: number;
  padre?: string | null;
  hoja?: boolean;
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
        <section id="resultados" className="scroll-mt-4 rounded-lg border border-slate-200 bg-white p-5">
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
          <Desglose
            detalle={pyg.detalle}
            grupos={[
              { titulo: "Ingresos", tipos: ["INGRESO"], signo: -1 },
              { titulo: "Costos y gastos", tipos: ["COSTO", "GASTO"], signo: 1 },
            ]}
          />
        </section>
      )}

      {balance && (
        <section id="balance" className="scroll-mt-4 rounded-lg border border-slate-200 bg-white p-5">
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
          <Desglose
            detalle={balance.detalle}
            grupos={[
              { titulo: "Activos", tipos: ["ACTIVO"], signo: 1 },
              { titulo: "Pasivos", tipos: ["PASIVO"], signo: -1 },
              { titulo: "Patrimonio", tipos: ["PATRIMONIO"], signo: -1 },
            ]}
          />
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

interface Grupo {
  titulo: string;
  tipos: string[];
  /** Los saldos llegan en su naturaleza contable: −1 los que son de haber. */
  signo: number;
}

/**
 * El desglose se lee por grupo —ingresos, gastos, activos, pasivos— y dentro de
 * cada uno por ramas: «Cooperativas» dice cuánto suman las once libretas y se
 * despliega para verlas una a una. Lo mismo con los bancos, las tarjetas o
 * cualquier familia de gastos.
 *
 * Las cuentas de los primeros niveles vienen abiertas; las que agrupan cuentas
 * concretas —una por banco, una por tarjeta— empiezan plegadas para que el
 * informe se lea de un vistazo y se abra solo lo que interesa.
 */
function Desglose({ detalle, grupos }: { detalle: Detalle[]; grupos: Grupo[] }) {
  const [abiertos, setAbiertos] = useState<Record<string, boolean>>({});

  if (!detalle?.length) return null;

  const alternar = (codigo: string, abierto: boolean) =>
    setAbiertos((a) => ({ ...a, [codigo]: !abierto }));

  const bloques = grupos
    .map((g) => {
      const filas = detalle.filter((d) => g.tipos.includes(d.tipo));
      const codigos = new Set(filas.map((d) => d.codigo));
      const hijosDe = new Map<string, Detalle[]>();
      for (const d of filas) {
        if (!d.padre || !codigos.has(d.padre)) continue;
        hijosDe.set(d.padre, [...(hijosDe.get(d.padre) ?? []), d]);
      }
      // Raíces del bloque: las que no cuelgan de otra cuenta del mismo grupo.
      const raices = filas.filter((d) => !d.padre || !codigos.has(d.padre));
      return { ...g, filas, hijosDe, raices };
    })
    .filter((g) => g.filas.length > 0);

  return (
    <details className="mt-4" open>
      <summary className="cursor-pointer text-sm text-slate-500">
        Desglose por cuenta ({detalle.length})
      </summary>
      <div className="mt-2 grid gap-4 sm:grid-cols-2">
        {bloques.map((g) => {
          const total = g.raices.reduce((s, d) => s + Number(d.saldo) * g.signo, 0);
          return (
            <div key={g.titulo}>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                {g.titulo}
              </h3>
              <table className="w-full text-sm">
                <tbody className="divide-y divide-slate-100">
                  {g.raices.map((d) => (
                    <Rama
                      key={d.codigo}
                      nodo={d}
                      hijosDe={g.hijosDe}
                      signo={g.signo}
                      sangria={0}
                      abiertos={abiertos}
                      alternar={alternar}
                    />
                  ))}
                  <tr className="border-t border-slate-300 font-semibold">
                    <td className="py-1" />
                    <td className="py-1">Total {g.titulo.toLowerCase()}</td>
                    <td className="py-1 text-right tabular-nums">{usd(total)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
    </details>
  );
}

function Rama({
  nodo,
  hijosDe,
  signo,
  sangria,
  abiertos,
  alternar,
}: {
  nodo: Detalle;
  hijosDe: Map<string, Detalle[]>;
  signo: number;
  sangria: number;
  abiertos: Record<string, boolean>;
  alternar: (codigo: string, abierto: boolean) => void;
}) {
  const hijos = hijosDe.get(nodo.codigo) ?? [];
  const abierto = abiertos[nodo.codigo] ?? (nodo.nivel ?? 1) <= 3;

  return (
    <>
      <tr className={hijos.length > 0 ? "font-medium" : undefined}>
        <td className="py-1 pr-3 font-mono text-xs text-slate-400">{nodo.codigo}</td>
        <td className="py-1" style={{ paddingLeft: sangria * 14 }}>
          {hijos.length > 0 ? (
            <button
              type="button"
              onClick={() => alternar(nodo.codigo, abierto)}
              className="text-left hover:underline"
              aria-expanded={abierto}
            >
              <span className="mr-1 inline-block w-3 text-slate-400">
                {abierto ? "▾" : "▸"}
              </span>
              {nodo.cuenta}
              <span className="ml-1 text-xs text-slate-400">({hijos.length})</span>
            </button>
          ) : (
            <span className="ml-4">{nodo.cuenta}</span>
          )}
        </td>
        <td className="py-1 text-right tabular-nums">{usd(Number(nodo.saldo) * signo)}</td>
      </tr>
      {abierto &&
        hijos.map((h) => (
          <Rama
            key={h.codigo}
            nodo={h}
            hijosDe={hijosDe}
            signo={signo}
            sangria={sangria + 1}
            abiertos={abiertos}
            alternar={alternar}
          />
        ))}
    </>
  );
}
