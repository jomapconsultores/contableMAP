"use client";

import { useEffect, useState } from "react";
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

export default function Cartera() {
  const [docs, setDocs] = useState<Documento[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/informes?tipo=cartera")
      .then((r) => r.json())
      .then((j) => (j.ok ? setDocs(j.datos) : setError(j.error)))
      .catch((e) => setError(String(e)))
      .finally(() => setCargando(false));
  }, []);

  const cobrar = docs.filter((d) => d.clase === "CXC" || d.clase === "DOC_COBRAR");
  const pagar = docs.filter((d) => d.clase === "CXP" || d.clase === "DOC_PAGAR");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Cartera</h1>
        <p className="text-sm text-slate-600">
          Cuentas y documentos por cobrar y por pagar. Se generan solos cuando
          una compra o una venta se registra a crédito.
        </p>
      </div>

      {error && <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>}
      {cargando && <p className="text-sm text-slate-500">Cargando…</p>}

      <Grupo titulo="Por cobrar" docs={cobrar} tono="verde" />
      <Grupo titulo="Por pagar" docs={pagar} tono="rojo" />
    </div>
  );
}

function Grupo({
  titulo,
  docs,
  tono,
}: {
  titulo: string;
  docs: Documento[];
  tono: "verde" | "rojo";
}) {
  const total = docs.reduce((s, d) => s + Number(d.saldo), 0);
  const vencido = docs
    .filter((d) => d.dias_vencido > 0)
    .reduce((s, d) => s + Number(d.saldo), 0);

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
          {vencido > 0 && (
            <span className="ml-3 text-rose-700">vencido {usd(vencido)}</span>
          )}
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
