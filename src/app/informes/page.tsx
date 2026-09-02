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

interface Subarbol {
  raices: Detalle[];
  hijosDe: Map<string, Detalle[]>;
}

/**
 * Las cuentas que sostienen un renglón del estado, colgadas de su rama. Las
 * raíces son las que no cuelgan de otra cuenta del mismo renglón: en «Activo
 * corriente» eso deja arriba «1.1», y dentro toda su descendencia.
 */
function subarbol(detalle: Detalle[] | undefined, cabe: (d: Detalle) => boolean): Subarbol {
  const filas = (detalle ?? []).filter(cabe);
  const codigos = new Set(filas.map((d) => d.codigo));
  const hijosDe = new Map<string, Detalle[]>();
  for (const d of filas) {
    if (!d.padre || !codigos.has(d.padre)) continue;
    hijosDe.set(d.padre, [...(hijosDe.get(d.padre) ?? []), d]);
  }
  return { raices: filas.filter((d) => !d.padre || !codigos.has(d.padre)), hijosDe };
}

/**
 * Un renglón del estado se corresponde con un tipo y unos subtipos concretos,
 * los mismos con los que las funciones de la base reparten los totales. Las
 * cabeceras del plan —«1 ACTIVO», «6 GASTOS»— no llevan subtipo y quedan fuera:
 * su saldo ya está repartido entre los renglones que cuelgan de ellas.
 */
const renglon =
  (tipo: string, subtipos?: string[]) =>
  (d: Detalle): boolean =>
    d.tipo === tipo &&
    d.subtipo !== null &&
    (subtipos === undefined || subtipos.includes(d.subtipo));

const HOY = new Date();

export default function Informes() {
  const [anio, setAnio] = useState(HOY.getUTCFullYear());
  const [desde, setDesde] = useState(`${HOY.getUTCFullYear()}-01-01`);
  const [hasta, setHasta] = useState(HOY.toISOString().slice(0, 10));
  const [pyg, setPyg] = useState<Resultados | null>(null);
  const [balance, setBalance] = useState<Balance | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [abiertos, setAbiertos] = useState<Record<string, boolean>>({});

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

  const alternar = (codigo: string, abierto: boolean) =>
    setAbiertos((a) => ({ ...a, [codigo]: !abierto }));

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
            <Fila
              k="Ingresos"
              v={pyg.ingresos}
              cuentas={subarbol(pyg.detalle, renglon("INGRESO"))}
              abiertos={abiertos}
              alternar={alternar}
            />
            <Fila
              k="(−) Costo de ventas"
              v={-pyg.costo_ventas}
              cuentas={subarbol(pyg.detalle, renglon("COSTO"))}
              abiertos={abiertos}
              alternar={alternar}
            />
            <Fila k="Utilidad bruta" v={pyg.utilidad_bruta} destacado />
            <Fila
              k="(−) Gastos operativos"
              v={-pyg.gastos_operativos}
              cuentas={subarbol(pyg.detalle, renglon("GASTO", ["OPERATIVO"]))}
              abiertos={abiertos}
              alternar={alternar}
            />
            <Fila k="Utilidad operativa" v={pyg.utilidad_operativa} destacado />
            <Fila
              k="(−) Gastos financieros"
              v={-pyg.gastos_financieros}
              cuentas={subarbol(pyg.detalle, renglon("GASTO", ["FINANCIERO"]))}
              abiertos={abiertos}
              alternar={alternar}
            />
            <Fila
              k="(−) Gastos personales"
              v={-pyg.gastos_personales}
              cuentas={subarbol(pyg.detalle, renglon("GASTO", ["PERSONAL"]))}
              abiertos={abiertos}
              alternar={alternar}
            />
            <Fila
              k="(−) Gastos no deducibles"
              v={-pyg.gastos_no_deducibles}
              cuentas={subarbol(pyg.detalle, renglon("GASTO", ["NO_DEDUCIBLE"]))}
              abiertos={abiertos}
              alternar={alternar}
            />
            <Fila k="Resultado del ejercicio" v={pyg.resultado_ejercicio} destacado />
          </dl>
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
              <Fila
                k="Activo corriente"
                v={balance.activo_corriente}
                cuentas={subarbol(balance.detalle, renglon("ACTIVO", ["CORRIENTE"]))}
                abiertos={abiertos}
                alternar={alternar}
              />
              <Fila
                k="Activo no corriente"
                v={balance.activo_no_corriente}
                cuentas={subarbol(balance.detalle, renglon("ACTIVO", ["NO_CORRIENTE"]))}
                abiertos={abiertos}
                alternar={alternar}
              />
              <Fila k="Total activo" v={balance.total_activo} destacado />
            </dl>
            <dl className="divide-y divide-slate-100 text-sm">
              <Fila
                k="Pasivo corriente"
                v={balance.pasivo_corriente}
                cuentas={subarbol(balance.detalle, renglon("PASIVO", ["CORRIENTE"]))}
                abiertos={abiertos}
                alternar={alternar}
              />
              <Fila
                k="Pasivo no corriente"
                v={balance.pasivo_no_corriente}
                cuentas={subarbol(balance.detalle, renglon("PASIVO", ["NO_CORRIENTE"]))}
                abiertos={abiertos}
                alternar={alternar}
              />
              <Fila k="Total pasivo" v={balance.total_pasivo} />
              <Fila
                k="Patrimonio"
                v={balance.patrimonio_inicial}
                cuentas={subarbol(balance.detalle, renglon("PATRIMONIO"))}
                abiertos={abiertos}
                alternar={alternar}
              />
              <Fila k="Resultado del ejercicio" v={balance.resultado_ejercicio} />
              <Fila k="Pasivo + patrimonio" v={balance.pasivo_mas_patrimonio} destacado />
            </dl>
          </div>
        </section>
      )}
    </div>
  );
}

/**
 * Un renglón del estado con su desglose justo debajo: las cuentas que lo
 * componen, cada una en su rama. Las de los primeros niveles vienen abiertas;
 * las que agrupan cuentas concretas —una por banco, una por libreta, una por
 * tarjeta— empiezan plegadas y se abren al pulsarlas.
 */
function Fila({
  k,
  v,
  destacado,
  cuentas,
  abiertos,
  alternar,
}: {
  k: string;
  v: number;
  destacado?: boolean;
  cuentas?: Subarbol;
  abiertos?: Record<string, boolean>;
  alternar?: (codigo: string, abierto: boolean) => void;
}) {
  return (
    <div className={destacado ? "font-semibold" : undefined}>
      <div className="flex justify-between py-1.5">
        <dt>{k}</dt>
        <dd className={`tabular-nums ${v < 0 ? "text-rose-700" : ""}`}>{usd(v)}</dd>
      </div>
      {cuentas && alternar && abiertos && cuentas.raices.length > 0 && (
        <div className="mb-1.5 font-normal">
          {cuentas.raices.map((d) => (
            <Rama
              key={d.codigo}
              nodo={d}
              hijosDe={cuentas.hijosDe}
              sangria={0}
              abiertos={abiertos}
              alternar={alternar}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Rama({
  nodo,
  hijosDe,
  sangria,
  abiertos,
  alternar,
}: {
  nodo: Detalle;
  hijosDe: Map<string, Detalle[]>;
  sangria: number;
  abiertos: Record<string, boolean>;
  alternar: (codigo: string, abierto: boolean) => void;
}) {
  const hijos = hijosDe.get(nodo.codigo) ?? [];
  const abierto = abiertos[nodo.codigo] ?? (nodo.nivel ?? 1) <= 3;

  return (
    <>
      <div
        className="flex justify-between py-0.5 text-slate-600"
        style={{ paddingLeft: 12 + sangria * 14 }}
      >
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span className="font-mono text-xs text-slate-400">{nodo.codigo}</span>
          {hijos.length > 0 ? (
            <button
              type="button"
              onClick={() => alternar(nodo.codigo, abierto)}
              className="truncate text-left hover:underline"
              aria-expanded={abierto}
            >
              <span className="mr-1 inline-block w-3 text-slate-400">{abierto ? "▾" : "▸"}</span>
              {nodo.cuenta}
              <span className="ml-1 text-xs text-slate-400">({hijos.length})</span>
            </button>
          ) : (
            <span className="ml-4 truncate">{nodo.cuenta}</span>
          )}
        </span>
        <span className="tabular-nums">{usd(Number(nodo.saldo))}</span>
      </div>
      {abierto &&
        hijos.map((h) => (
          <Rama
            key={h.codigo}
            nodo={h}
            hijosDe={hijosDe}
            sangria={sangria + 1}
            abiertos={abiertos}
            alternar={alternar}
          />
        ))}
    </>
  );
}
