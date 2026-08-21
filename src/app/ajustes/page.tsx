"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { useCarga } from "@/lib/carga";

interface Entidad {
  id: string;
  ruc: string;
  razon_social: string;
  regimen: string;
  periodicidad_iva: string;
  obligado_contabilidad: boolean;
}

interface Cuenta {
  id: string;
  nombre: string;
  tipo: string;
  institucion: string | null;
}

export default function Ajustes() {
  const [entidades, setEntidades] = useState<Entidad[]>([]);
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [cargando, setCargando] = useState(true);

  const pedir = useCallback(async () => {
    const e = await fetch("/api/entidades").then((r) => r.json());
    const hayEntidades = e.ok && e.datos.length > 0;
    const c = hayEntidades
      ? await fetch("/api/cuentas").then((r) => r.json())
      : { ok: false };
    return {
      entidades: e.ok ? (e.datos as Entidad[]) : null,
      cuentas: c.ok ? (c.datos as Cuenta[]) : null,
    };
  }, []);

  const aplicar = useCallback(
    (r: { entidades: Entidad[] | null; cuentas: Cuenta[] | null } | Error) => {
      if (!(r instanceof Error)) {
        if (r.entidades) setEntidades(r.entidades);
        if (r.cuentas) setCuentas(r.cuentas);
      }
      setCargando(false);
    },
    [],
  );

  const recargar = useCarga(pedir, aplicar);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Ajustes</h1>
      {cargando ? (
        <p className="text-sm text-slate-500">Cargando…</p>
      ) : (
        <>
          <SeccionEntidades entidades={entidades} alCrear={recargar} />
          {entidades.length > 0 && (
            <SeccionCuentas cuentas={cuentas} alCrear={recargar} />
          )}
        </>
      )}
    </div>
  );
}

function SeccionEntidades({
  entidades,
  alCrear,
}: {
  entidades: Entidad[];
  alCrear: () => Promise<void>;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(entidades.length === 0);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function crear(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setOcupado(true);
    setError(null);
    const f = new FormData(e.currentTarget);

    const res = await fetch("/api/entidades", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ruc: f.get("ruc"),
        razon_social: f.get("razon_social"),
        regimen: f.get("regimen"),
        periodicidad_iva: f.get("periodicidad_iva"),
        obligado_contabilidad: f.get("obligado_contabilidad") === "on",
      }),
    });
    const json = await res.json();
    setOcupado(false);

    if (!json.ok) {
      setError(json.error);
      return;
    }
    setAbierto(false);
    await alCrear();
    router.refresh();
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-medium">Entidad contable</h2>
        <button
          onClick={() => setAbierto(!abierto)}
          className="text-sm text-emerald-700 underline"
        >
          {abierto ? "Cancelar" : "Añadir"}
        </button>
      </div>

      {entidades.length > 0 && (
        <ul className="mt-3 divide-y divide-slate-100 text-sm">
          {entidades.map((e) => (
            <li key={e.id} className="py-2">
              <div className="font-medium">{e.razon_social}</div>
              <div className="text-xs text-slate-500">
                RUC {e.ruc} · {e.regimen.replace(/_/g, " ").toLowerCase()} · IVA{" "}
                {e.periodicidad_iva.toLowerCase()}
                {e.obligado_contabilidad && " · obligado a llevar contabilidad"}
              </div>
            </li>
          ))}
        </ul>
      )}

      {abierto && (
        <form onSubmit={crear} className="mt-4 grid gap-3 sm:grid-cols-2">
          <Campo etiqueta="RUC o cédula" nombre="ruc" requerido pattern="\d{10,13}" />
          <Campo etiqueta="Razón social" nombre="razon_social" requerido />

          <label className="block text-sm">
            <span className="text-slate-700">Régimen</span>
            <select
              name="regimen"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="GENERAL">General</option>
              <option value="RIMPE_EMPRENDEDOR">RIMPE emprendedor</option>
              <option value="RIMPE_NEGOCIO_POPULAR">RIMPE negocio popular</option>
            </select>
          </label>

          <label className="block text-sm">
            <span className="text-slate-700">Periodicidad del IVA</span>
            <select
              name="periodicidad_iva"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="MENSUAL">Mensual</option>
              <option value="SEMESTRAL">Semestral</option>
            </select>
          </label>

          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" name="obligado_contabilidad" />
            <span>Obligado a llevar contabilidad</span>
          </label>

          {error && (
            <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800 sm:col-span-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={ocupado}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50 sm:col-span-2"
          >
            {ocupado ? "Creando…" : "Crear entidad"}
          </button>
          <p className="text-xs text-slate-500 sm:col-span-2">
            Al crearla se genera automáticamente su plan de cuentas y el
            catálogo de categorías de gasto.
          </p>
        </form>
      )}
    </section>
  );
}

function SeccionCuentas({
  cuentas,
  alCrear,
}: {
  cuentas: Cuenta[];
  alCrear: () => Promise<void>;
}) {
  const [abierto, setAbierto] = useState(cuentas.length === 0);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function crear(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setOcupado(true);
    setError(null);
    const f = new FormData(e.currentTarget);

    const res = await fetch("/api/cuentas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nombre: f.get("nombre"),
        tipo: f.get("tipo"),
        institucion: f.get("institucion"),
        numero: f.get("numero"),
      }),
    });
    const json = await res.json();
    setOcupado(false);

    if (!json.ok) {
      setError(json.error);
      return;
    }
    setAbierto(false);
    await alCrear();
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-medium">Cuentas financieras</h2>
        <button
          onClick={() => setAbierto(!abierto)}
          className="text-sm text-emerald-700 underline"
        >
          {abierto ? "Cancelar" : "Añadir"}
        </button>
      </div>
      <p className="mt-1 text-sm text-slate-500">
        Bancos, tarjetas de crédito y cooperativas. Cada estado de cuenta que
        cargues se asocia a una de ellas.
      </p>

      {cuentas.length > 0 && (
        <ul className="mt-3 divide-y divide-slate-100 text-sm">
          {cuentas.map((c) => (
            <li key={c.id} className="flex justify-between py-2">
              <span className="font-medium">{c.nombre}</span>
              <span className="text-xs text-slate-500">
                {c.tipo.replace(/_/g, " ").toLowerCase()}
                {c.institucion && ` · ${c.institucion}`}
              </span>
            </li>
          ))}
        </ul>
      )}

      {abierto && (
        <form onSubmit={crear} className="mt-4 grid gap-3 sm:grid-cols-2">
          <Campo etiqueta="Nombre" nombre="nombre" requerido />
          <label className="block text-sm">
            <span className="text-slate-700">Tipo</span>
            <select
              name="tipo"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="BANCO">Banco</option>
              <option value="TARJETA_CREDITO">Tarjeta de crédito</option>
              <option value="COOPERATIVA">Cooperativa</option>
              <option value="CAJA">Caja</option>
              <option value="INVERSION">Inversión</option>
            </select>
          </label>
          <Campo etiqueta="Institución" nombre="institucion" />
          <Campo etiqueta="Número (últimos dígitos)" nombre="numero" />

          {error && (
            <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800 sm:col-span-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={ocupado}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50 sm:col-span-2"
          >
            {ocupado ? "Creando…" : "Crear cuenta"}
          </button>
        </form>
      )}
    </section>
  );
}

function Campo({
  etiqueta,
  nombre,
  requerido,
  pattern,
}: {
  etiqueta: string;
  nombre: string;
  requerido?: boolean;
  pattern?: string;
}) {
  return (
    <label className="block text-sm">
      <span className="text-slate-700">{etiqueta}</span>
      <input
        name={nombre}
        required={requerido}
        pattern={pattern}
        className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500"
      />
    </label>
  );
}
