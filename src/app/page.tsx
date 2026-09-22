import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  Building2,
  CreditCard,
  FileWarning,
  Landmark,
  PiggyBank,
  Receipt,
  Scale,
  TrendingDown,
  TrendingUp,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { supabaseServer } from "@/lib/supabase/server";
import { usd, fecha, nombreMes } from "@/lib/formato";
import {
  Aviso,
  Encabezado,
  Indicador,
  Insignia,
  Tarjeta,
  Vacio,
  boton,
  tabla,
} from "@/components/ui";

export const dynamic = "force-dynamic";

interface Dashboard {
  resultados: {
    ingresos: number;
    total_gastos: number;
    resultado_ejercicio: number;
    gastos_personales: number;
  };
  iva: {
    c601_impuesto_causado: number;
    c609_credito_proximo_periodo: number;
    c619_impuesto_a_pagar: number;
  };
  cartera: { por_cobrar: number; por_pagar: number; vencido: number };
  credito_tributario_iva: number;
}

interface SaldoCuenta {
  cuenta_id: string;
  nombre: string;
  tipo: string;
  institucion: string | null;
  numero: string | null;
  saldo: number;
  pendiente: number;
  movimientos_pendientes: number;
  ultimo_movimiento: string | null;
}

interface GastoCategoria {
  categoria: string;
  subtipo: string | null;
  total: number;
  movimientos: number;
}

const ICONO_TIPO: Record<string, LucideIcon> = {
  CAJA: Banknote,
  BANCO: Landmark,
  COOPERATIVA: Building2,
  INVERSION: PiggyBank,
  TARJETA_CREDITO: CreditCard,
};

const iso = (d: Date) => d.toISOString().slice(0, 10);

export default async function Panel() {
  const sb = await supabaseServer();

  const { data: entidad } = await sb
    .from("entidades")
    .select("id, razon_social, ruc")
    .eq("activo", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!entidad) return <SinEntidad />;

  const hoy = new Date();
  const anio = hoy.getUTCFullYear();
  const mes = hoy.getUTCMonth() + 1;
  const inicioMes = iso(new Date(Date.UTC(anio, mes - 1, 1)));
  const finMes = iso(new Date(Date.UTC(anio, mes, 0)));
  const inicioMesAnterior = iso(new Date(Date.UTC(anio, mes - 2, 1)));
  const finMesAnterior = iso(new Date(Date.UTC(anio, mes - 1, 0)));

  const contar = (q: ReturnType<typeof base>) => q.then((r) => r.count ?? 0);
  const base = () =>
    sb.from("movimientos_extracto").select("id", { count: "exact", head: true }).eq("entidad_id", entidad.id);

  const [
    panel,
    saldos,
    gastosMes,
    gastosAnterior,
    sinClasificar,
    revisar,
    sinContabilizar,
    documentos,
    recientes,
  ] = await Promise.all([
    sb.rpc("fn_dashboard", { p_entidad: entidad.id, p_anio: anio, p_mes: mes }),
    sb.rpc("fn_saldos_cuentas", { p_entidad: entidad.id, p_hasta: iso(hoy) }),
    sb.rpc("fn_gastos_categorias", { p_entidad: entidad.id, p_desde: inicioMes, p_hasta: finMes }),
    sb.rpc("fn_gastos_categorias", {
      p_entidad: entidad.id,
      p_desde: inicioMesAnterior,
      p_hasta: finMesAnterior,
    }),
    contar(base().is("categoria_id", null)),
    contar(base().is("asiento_id", null).lt("confianza_ia", 0.7)),
    contar(base().is("asiento_id", null).not("categoria_id", "is", null)),
    sb
      .from("documentos")
      .select("estado")
      .eq("entidad_id", entidad.id)
      .in("estado", ["PENDIENTE", "PROCESANDO", "ERROR"]),
    sb
      .from("movimientos_extracto")
      .select(
        "id, fecha, descripcion, comercio, naturaleza, monto, asiento_id, categorias_gasto(nombre), cuentas_financieras(nombre)",
      )
      .eq("entidad_id", entidad.id)
      .order("fecha", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(8),
  ]);

  if (panel.error) {
    return (
      <Aviso tono="peligro" titulo="No se pudo calcular el panel">
        {panel.error.message}
      </Aviso>
    );
  }

  const d = panel.data as unknown as Dashboard;
  const r = d.resultados;
  const cuentas = (saldos.data ?? []) as SaldoCuenta[];
  const gastos = (gastosMes.data ?? []) as GastoCategoria[];
  const totalMes = gastos.reduce((s, g) => s + Number(g.total), 0);
  const totalAnterior = ((gastosAnterior.data ?? []) as GastoCategoria[]).reduce(
    (s, g) => s + Number(g.total),
    0,
  );
  const docs = documentos.data ?? [];
  const docsEnCurso = docs.filter((x) => x.estado !== "ERROR").length;
  const docsError = docs.filter((x) => x.estado === "ERROR").length;

  // Disponible = lo que hay en caja, bancos y cooperativas; deuda = tarjetas.
  // Ambos incluyen lo cargado aún sin contabilizar, que es lo que el usuario
  // espera ver el día que sube un estado de cuenta.
  const actual = (c: SaldoCuenta) => Number(c.saldo) + Number(c.pendiente);
  const disponibles = cuentas.filter((c) => c.tipo !== "TARJETA_CREDITO");
  const tarjetas = cuentas.filter((c) => c.tipo === "TARJETA_CREDITO");
  const disponible = disponibles.reduce((s, c) => s + actual(c), 0);
  const deuda = tarjetas.reduce((s, c) => s + actual(c), 0);

  const hayPendientes = sinClasificar + revisar + sinContabilizar + docsEnCurso + docsError > 0;

  return (
    <div className="space-y-8">
      <Encabezado
        antetitulo={`Ejercicio ${anio} · ${nombreMes(mes)}`}
        titulo="Panel"
        descripcion="Cómo están tus cuentas, en qué se va el dinero y qué falta revisar."
        acciones={
          <>
            <Link href="/informes" className={boton("secundario")}>
              <Scale size={16} /> Estados financieros
            </Link>
            <Link href="/impuestos" className={boton("secundario")}>
              <Receipt size={16} /> Impuestos
            </Link>
          </>
        }
      />

      {hayPendientes && (
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Pendiente
            cantidad={sinClasificar}
            texto="sin categoría"
            href="/movimientos?estado=sin_clasificar"
            tono="aviso"
          />
          <Pendiente
            cantidad={revisar}
            texto="con clasificación dudosa"
            href="/movimientos?estado=revisar"
            tono="aviso"
          />
          <Pendiente
            cantidad={sinContabilizar}
            texto="listos para contabilizar"
            href="/movimientos?estado=sin_contabilizar"
            tono="info"
          />
          <Pendiente
            cantidad={docsEnCurso + docsError}
            texto={
              docsError > 0
                ? `documento(s): ${docsEnCurso} en proceso, ${docsError} con error`
                : "documento(s) en proceso"
            }
            href="/ingesta"
            tono={docsError > 0 ? "peligro" : "info"}
          />
        </section>
      )}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Indicador
          etiqueta="Ingresos del ejercicio"
          valor={usd(r.ingresos)}
          tono="exito"
          icono={TrendingUp}
        />
        <Indicador
          etiqueta="Gastos del ejercicio"
          valor={usd(r.total_gastos)}
          detalle={`${usd(r.gastos_personales)} en gastos personales`}
          tono="peligro"
          icono={TrendingDown}
        />
        <Indicador
          etiqueta="Resultado"
          valor={usd(r.resultado_ejercicio)}
          tono={r.resultado_ejercicio >= 0 ? "exito" : "peligro"}
          icono={Scale}
          href="/informes#resultados"
        />
        <Indicador
          etiqueta={`IVA a pagar · ${nombreMes(mes)}`}
          valor={usd(d.iva.c619_impuesto_a_pagar)}
          detalle={`Crédito tributario acumulado ${usd(d.credito_tributario_iva)}`}
          tono={d.iva.c619_impuesto_a_pagar > 0 ? "aviso" : "exito"}
          icono={Receipt}
          href="/impuestos#iva"
        />
      </section>

      <div className="grid gap-6 xl:grid-cols-5">
        <Tarjeta
          className="xl:col-span-3"
          titulo="Cuentas"
          descripcion="Saldo contable más lo cargado pendiente de contabilizar."
          acciones={
            <div className="flex gap-4 text-xs">
              <span>
                <span className="text-slate-500">Disponible </span>
                <span className="font-semibold text-emerald-700">{usd(disponible)}</span>
              </span>
              <span>
                <span className="text-slate-500">Deuda en tarjetas </span>
                <span className="font-semibold text-rose-700">{usd(deuda)}</span>
              </span>
            </div>
          }
          sinRelleno
        >
          {cuentas.length === 0 ? (
            <Vacio icono={Wallet} titulo="No hay cuentas registradas" />
          ) : (
            <div className="grid divide-y divide-slate-100 md:grid-cols-2 md:divide-x md:divide-y-0">
              <ListaCuentas titulo="Efectivo, bancos y cooperativas" cuentas={disponibles} />
              <ListaCuentas titulo="Tarjetas de crédito" cuentas={tarjetas} />
            </div>
          )}
        </Tarjeta>

        <Tarjeta
          className="xl:col-span-2"
          titulo={`Gastos de ${nombreMes(mes)}`}
          descripcion={
            totalAnterior > 0
              ? `${usd(totalMes)} · el mes pasado fueron ${usd(totalAnterior)}`
              : usd(totalMes)
          }
        >
          {gastos.length === 0 ? (
            <Vacio
              titulo="Aún no hay gastos este mes"
              descripcion="Aparecen al cargar los estados de cuenta o dictar gastos en efectivo."
            />
          ) : (
            <ul className="space-y-3">
              {gastos.slice(0, 8).map((g) => {
                const pct = totalMes > 0 ? (Number(g.total) / totalMes) * 100 : 0;
                return (
                  <li key={g.categoria}>
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="truncate text-slate-700">{g.categoria}</span>
                      <span className="shrink-0 tabular-nums font-medium">{usd(g.total)}</span>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className={`h-full rounded-full ${g.subtipo === "PERSONAL" ? "bg-sky-500" : g.subtipo === "NO_DEDUCIBLE" ? "bg-slate-400" : "bg-emerald-500"}`}
                        style={{ width: `${Math.max(pct, 2)}%` }}
                      />
                    </div>
                  </li>
                );
              })}
              <li className="flex flex-wrap gap-3 pt-1 text-[11px] text-slate-500">
                <Leyenda color="bg-emerald-500">Deducible del negocio</Leyenda>
                <Leyenda color="bg-sky-500">Gasto personal</Leyenda>
                <Leyenda color="bg-slate-400">No deducible</Leyenda>
              </li>
            </ul>
          )}
        </Tarjeta>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Tarjeta
          className="xl:col-span-2"
          titulo="Últimos movimientos"
          acciones={
            <Link href="/movimientos" className={boton("fantasma", "sm")}>
              Ver todos <ArrowRight size={14} />
            </Link>
          }
          sinRelleno
        >
          <div className={tabla.contenedor}>
            <table className={tabla.tabla}>
              <tbody className={tabla.cuerpo}>
                {(recientes.data ?? []).map((m) => {
                  const cat = [m.categorias_gasto].flat()[0] as { nombre: string } | undefined;
                  const cta = [m.cuentas_financieras].flat()[0] as { nombre: string } | undefined;
                  return (
                    <tr key={m.id} className={tabla.fila}>
                      <td className={`${tabla.td} whitespace-nowrap text-xs text-slate-500`}>
                        {fecha(m.fecha)}
                      </td>
                      <td className={tabla.td}>
                        <div className="line-clamp-1 font-medium">{m.comercio ?? m.descripcion}</div>
                        <div className="line-clamp-1 text-xs text-slate-400">{cta?.nombre}</div>
                      </td>
                      <td className={tabla.td}>
                        {cat ? (
                          <Insignia>{cat.nombre}</Insignia>
                        ) : (
                          <Insignia tono="aviso">sin categoría</Insignia>
                        )}
                      </td>
                      <td
                        className={`${tabla.td} ${tabla.numero} font-medium ${m.naturaleza === "DEBITO" ? "text-slate-900" : "text-emerald-700"}`}
                      >
                        {m.naturaleza === "DEBITO" ? "−" : "+"}
                        {usd(m.monto)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Tarjeta>

        <Tarjeta titulo="Cartera">
          <dl className="space-y-3 text-sm">
            <Fila etiqueta="Por cobrar" valor={usd(d.cartera.por_cobrar)} clase="text-emerald-700" />
            <Fila etiqueta="Por pagar" valor={usd(d.cartera.por_pagar)} clase="text-rose-700" />
            <Fila
              etiqueta="Vencido"
              valor={usd(d.cartera.vencido)}
              clase={Number(d.cartera.vencido) > 0 ? "text-rose-700" : "text-slate-900"}
            />
          </dl>
          <Link href="/cartera" className={`${boton("secundario", "sm")} mt-5 w-full`}>
            Ir a cartera
          </Link>
        </Tarjeta>
      </div>
    </div>
  );
}

function ListaCuentas({ titulo, cuentas }: { titulo: string; cuentas: SaldoCuenta[] }) {
  // Las cuentas sin un solo movimiento se resumen al final: ocupan sitio y no
  // dicen nada, pero conviene saber que existen y no tienen datos.
  const conDatos = cuentas.filter((c) => c.ultimo_movimiento || Number(c.saldo) !== 0);
  const sinDatos = cuentas.length - conDatos.length;
  return (
    <div className="px-5 py-4">
      <h3 className="mb-2 text-xs font-medium text-slate-500">{titulo}</h3>
      <ul className="divide-y divide-slate-100">
        {conDatos.map((c) => {
          const Icono = ICONO_TIPO[c.tipo] ?? Wallet;
          const total = Number(c.saldo) + Number(c.pendiente);
          return (
            <li key={c.cuenta_id}>
              <Link
                href={`/movimientos?cuenta=${c.cuenta_id}`}
                className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-slate-50"
              >
                <Icono size={16} className="shrink-0 text-slate-400" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">{c.nombre}</div>
                  <div className="text-[11px] text-slate-400">
                    {c.ultimo_movimiento ? `al ${fecha(c.ultimo_movimiento)}` : "sin movimientos"}
                    {Number(c.movimientos_pendientes) > 0 &&
                      ` · ${c.movimientos_pendientes} por contabilizar`}
                  </div>
                </div>
                <span
                  className={`shrink-0 text-sm font-medium tabular-nums ${total < 0 ? "text-rose-700" : ""}`}
                >
                  {usd(total)}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      {sinDatos > 0 && (
        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-400">
          <FileWarning size={12} /> {sinDatos} cuenta(s) sin ningún estado cargado
        </p>
      )}
    </div>
  );
}

function Pendiente({
  cantidad,
  texto,
  href,
  tono,
}: {
  cantidad: number;
  texto: string;
  href: string;
  tono: "aviso" | "info" | "peligro";
}) {
  if (cantidad === 0) return null;
  const color =
    tono === "aviso"
      ? "border-amber-200 bg-amber-50 text-amber-900 hover:border-amber-300"
      : tono === "peligro"
        ? "border-rose-200 bg-rose-50 text-rose-900 hover:border-rose-300"
        : "border-sky-200 bg-sky-50 text-sky-900 hover:border-sky-300";
  return (
    <Link href={href} className={`flex items-center gap-3 rounded-xl border px-4 py-3 transition-colors ${color}`}>
      <AlertTriangle size={18} className="shrink-0 opacity-70" />
      <span className="min-w-0 flex-1 text-sm">
        <span className="text-lg font-semibold tabular-nums">{cantidad}</span> {texto}
      </span>
      <ArrowRight size={16} className="shrink-0 opacity-60" />
    </Link>
  );
}

function Fila({ etiqueta: e, valor, clase }: { etiqueta: string; valor: string; clase: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <dt className="text-slate-500">{e}</dt>
      <dd className={`font-semibold tabular-nums ${clase}`}>{valor}</dd>
    </div>
  );
}

function Leyenda({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-2 w-2 rounded-full ${color}`} />
      {children}
    </span>
  );
}

function SinEntidad() {
  return (
    <Tarjeta>
      <Vacio
        icono={Building2}
        titulo="Configura tu entidad contable"
        descripcion="Antes de registrar nada hay que crear la entidad: el RUC, el régimen tributario y la periodicidad del IVA. Al crearla se genera automáticamente su plan de cuentas y el catálogo de categorías de gasto."
        accion={
          <Link href="/ajustes" className={boton("primario")}>
            Ir a Ajustes
          </Link>
        }
      />
    </Tarjeta>
  );
}
