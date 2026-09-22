"use client";

import { useCallback, useState } from "react";
import { HandCoins, Landmark, PiggyBank, Receipt } from "lucide-react";
import { usd, nombreMes, MESES } from "@/lib/formato";
import { useCarga, type Respuesta } from "@/lib/carga";
import {
  Aviso,
  Encabezado,
  Esqueleto,
  Indicador,
  Insignia,
  Tarjeta,
  campo,
  etiqueta,
  tabla,
} from "@/components/ui";

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

  /** Una casilla de la liquidación del 104; cero si la base no la devuelve. */
  const casilla = (k: string) => Number(iva?.resumen[k] ?? 0);

  return (
    <div className="space-y-6">
      <Encabezado
        antetitulo="Declaraciones"
        titulo="Impuestos"
        descripcion="IVA mensual (formulario 104) e impuesto a la renta del ejercicio (formulario 102), calculados a partir de la contabilidad."
        acciones={
          <div className="flex flex-wrap items-end gap-3">
            <label>
              <span className={etiqueta}>Mes</span>
              <select
                value={mes}
                onChange={(e) => {
                  setMes(Number(e.target.value));
                  setCargando(true);
                }}
                className={`${campo} w-auto`}
              >
                {MESES.map((m, i) => (
                  <option key={m} value={i + 1}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className={etiqueta}>Año</span>
              <input
                type="number"
                value={anio}
                min={2000}
                max={2100}
                onChange={(e) => {
                  setAnio(Number(e.target.value));
                  setCargando(true);
                }}
                className={`${campo} w-24 tabular-nums`}
              />
            </label>
          </div>
        }
      />

      {error && <Aviso tono="aviso">{error}</Aviso>}

      {/* Primera carga: aún no hay nada que pintar. */}
      {cargando && !iva && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Esqueleto key={i} className="h-[88px] w-full rounded-xl" />
            ))}
          </div>
          <Esqueleto className="h-80 w-full rounded-xl" />
        </div>
      )}

      {(iva || renta) && (
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {iva && (
            <>
              <Indicador
                etiqueta={`IVA a pagar · ${nombreMes(mes)}`}
                valor={usd(casilla("c619_impuesto_a_pagar"))}
                detalle={`Total a pagar (799) ${usd(casilla("c799_total_a_pagar"))}`}
                tono={casilla("c619_impuesto_a_pagar") > 0 ? "aviso" : "exito"}
                icono={Receipt}
                href="#iva"
              />
              <Indicador
                etiqueta="Crédito tributario de IVA"
                valor={usd(casilla("c609_credito_proximo_periodo"))}
                detalle="Para el próximo período (609)"
                tono="info"
                icono={PiggyBank}
                href="#iva"
              />
            </>
          )}
          {renta && (
            <>
              <Indicador
                etiqueta={`Impuesto a la renta · ${renta.anio}`}
                valor={usd(renta.impuesto_causado)}
                detalle={`Base imponible ${usd(renta.base_imponible)}`}
                icono={Landmark}
                href="#renta"
              />
              <Indicador
                etiqueta={renta.saldo >= 0 ? "Renta a pagar" : "Renta: crédito a favor"}
                valor={usd(Math.abs(renta.saldo))}
                detalle="Tras rebajas y retenciones"
                tono={renta.saldo > 0 ? "aviso" : "exito"}
                icono={HandCoins}
                href="#renta"
              />
            </>
          )}
        </section>
      )}

      {iva && (
        <Tarjeta
          id="iva"
          titulo={`Declaración de IVA · formulario 104 · ${nombreMes(mes)} ${anio}`}
          descripcion="Los números de casillero siguen la estructura vigente del formulario. Verifícalos contra el formulario publicado por el SRI antes de declarar."
          acciones={cargando ? <Insignia tono="info">Calculando…</Insignia> : undefined}
          sinRelleno
        >
          <div className="grid lg:grid-cols-3 lg:divide-x lg:divide-slate-100">
            <Bloque titulo="Ventas" datos={iva.ventas} />
            <Bloque titulo="Compras" datos={iva.compras} />
            <Bloque titulo="Liquidación" datos={iva.resumen} destacar="c799_total_a_pagar" />
          </div>
        </Tarjeta>
      )}

      {renta && (
        <Tarjeta
          id="renta"
          titulo={`Impuesto a la renta · formulario 102 · ejercicio ${renta.anio}`}
          acciones={cargando ? <Insignia tono="info">Calculando…</Insignia> : undefined}
          sinRelleno
        >
          <div className="grid lg:grid-cols-2 lg:divide-x lg:divide-slate-100">
            <div>
              <Cabecera texto="Liquidación" />
              <dl className="px-5 pb-3 text-sm">
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
                  total
                />
              </dl>
            </div>

            <div className="border-t border-slate-100 lg:border-t-0">
              <Cabecera texto="Gastos personales deducibles" />
              <p className="px-5 pt-3 text-xs text-slate-500">
                Tope global{" "}
                <span className="font-medium tabular-nums text-slate-700">
                  {usd(renta.gastos_personales.tope_global)}
                </span>{" "}
                · canasta básica{" "}
                <span className="font-medium tabular-nums text-slate-700">
                  {usd(renta.gastos_personales.canasta_basica)}
                </span>
              </p>
              <div className={`${tabla.contenedor} mt-2`}>
                <table className={tabla.tabla}>
                  <thead className={tabla.cabecera}>
                    <tr>
                      <th className={tabla.th}>Rubro</th>
                      <th className={`${tabla.th} text-right`}>Gastado</th>
                      <th className={`${tabla.th} text-right`}>Tope</th>
                      <th className={`${tabla.th} text-right`}>Deducible</th>
                    </tr>
                  </thead>
                  <tbody className={tabla.cuerpo}>
                    {renta.gastos_personales.rubros.length === 0 && (
                      <tr>
                        <td colSpan={4} className={`${tabla.td} py-6 text-center text-slate-500`}>
                          Sin gastos personales registrados este ejercicio.
                        </td>
                      </tr>
                    )}
                    {renta.gastos_personales.rubros.map((r) => (
                      <tr key={r.rubro} className={tabla.fila}>
                        <td className={tabla.td}>{r.rubro}</td>
                        <td className={`${tabla.td} ${tabla.numero}`}>{usd(r.gastado)}</td>
                        <td className={`${tabla.td} ${tabla.numero} text-slate-400`}>{usd(r.tope)}</td>
                        <td className={`${tabla.td} ${tabla.numero} font-medium`}>{usd(r.deducible)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-slate-300 font-semibold text-slate-900">
                      <td className={tabla.td} colSpan={3}>
                        Total deducible
                      </td>
                      <td className={`${tabla.td} ${tabla.numero}`}>
                        {usd(renta.gastos_personales.total_deducible)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <div className="mx-5 my-4 flex items-baseline justify-between gap-3 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                <span>Rebaja del impuesto por gastos personales</span>
                <span className="font-semibold tabular-nums">
                  {usd(renta.gastos_personales.rebaja_impuesto)}
                </span>
              </div>
            </div>
          </div>
        </Tarjeta>
      )}
    </div>
  );
}

/** Rótulo de columna: la sección a la izquierda y «USD» sobre las cifras. */
function Cabecera({ texto }: { texto: string }) {
  return (
    <div className="flex justify-between border-b border-slate-200 bg-slate-50/60 px-5 py-2 text-[11px] font-medium uppercase tracking-wider text-slate-500">
      <span>{texto}</span>
      <span>USD</span>
    </div>
  );
}

/**
 * Un bloque del formulario 104. Las etiquetas empiezan por el número de
 * casillero («401 · Ventas…»); se separa para pintarlo en su propia columna,
 * gris y tabular, como en el formulario. Los totales de sección llevan línea
 * encima, y la casilla `destacar` cierra el bloque con doble línea.
 */
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
      <Cabecera texto={titulo} />
      <dl className="px-5 pb-3 text-sm">
        {Object.entries(datos).map(([k, v]) => {
          const texto = ETIQUETAS[k] ?? k;
          const partes = /^(\d+) · (.*)$/.exec(texto);
          const esDestacada = k === destacar;
          const esTotal = !esDestacada && k.includes("_total_");
          return (
            <div
              key={k}
              className={`flex items-baseline justify-between gap-3 ${
                esDestacada
                  ? "mt-2 border-t-2 border-double border-slate-400 py-2.5 font-bold text-slate-900"
                  : esTotal
                    ? "mt-1 border-t border-slate-300 py-2 font-semibold text-slate-900"
                    : "border-t border-slate-100 py-2 text-slate-600 first:border-t-0"
              }`}
            >
              <dt className="flex min-w-0 items-baseline gap-2">
                <span className="w-8 shrink-0 font-mono text-xs tabular-nums text-slate-400">
                  {partes?.[1] ?? ""}
                </span>
                <span>{partes?.[2] ?? texto}</span>
              </dt>
              <dd className={`whitespace-nowrap tabular-nums ${Number(v) < 0 ? "text-rose-700" : ""}`}>
                {usd(v)}
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}

/** `destacado` marca un subtotal y `total` el resultado final de la liquidación. */
function Fila({
  k,
  v,
  destacado,
  total,
}: {
  k: string;
  v: number;
  destacado?: boolean;
  total?: boolean;
}) {
  const estilo = total
    ? "mt-2 border-t-2 border-double border-slate-400 py-2.5 text-base font-bold text-slate-900"
    : destacado
      ? "mt-1 border-t border-slate-300 py-2 font-semibold text-slate-900"
      : "border-t border-slate-100 py-2 text-slate-700 first:border-t-0";
  return (
    <div className={`flex items-baseline justify-between gap-4 ${estilo}`}>
      <dt>{k}</dt>
      <dd className={`whitespace-nowrap tabular-nums ${v < 0 ? "text-rose-700" : ""}`}>{usd(v)}</dd>
    </div>
  );
}
