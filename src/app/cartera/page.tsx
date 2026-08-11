"use client";

import { useCallback, useEffect, useState } from "react";
import { usd, fecha } from "@/lib/formato";

interface Documento {
  id: string;
  clase: "CXC" | "CXP" | "DOC_COBRAR" | "DOC_PAGAR";
  nombre_tercero: string;
  descripcion: string;
  referencia: string | null;
  fecha_emision: string;
  fecha_vencimiento: string;
  monto_original: number;
  saldo: number;
  estado: string;
  dias_vencido: number;
  rango: string;
}

interface CuentaFinanciera {
  id: string;
  nombre: string;
  tipo: string;
}

const NOMBRE_CLASE: Record<string, string> = {
  CXC: "Cuenta por cobrar",
  DOC_COBRAR: "Documento por cobrar",
  CXP: "Cuenta por pagar",
  DOC_PAGAR: "Documento por pagar",
};

const NOMBRE_RANGO: Record<string, string> = {
  POR_VENCER: "Por vencer",
  "1_30": "1 a 30 días",
  "31_60": "31 a 60 días",
  "61_90": "61 a 90 días",
  MAS_90: "Más de 90 días",
};

const HOY = () => new Date().toISOString().slice(0, 10);

export default function Cartera() {
  const [docs, setDocs] = useState<Documento[]>([]);
  const [cuentas, setCuentas] = useState<CuentaFinanciera[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [nuevoAbierto, setNuevoAbierto] = useState(false);
  const [abonando, setAbonando] = useState<Documento | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const [c, f] = await Promise.all([
        fetch("/api/cartera").then((r) => r.json()),
        fetch("/api/cuentas").then((r) => r.json()),
      ]);
      if (!c.ok) throw new Error(c.error);
      setDocs(c.datos);
      if (f.ok) setCuentas(f.datos);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const cobrar = docs.filter((d) => d.clase === "CXC" || d.clase === "DOC_COBRAR");
  const pagar = docs.filter((d) => d.clase === "CXP" || d.clase === "DOC_PAGAR");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Cartera</h1>
          <p className="text-sm text-slate-600">
            Cuentas y documentos por cobrar y por pagar. Los de facturas
            aparecen solos; aquí se añaden préstamos, letras y pagarés.
          </p>
        </div>
        <button
          onClick={() => setNuevoAbierto(!nuevoAbierto)}
          className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700"
        >
          {nuevoAbierto ? "Cancelar" : "Nuevo documento"}
        </button>
      </div>

      {aviso && (
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{aviso}</p>
      )}
      {error && <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>}

      {nuevoAbierto && (
        <FormularioDocumento
          cuentas={cuentas}
          alGuardar={async (mensaje) => {
            setNuevoAbierto(false);
            setAviso(mensaje);
            await cargar();
          }}
          alFallar={setError}
        />
      )}

      {abonando && (
        <FormularioAbono
          documento={abonando}
          cuentas={cuentas}
          alCerrar={() => setAbonando(null)}
          alGuardar={async (mensaje) => {
            setAbonando(null);
            setAviso(mensaje);
            await cargar();
          }}
          alFallar={setError}
        />
      )}

      {cargando && <p className="text-sm text-slate-500">Cargando…</p>}

      <Grupo titulo="Por cobrar" docs={cobrar} tono="verde" alAbonar={setAbonando} />
      <Grupo titulo="Por pagar" docs={pagar} tono="rojo" alAbonar={setAbonando} />
    </div>
  );
}

function Grupo({
  titulo,
  docs,
  tono,
  alAbonar,
}: {
  titulo: string;
  docs: Documento[];
  tono: "verde" | "rojo";
  alAbonar: (d: Documento) => void;
}) {
  const total = docs.reduce((s, d) => s + Number(d.saldo), 0);
  const vencido = docs.filter((d) => d.dias_vencido > 0).reduce((s, d) => s + Number(d.saldo), 0);

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-medium">{titulo}</h2>
        <div className="text-sm">
          <span
            className={`font-semibold tabular-nums ${tono === "verde" ? "text-emerald-700" : "text-rose-700"}`}
          >
            {usd(total)}
          </span>
          {vencido > 0 && <span className="ml-3 text-rose-700">vencido {usd(vencido)}</span>}
        </div>
      </div>

      {docs.length === 0 ? (
        <p className="text-sm text-slate-500">Nada pendiente.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="py-2">Tercero</th>
                <th className="py-2">Documento</th>
                <th className="py-2">Vence</th>
                <th className="py-2">Antigüedad</th>
                <th className="py-2 text-right">Original</th>
                <th className="py-2 text-right">Saldo</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {docs.map((d) => (
                <tr key={d.id}>
                  <td className="py-2">
                    <div className="font-medium">{d.nombre_tercero}</div>
                    <div className="text-xs text-slate-400">{NOMBRE_CLASE[d.clase]}</div>
                  </td>
                  <td className="py-2">
                    {d.descripcion}
                    {d.referencia && (
                      <span className="ml-1 text-xs text-slate-400">{d.referencia}</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap py-2 text-slate-600">
                    {fecha(d.fecha_vencimiento)}
                  </td>
                  <td className="py-2">
                    <span
                      className={`rounded px-2 py-0.5 text-xs ${
                        d.rango === "POR_VENCER"
                          ? "bg-slate-100 text-slate-600"
                          : "bg-rose-100 text-rose-800"
                      }`}
                    >
                      {NOMBRE_RANGO[d.rango] ?? d.rango}
                    </span>
                  </td>
                  <td className="py-2 text-right tabular-nums text-slate-500">
                    {usd(d.monto_original)}
                  </td>
                  <td className="py-2 text-right font-medium tabular-nums">{usd(d.saldo)}</td>
                  <td className="py-2 text-right">
                    <button
                      onClick={() => alAbonar(d)}
                      className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100"
                    >
                      {d.clase === "CXC" || d.clase === "DOC_COBRAR" ? "Cobrar" : "Pagar"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function FormularioDocumento({
  cuentas,
  alGuardar,
  alFallar,
}: {
  cuentas: CuentaFinanciera[];
  alGuardar: (mensaje: string) => Promise<void>;
  alFallar: (e: string) => void;
}) {
  const [ocupado, setOcupado] = useState(false);

  async function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setOcupado(true);
    const f = new FormData(e.currentTarget);

    const res = await fetch("/api/cartera", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(f.entries())),
    });
    const json = await res.json();
    setOcupado(false);

    if (!json.ok) {
      alFallar(json.error);
      return;
    }
    await alGuardar(
      json.datos.aviso
        ? `Documento registrado, pero no se contabilizó: ${json.datos.aviso}`
        : "Documento registrado y contabilizado.",
    );
  }

  return (
    <form
      onSubmit={enviar}
      className="grid gap-3 rounded-lg border border-slate-200 bg-white p-5 sm:grid-cols-3"
    >
      <label className="text-sm">
        <span className="text-slate-700">Clase</span>
        <select
          name="clase"
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="DOC_COBRAR">Documento por cobrar</option>
          <option value="CXC">Cuenta por cobrar</option>
          <option value="DOC_PAGAR">Documento por pagar</option>
          <option value="CXP">Cuenta por pagar</option>
        </select>
      </label>

      <Campo etiqueta="Tercero" nombre="nombre_tercero" requerido />
      <Campo etiqueta="Identificación" nombre="identificacion" />
      <Campo etiqueta="Descripción" nombre="descripcion" requerido />
      <Campo etiqueta="Referencia" nombre="referencia" />
      <Campo etiqueta="Monto" nombre="monto_original" tipo="number" paso="0.01" requerido />
      <Campo etiqueta="Emisión" nombre="fecha_emision" tipo="date" valor={HOY()} requerido />
      <Campo etiqueta="Vencimiento" nombre="fecha_vencimiento" tipo="date" requerido />

      <label className="text-sm">
        <span className="text-slate-700">Contrapartida</span>
        <select
          name="cuenta_financiera_id"
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="">Bancos (por defecto)</option>
          {cuentas.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nombre}
            </option>
          ))}
        </select>
      </label>

      <button
        type="submit"
        disabled={ocupado}
        className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50 sm:col-span-3"
      >
        {ocupado ? "Guardando…" : "Registrar y contabilizar"}
      </button>
    </form>
  );
}

function FormularioAbono({
  documento,
  cuentas,
  alCerrar,
  alGuardar,
  alFallar,
}: {
  documento: Documento;
  cuentas: CuentaFinanciera[];
  alCerrar: () => void;
  alGuardar: (mensaje: string) => Promise<void>;
  alFallar: (e: string) => void;
}) {
  const [ocupado, setOcupado] = useState(false);
  const cobro = documento.clase === "CXC" || documento.clase === "DOC_COBRAR";

  async function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setOcupado(true);
    const f = new FormData(e.currentTarget);

    const res = await fetch("/api/cartera", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cartera_id: documento.id,
        ...Object.fromEntries(f.entries()),
      }),
    });
    const json = await res.json();
    setOcupado(false);

    if (!json.ok) {
      alFallar(json.error);
      return;
    }
    await alGuardar(
      `${cobro ? "Cobro" : "Pago"} registrado. Saldo pendiente: ${usd(json.datos.saldo)}.`,
    );
  }

  return (
    <form
      onSubmit={enviar}
      className="grid gap-3 rounded-lg border border-emerald-300 bg-emerald-50 p-5 sm:grid-cols-4"
    >
      <p className="text-sm sm:col-span-4">
        <strong>{cobro ? "Cobrar" : "Pagar"}</strong> · {documento.nombre_tercero} ·{" "}
        {documento.descripcion} · saldo {usd(documento.saldo)}
      </p>

      <Campo
        etiqueta="Monto"
        nombre="monto"
        tipo="number"
        paso="0.01"
        valor={String(documento.saldo)}
        requerido
      />
      <Campo etiqueta="Interés" nombre="interes" tipo="number" paso="0.01" valor="0" />
      <Campo etiqueta="Fecha" nombre="fecha" tipo="date" valor={HOY()} requerido />

      <label className="text-sm">
        <span className="text-slate-700">Cuenta</span>
        <select
          name="cuenta_financiera_id"
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="">Bancos (por defecto)</option>
          {cuentas.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nombre}
            </option>
          ))}
        </select>
      </label>

      <div className="flex gap-2 sm:col-span-4">
        <button
          type="submit"
          disabled={ocupado}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {ocupado ? "Guardando…" : "Registrar"}
        </button>
        <button
          type="button"
          onClick={alCerrar}
          className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-100"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}

function Campo({
  etiqueta,
  nombre,
  tipo = "text",
  paso,
  valor,
  requerido,
}: {
  etiqueta: string;
  nombre: string;
  tipo?: string;
  paso?: string;
  valor?: string;
  requerido?: boolean;
}) {
  return (
    <label className="text-sm">
      <span className="text-slate-700">{etiqueta}</span>
      <input
        name={nombre}
        type={tipo}
        step={paso}
        defaultValue={valor}
        required={requerido}
        className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500"
      />
    </label>
  );
}
