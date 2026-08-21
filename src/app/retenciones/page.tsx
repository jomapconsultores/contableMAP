"use client";

import { useCallback, useState } from "react";
import { usd, fecha } from "@/lib/formato";
import { useCarga } from "@/lib/carga";

interface Retencion {
  id: string;
  clase: "RECIBIDA" | "EFECTUADA";
  fecha: string;
  numero: string | null;
  ruc_contraparte: string;
  nombre_contraparte: string;
  base_renta: number;
  porc_renta: number;
  ret_renta: number;
  base_iva: number;
  porc_iva: number;
  ret_iva: number;
  ret_isd: number;
  total_retenido: number;
  asiento_id: string | null;
}

const HOY = () => new Date().toISOString().slice(0, 10);

export default function Retenciones() {
  const [filas, setFilas] = useState<Retencion[]>([]);
  const [abierto, setAbierto] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const pedir = useCallback(async (): Promise<Retencion[]> => {
    const j = await fetch("/api/retenciones").then((r) => r.json());
    if (!j.ok) throw new Error(j.error);
    return j.datos;
  }, []);

  const aplicar = useCallback((r: Retencion[] | Error) => {
    if (r instanceof Error) setError(r.message);
    else setFilas(r);
    setCargando(false);
  }, []);

  const recargar = useCarga(pedir, aplicar);

  // Tras guardar una retención: indicador de nuevo y vuelta a pedir.
  const cargar = useCallback(async () => {
    setCargando(true);
    await recargar();
  }, [recargar]);

  const recibidas = filas.filter((f) => f.clase === "RECIBIDA");
  const totalIva = recibidas.reduce((s, f) => s + Number(f.ret_iva), 0);
  const totalRenta = recibidas.reduce((s, f) => s + Number(f.ret_renta), 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Retenciones</h1>
          <p className="text-sm text-slate-600">
            Las que nos efectúan alimentan el crédito tributario de IVA y de
            renta; las que efectuamos como agente crean la obligación con el SRI.
          </p>
        </div>
        <button
          onClick={() => setAbierto(!abierto)}
          className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700"
        >
          {abierto ? "Cancelar" : "Registrar comprobante"}
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-xs uppercase tracking-wide text-slate-500">
            IVA retenido a nuestro favor
          </div>
          <div className="mt-1 text-xl font-semibold tabular-nums text-emerald-700">
            {usd(totalIva)}
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-xs uppercase tracking-wide text-slate-500">
            Renta retenida a nuestro favor
          </div>
          <div className="mt-1 text-xl font-semibold tabular-nums text-emerald-700">
            {usd(totalRenta)}
          </div>
        </div>
      </div>

      {aviso && (
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{aviso}</p>
      )}
      {error && <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>}

      {abierto && (
        <Formulario
          alGuardar={async (m) => {
            setAbierto(false);
            setAviso(m);
            await cargar();
          }}
          alFallar={setError}
        />
      )}

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">Fecha</th>
              <th className="px-3 py-2">Clase</th>
              <th className="px-3 py-2">Contraparte</th>
              <th className="px-3 py-2">Nº</th>
              <th className="px-3 py-2 text-right">Renta</th>
              <th className="px-3 py-2 text-right">IVA</th>
              <th className="px-3 py-2 text-right">ISD</th>
              <th className="px-3 py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {cargando && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-slate-500">
                  Cargando…
                </td>
              </tr>
            )}
            {!cargando && filas.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-slate-500">
                  No hay retenciones registradas.
                </td>
              </tr>
            )}
            {filas.map((f) => (
              <tr key={f.id} className="hover:bg-slate-50">
                <td className="whitespace-nowrap px-3 py-2 text-slate-600">{fecha(f.fecha)}</td>
                <td className="px-3 py-2">
                  <span
                    className={`rounded px-2 py-0.5 text-xs ${
                      f.clase === "RECIBIDA"
                        ? "bg-emerald-100 text-emerald-800"
                        : "bg-amber-100 text-amber-900"
                    }`}
                  >
                    {f.clase.toLowerCase()}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <div className="font-medium">{f.nombre_contraparte}</div>
                  <div className="text-xs text-slate-400">{f.ruc_contraparte}</div>
                </td>
                <td className="px-3 py-2 font-mono text-xs text-slate-500">{f.numero ?? "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums">{usd(f.ret_renta)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{usd(f.ret_iva)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{usd(f.ret_isd)}</td>
                <td className="px-3 py-2 text-right font-medium tabular-nums">
                  {usd(f.total_retenido)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Formulario({
  alGuardar,
  alFallar,
}: {
  alGuardar: (m: string) => Promise<void>;
  alFallar: (e: string) => void;
}) {
  const [ocupado, setOcupado] = useState(false);
  const [baseRenta, setBaseRenta] = useState("");
  const [porcRenta, setPorcRenta] = useState("");
  const [baseIva, setBaseIva] = useState("");
  const [porcIva, setPorcIva] = useState("");

  // El comprobante trae base y porcentaje; el valor retenido se deriva.
  const calc = (b: string, p: string) =>
    ((Number(b || 0) * Number(p || 0)) / 100).toFixed(2);

  const retRenta = calc(baseRenta, porcRenta);
  const retIva = calc(baseIva, porcIva);

  async function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setOcupado(true);
    const f = new FormData(e.currentTarget);

    const res = await fetch("/api/retenciones", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...Object.fromEntries(f.entries()),
        ret_renta: retRenta,
        ret_iva: retIva,
      }),
    });
    const json = await res.json();
    setOcupado(false);

    if (!json.ok) {
      alFallar(json.error);
      return;
    }
    await alGuardar(
      json.datos.aviso
        ? `Retención registrada, pero no se contabilizó: ${json.datos.aviso}`
        : `Retención registrada y contabilizada por ${usd(json.datos.total_retenido)}.`,
    );
  }

  return (
    <form
      onSubmit={enviar}
      className="grid gap-3 rounded-lg border border-slate-200 bg-white p-5 sm:grid-cols-4"
    >
      <label className="text-sm">
        <span className="text-slate-700">Clase</span>
        <select
          name="clase"
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="RECIBIDA">Recibida (nos retuvieron)</option>
          <option value="EFECTUADA">Efectuada (retuvimos)</option>
        </select>
      </label>

      <Campo etiqueta="Fecha" nombre="fecha" tipo="date" valor={HOY()} requerido />
      <Campo etiqueta="Nº comprobante" nombre="numero" />
      <Campo etiqueta="RUC contraparte" nombre="ruc_contraparte" requerido />
      <Campo etiqueta="Nombre contraparte" nombre="nombre_contraparte" requerido />

      <label className="text-sm">
        <span className="text-slate-700">Base renta</span>
        <input
          name="base_renta"
          type="number"
          step="0.01"
          value={baseRenta}
          onChange={(e) => setBaseRenta(e.target.value)}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
      </label>
      <label className="text-sm">
        <span className="text-slate-700">% renta</span>
        <input
          name="porc_renta"
          type="number"
          step="0.01"
          value={porcRenta}
          onChange={(e) => setPorcRenta(e.target.value)}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
      </label>
      <div className="text-sm">
        <span className="text-slate-700">Retenido renta</span>
        <div className="mt-1 rounded-md bg-slate-100 px-3 py-2 tabular-nums">{retRenta}</div>
      </div>

      <label className="text-sm">
        <span className="text-slate-700">Base IVA</span>
        <input
          name="base_iva"
          type="number"
          step="0.01"
          value={baseIva}
          onChange={(e) => setBaseIva(e.target.value)}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
      </label>
      <label className="text-sm">
        <span className="text-slate-700">% IVA</span>
        <input
          name="porc_iva"
          type="number"
          step="0.01"
          value={porcIva}
          onChange={(e) => setPorcIva(e.target.value)}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
      </label>
      <div className="text-sm">
        <span className="text-slate-700">Retenido IVA</span>
        <div className="mt-1 rounded-md bg-slate-100 px-3 py-2 tabular-nums">{retIva}</div>
      </div>

      <Campo etiqueta="ISD" nombre="ret_isd" tipo="number" paso="0.01" valor="0" />

      <button
        type="submit"
        disabled={ocupado}
        className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50 sm:col-span-4"
      >
        {ocupado ? "Guardando…" : "Registrar y contabilizar"}
      </button>
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
