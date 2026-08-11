"use client";

import { useCallback, useEffect, useState } from "react";
import { usd, fecha } from "@/lib/formato";

interface Comprobante {
  id: string;
  fecha: string;
  numero: string;
  tipo_comprobante: string;
  nombre_proveedor?: string;
  ruc_proveedor?: string;
  razon_social_cliente?: string;
  id_cliente?: string;
  base_0: number;
  base_5: number;
  base_8: number;
  base_15: number;
  no_objeto_iva: number;
  exento_iva: number;
  iva_5: number;
  iva_8: number;
  iva_15: number;
  total: number;
  categoria_id?: string | null;
  categorias_gasto?: { nombre: string } | null;
  rubro_personal?: string | null;
  da_credito_iva?: boolean;
  deducible_ir?: boolean;
  a_credito: boolean;
  asiento_id: string | null;
  estado: string;
  confianza_ia?: number | null;
}

interface Categoria {
  id: string;
  nombre: string;
}

export default function Comprobantes() {
  const [clase, setClase] = useState<"compras" | "ventas">("compras");
  const [soloPendientes, setSoloPendientes] = useState(false);
  const [filas, setFilas] = useState<Comprobante[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [cargando, setCargando] = useState(true);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const estado = soloPendientes ? "&estado=sin_contabilizar" : "";
      const [c, k] = await Promise.all([
        fetch(`/api/comprobantes?clase=${clase}${estado}`).then((r) => r.json()),
        fetch("/api/categorias").then((r) => r.json()),
      ]);
      if (!c.ok) throw new Error(c.error);
      setFilas(c.datos);
      if (k.ok) setCategorias(k.datos);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar");
    } finally {
      setCargando(false);
    }
  }, [clase, soloPendientes]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function contabilizar() {
    setOcupado(true);
    setAviso(null);
    setError(null);
    try {
      const res = await fetch("/api/comprobantes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clase }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error);

      setAviso(
        `${json.datos.contabilizados} de ${json.datos.pendientes} comprobantes contabilizados.` +
          (json.datos.errores.length
            ? ` ${json.datos.errores.length} con error: ${json.datos.errores[0].error}`
            : ""),
      );
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error inesperado");
    } finally {
      setOcupado(false);
    }
  }

  async function actualizar(id: string, cambios: Record<string, unknown>) {
    const res = await fetch("/api/comprobantes", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clase, id, ...cambios }),
    });
    const json = await res.json();
    if (!json.ok) {
      setError(json.error);
      return;
    }
    await cargar();
  }

  const esCompra = clase === "compras";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Comprobantes</h1>
          <p className="text-sm text-slate-600">
            Facturas extraídas de documentos o dictadas. Aquí se ajusta el
            tratamiento tributario y se convierten en asientos.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-md border border-slate-300 bg-white text-sm">
            {(["compras", "ventas"] as const).map((c) => (
              <button
                key={c}
                onClick={() => setClase(c)}
                className={`px-3 py-2 first:rounded-l-md last:rounded-r-md ${
                  clase === c ? "bg-emerald-600 text-white" : "hover:bg-slate-100"
                }`}
              >
                {c === "compras" ? "Compras" : "Ventas"}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-1.5 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={soloPendientes}
              onChange={(e) => setSoloPendientes(e.target.checked)}
            />
            Solo sin contabilizar
          </label>
          <button
            onClick={contabilizar}
            disabled={ocupado}
            className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            Contabilizar pendientes
          </button>
        </div>
      </div>

      {aviso && (
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{aviso}</p>
      )}
      {error && <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>}

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">Fecha</th>
              <th className="px-3 py-2">{esCompra ? "Proveedor" : "Cliente"}</th>
              <th className="px-3 py-2">Nº</th>
              <th className="px-3 py-2 text-right">Base</th>
              <th className="px-3 py-2 text-right">IVA</th>
              <th className="px-3 py-2 text-right">Total</th>
              {esCompra && <th className="px-3 py-2">Categoría</th>}
              {esCompra && <th className="px-3 py-2 text-center">Créd. IVA</th>}
              <th className="px-3 py-2">Estado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {cargando && (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-slate-500">
                  Cargando…
                </td>
              </tr>
            )}
            {!cargando && filas.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-slate-500">
                  No hay comprobantes registrados.
                </td>
              </tr>
            )}
            {filas.map((f) => {
              const base =
                Number(f.base_0) + Number(f.base_5) + Number(f.base_8) + Number(f.base_15) +
                Number(f.no_objeto_iva) + Number(f.exento_iva);
              const iva = Number(f.iva_5) + Number(f.iva_8) + Number(f.iva_15);
              const bloqueado = Boolean(f.asiento_id);

              return (
                <tr key={f.id} className="hover:bg-slate-50">
                  <td className="whitespace-nowrap px-3 py-2 text-slate-600">{fecha(f.fecha)}</td>
                  <td className="px-3 py-2">
                    <div className="font-medium">
                      {esCompra ? f.nombre_proveedor : f.razon_social_cliente}
                    </div>
                    <div className="text-xs text-slate-400">
                      {esCompra ? f.ruc_proveedor : f.id_cliente}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-slate-500">
                    {f.numero}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{usd(base)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-500">{usd(iva)}</td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums">{usd(f.total)}</td>

                  {esCompra && (
                    <td className="px-3 py-2">
                      <select
                        value={f.categoria_id ?? ""}
                        disabled={bloqueado}
                        onChange={(e) => actualizar(f.id, { categoria_id: e.target.value })}
                        className="w-40 rounded border border-slate-300 px-2 py-1 text-xs disabled:bg-slate-100"
                      >
                        <option value="">— sin clasificar —</option>
                        {categorias.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.nombre}
                          </option>
                        ))}
                      </select>
                      {f.rubro_personal && (
                        <div className="mt-0.5 text-[11px] text-emerald-700">
                          gasto personal · {f.rubro_personal.toLowerCase()}
                        </div>
                      )}
                    </td>
                  )}

                  {esCompra && (
                    <td className="px-3 py-2 text-center">
                      <input
                        type="checkbox"
                        checked={Boolean(f.da_credito_iva)}
                        disabled={bloqueado}
                        onChange={(e) => actualizar(f.id, { da_credito_iva: e.target.checked })}
                        title="Da derecho a crédito tributario de IVA"
                      />
                    </td>
                  )}

                  <td className="whitespace-nowrap px-3 py-2 text-xs">
                    {bloqueado ? (
                      <span className="rounded bg-emerald-100 px-2 py-0.5 text-emerald-800">
                        contabilizado
                      </span>
                    ) : f.a_credito ? (
                      <span className="rounded bg-sky-100 px-2 py-0.5 text-sky-800">a crédito</span>
                    ) : (
                      <span className="text-slate-400">pendiente</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-slate-500">
        Cambiar la categoría de una compra guarda la corrección en el mapa por
        RUC: las siguientes facturas de ese proveedor se clasificarán igual.
      </p>
    </div>
  );
}
