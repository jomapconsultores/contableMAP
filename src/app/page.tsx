import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";
import { usd, nombreMes } from "@/lib/formato";

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
  pendientes: {
    movimientos_sin_clasificar: number;
    documentos_por_procesar: number;
  };
}

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

  const { data, error } = await sb.rpc("fn_dashboard", {
    p_entidad: entidad.id,
    p_anio: anio,
    p_mes: mes,
  });

  if (error) {
    return (
      <Aviso titulo="No se pudo calcular el panel">
        {error.message}
      </Aviso>
    );
  }

  const d = data as unknown as Dashboard;
  const r = d.resultados;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{entidad.razon_social}</h1>
        <p className="text-sm text-slate-500">
          RUC {entidad.ruc} · ejercicio {anio}, corte a {nombreMes(mes)}
        </p>
      </div>

      {(d.pendientes.movimientos_sin_clasificar > 0 ||
        d.pendientes.documentos_por_procesar > 0) && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong>Pendiente de tu revisión:</strong>{" "}
          {d.pendientes.documentos_por_procesar > 0 && (
            <>
              {d.pendientes.documentos_por_procesar} documento(s) por procesar
              {d.pendientes.movimientos_sin_clasificar > 0 && " · "}
            </>
          )}
          {d.pendientes.movimientos_sin_clasificar > 0 && (
            <>
              {d.pendientes.movimientos_sin_clasificar} movimiento(s) sin clasificar{" "}
              <Link href="/movimientos" className="font-medium underline">
                revisar
              </Link>
            </>
          )}
        </div>
      )}

      <section>
        <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-slate-500">
          Resultados del ejercicio
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Tarjeta titulo="Ingresos" valor={usd(r.ingresos)} tono="verde" />
          <Tarjeta titulo="Gastos" valor={usd(r.total_gastos)} tono="rojo" />
          <Tarjeta
            titulo="Resultado"
            valor={usd(r.resultado_ejercicio)}
            tono={r.resultado_ejercicio >= 0 ? "verde" : "rojo"}
          />
          <Tarjeta
            titulo="Gastos personales"
            valor={usd(r.gastos_personales)}
            nota="deducibles de renta"
          />
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-slate-500">
          IVA de {nombreMes(mes)}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Tarjeta titulo="Impuesto causado" valor={usd(d.iva.c601_impuesto_causado)} />
          <Tarjeta
            titulo="A pagar"
            valor={usd(d.iva.c619_impuesto_a_pagar)}
            tono={d.iva.c619_impuesto_a_pagar > 0 ? "rojo" : "verde"}
          />
          <Tarjeta
            titulo="Crédito tributario"
            valor={usd(d.credito_tributario_iva)}
            nota="acumulado a favor"
          />
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-slate-500">
          Cartera
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Tarjeta titulo="Por cobrar" valor={usd(d.cartera.por_cobrar)} tono="verde" />
          <Tarjeta titulo="Por pagar" valor={usd(d.cartera.por_pagar)} tono="rojo" />
          <Tarjeta
            titulo="Vencido"
            valor={usd(d.cartera.vencido)}
            tono={Number(d.cartera.vencido) > 0 ? "rojo" : undefined}
          />
        </div>
      </section>

      <div className="flex flex-wrap gap-3 pt-2">
        <Link
          href="/ingesta"
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700"
        >
          Ingresar datos
        </Link>
        <Link
          href="/informes"
          className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium transition-colors hover:bg-slate-100"
        >
          Ver estados financieros
        </Link>
      </div>
    </div>
  );
}

function Tarjeta({
  titulo,
  valor,
  nota,
  tono,
}: {
  titulo: string;
  valor: string;
  nota?: string;
  tono?: "verde" | "rojo";
}) {
  const color =
    tono === "verde" ? "text-emerald-700" : tono === "rojo" ? "text-rose-700" : "text-slate-900";
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="text-xs uppercase tracking-wide text-slate-500">{titulo}</div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${color}`}>{valor}</div>
      {nota && <div className="mt-0.5 text-xs text-slate-400">{nota}</div>}
    </div>
  );
}

function Aviso({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-rose-200 bg-rose-50 p-4">
      <h2 className="font-medium text-rose-900">{titulo}</h2>
      <p className="mt-1 text-sm text-rose-800">{children}</p>
    </div>
  );
}

function SinEntidad() {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-6">
      <h1 className="text-xl font-semibold">Configura tu entidad contable</h1>
      <p className="mt-2 max-w-prose text-sm text-slate-600">
        Antes de registrar nada hay que crear la entidad: el RUC, el régimen
        tributario y la periodicidad del IVA. Al crearla se genera
        automáticamente su plan de cuentas y el catálogo de categorías de gasto.
      </p>
      <Link
        href="/ajustes"
        className="mt-4 inline-block rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
      >
        Ir a Ajustes
      </Link>
    </div>
  );
}
