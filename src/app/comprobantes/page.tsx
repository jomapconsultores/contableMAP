"use client";

import { Suspense, useCallback, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { usd, fecha } from "@/lib/formato";
import { useCarga } from "@/lib/carga";
import { CheckCheck, FileText } from "lucide-react";
import {
  Aviso,
  Encabezado,
  Esqueleto,
  Insignia,
  Tarjeta,
  Vacio,
  boton,
  campo,
  tabla,
} from "@/components/ui";

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

/**
 * La pestaña vive en la URL y no en el estado del componente: así el submenú
 * de la barra lateral puede entrar directamente en compras o en ventas, y la
 * pantalla se puede enlazar y recargar sin perder dónde estabas.
 */
export default function Comprobantes() {
  return (
    <Suspense fallback={<Esqueleto className="h-96 w-full" />}>
      <Listado />
    </Suspense>
  );
}

function Listado() {
  const router = useRouter();
  const params = useSearchParams();
  const clase: "compras" | "ventas" = params.get("clase") === "ventas" ? "ventas" : "compras";
  const [soloPendientes, setSoloPendientes] = useState(false);
  const [filas, setFilas] = useState<Comprobante[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [cargando, setCargando] = useState(true);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pedir = useCallback(async () => {
    const estado = soloPendientes ? "&estado=sin_contabilizar" : "";
    const [c, k] = await Promise.all([
      fetch(`/api/comprobantes?clase=${clase}${estado}`).then((r) => r.json()),
      fetch("/api/categorias").then((r) => r.json()),
    ]);
    if (!c.ok) throw new Error(c.error);
    return {
      filas: c.datos as Comprobante[],
      categorias: k.ok ? (k.datos as Categoria[]) : null,
    };
  }, [clase, soloPendientes]);

  const aplicar = useCallback(
    (r: { filas: Comprobante[]; categorias: Categoria[] | null } | Error) => {
      if (r instanceof Error) {
        setError(r.message);
      } else {
        setError(null);
        setFilas(r.filas);
        if (r.categorias) setCategorias(r.categorias);
      }
      setCargando(false);
    },
    [],
  );

  const recargar = useCarga(pedir, aplicar);

  // Tras contabilizar o editar: indicador de nuevo y vuelta a pedir.
  const cargar = useCallback(async () => {
    setCargando(true);
    await recargar();
  }, [recargar]);

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

  const columnas = esCompra ? 9 : 7;

  return (
    <div className="space-y-6">
      <Encabezado
        titulo="Comprobantes"
        descripcion="Facturas extraídas de documentos o dictadas. Aquí se ajusta el tratamiento tributario y se convierten en asientos."
        acciones={
          <button onClick={contabilizar} disabled={ocupado} className={boton("primario")}>
            <CheckCheck size={16} />
            {ocupado ? "Contabilizando…" : "Contabilizar pendientes"}
          </button>
        }
      />

      {aviso && <Aviso tono="exito">{aviso}</Aviso>}
      {error && <Aviso tono="peligro">{error}</Aviso>}

      <Tarjeta sinRelleno>
        {/* Compras o ventas, y el filtro de pendientes */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-3">
          <div className="flex gap-1">
            {(["compras", "ventas"] as const).map((c) => {
              const activa = clase === c;
              return (
                <button
                  key={c}
                  onClick={() => {
                    router.replace(c === "ventas" ? "/comprobantes?clase=ventas" : "/comprobantes", {
                      scroll: false,
                    });
                    setCargando(true);
                  }}
                  className={`-mb-px flex shrink-0 items-center gap-2 border-b-2 px-3 py-3 text-sm transition-colors ${
                    activa
                      ? "border-emerald-600 font-medium text-emerald-700"
                      : "border-transparent text-slate-500 hover:text-slate-800"
                  }`}
                >
                  {c === "compras" ? "Compras" : "Ventas"}
                </button>
              );
            })}
          </div>
          <label className="flex items-center gap-2 px-2 py-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={soloPendientes}
              onChange={(e) => {
                setSoloPendientes(e.target.checked);
                setCargando(true);
              }}
              className="h-4 w-4 rounded border-slate-300 accent-emerald-600"
            />
            Solo sin contabilizar
          </label>
        </div>

        <div className={`${tabla.contenedor} max-h-[70vh]`}>
          <table className={tabla.tabla}>
            <thead className={tabla.cabecera}>
              <tr>
                <th className={tabla.th}>Fecha</th>
                <th className={tabla.th}>{esCompra ? "Proveedor" : "Cliente"}</th>
                <th className={tabla.th}>Nº</th>
                <th className={`${tabla.th} text-right`}>Base</th>
                <th className={`${tabla.th} text-right`}>IVA</th>
                <th className={`${tabla.th} text-right`}>Total</th>
                {esCompra && <th className={tabla.th}>Categoría</th>}
                {esCompra && (
                  <th className={`${tabla.th} text-center`} title="Da derecho a crédito tributario de IVA">
                    Créd. IVA
                  </th>
                )}
                <th className={tabla.th}>Estado</th>
              </tr>
            </thead>
            <tbody className={tabla.cuerpo}>
              {cargando &&
                filas.length === 0 &&
                Array.from({ length: 6 }, (_, i) => (
                  <tr key={i}>
                    <td colSpan={columnas} className="px-4 py-3">
                      <Esqueleto />
                    </td>
                  </tr>
                ))}
              {!cargando && filas.length === 0 && (
                <tr>
                  <td colSpan={columnas}>
                    <Vacio
                      icono={FileText}
                      titulo={
                        soloPendientes
                          ? "No hay comprobantes sin contabilizar"
                          : "No hay comprobantes registrados"
                      }
                    />
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
                  <tr key={f.id} className={tabla.fila}>
                    <td className={`${tabla.td} whitespace-nowrap text-slate-500`}>
                      {fecha(f.fecha)}
                    </td>
                    <td className={`${tabla.td} min-w-56`}>
                      <div className="font-medium text-slate-900">
                        {esCompra ? f.nombre_proveedor : f.razon_social_cliente}
                      </div>
                      <div className="text-xs tabular-nums text-slate-400">
                        {esCompra ? f.ruc_proveedor : f.id_cliente}
                      </div>
                    </td>
                    <td className={`${tabla.td} whitespace-nowrap font-mono text-xs text-slate-500`}>
                      {f.numero}
                    </td>
                    <td className={`${tabla.td} ${tabla.numero} text-slate-700`}>{usd(base)}</td>
                    <td className={`${tabla.td} ${tabla.numero} text-slate-500`}>{usd(iva)}</td>
                    <td className={`${tabla.td} ${tabla.numero} font-medium text-slate-900`}>
                      {usd(f.total)}
                    </td>

                    {esCompra && (
                      <td className={tabla.td}>
                        <select
                          value={f.categoria_id ?? ""}
                          disabled={bloqueado}
                          onChange={(e) => actualizar(f.id, { categoria_id: e.target.value })}
                          className={`${campo} w-48! py-1.5! text-xs! ${
                            f.categoria_id || bloqueado ? "" : "border-amber-300! bg-amber-50!"
                          }`}
                        >
                          <option value="">— sin clasificar —</option>
                          {categorias.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.nombre}
                            </option>
                          ))}
                        </select>
                        {f.rubro_personal && (
                          <div className="mt-1 text-[11px] text-emerald-700">
                            Gasto personal · {f.rubro_personal.toLowerCase()}
                          </div>
                        )}
                      </td>
                    )}

                    {esCompra && (
                      <td className={`${tabla.td} text-center`}>
                        <input
                          type="checkbox"
                          checked={Boolean(f.da_credito_iva)}
                          disabled={bloqueado}
                          onChange={(e) => actualizar(f.id, { da_credito_iva: e.target.checked })}
                          title="Da derecho a crédito tributario de IVA"
                          aria-label="Da derecho a crédito tributario de IVA"
                          className="h-4 w-4 rounded border-slate-300 accent-emerald-600 disabled:opacity-50"
                        />
                      </td>
                    )}

                    <td className={`${tabla.td} whitespace-nowrap`}>
                      {bloqueado ? (
                        <Insignia tono="exito">Contabilizado</Insignia>
                      ) : f.a_credito ? (
                        <Insignia tono="info">A crédito</Insignia>
                      ) : (
                        <Insignia>Pendiente</Insignia>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {esCompra && (
          <p className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
            Cambiar la categoría de una compra guarda la corrección en el mapa por
            RUC: las siguientes facturas de ese proveedor se clasificarán igual.
          </p>
        )}
      </Tarjeta>
    </div>
  );
}
