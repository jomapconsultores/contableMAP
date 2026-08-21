"use client";

import { useCallback, useState } from "react";
import { usd, fecha } from "@/lib/formato";
import { useCarga, type Respuesta } from "@/lib/carga";

interface Movimiento {
  id: string;
  fecha: string;
  descripcion: string;
  comercio: string | null;
  naturaleza: "DEBITO" | "CREDITO";
  monto: number;
  confianza_ia: number | null;
  clasificado_por: string | null;
  asiento_id: string | null;
  categoria_id: string | null;
  categorias_gasto: { nombre: string } | null;
  cuentas_financieras: { nombre: string; tipo: string } | null;
}

interface Categoria {
  id: string;
  nombre: string;
}

const FILTROS = [
  { valor: "", texto: "Todos" },
  { valor: "sin_clasificar", texto: "Sin clasificar" },
  { valor: "revisar", texto: "Baja confianza" },
  { valor: "sin_contabilizar", texto: "Sin contabilizar" },
];

export default function Movimientos() {
  const [movimientos, setMovimientos] = useState<Movimiento[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [filtro, setFiltro] = useState("");
  const [cargando, setCargando] = useState(true);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pedir = useCallback(async () => {
    const [mov, cat] = (await Promise.all([
      fetch(`/api/movimientos?estado=${filtro}`).then((r) => r.json()),
      fetch("/api/categorias").then((r) => r.json()),
    ])) as [Respuesta<Movimiento[]>, Respuesta<Categoria[]>];
    return { mov, cat };
  }, [filtro]);

  const aplicar = useCallback(
    (r: { mov: Respuesta<Movimiento[]>; cat: Respuesta<Categoria[]> } | Error) => {
      if (r instanceof Error) {
        setError(r.message);
      } else {
        if (r.mov.ok) setMovimientos(r.mov.datos);
        else setError(r.mov.error);
        if (r.cat.ok) setCategorias(r.cat.datos);
      }
      setCargando(false);
    },
    [],
  );

  const recargar = useCarga(pedir, aplicar);

  // Tras una acción masiva: indicador de nuevo y vuelta a pedir.
  const cargar = useCallback(async () => {
    setCargando(true);
    await recargar();
  }, [recargar]);

  async function accionMasiva(accion: "clasificar" | "contabilizar") {
    setOcupado(true);
    setAviso(null);
    setError(null);
    try {
      const res = await fetch("/api/movimientos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accion }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error);

      setAviso(
        accion === "clasificar"
          ? `${json.datos.clasificados} de ${json.datos.pendientes} movimientos clasificados (${json.datos.consultasIA} consultas al modelo).`
          : `${json.datos.contabilizados} movimientos contabilizados` +
              (json.datos.errores.length ? `, ${json.datos.errores.length} con error.` : "."),
      );
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error inesperado");
    } finally {
      setOcupado(false);
    }
  }

  async function cambiarCategoria(id: string, categoriaId: string) {
    setMovimientos((prev) =>
      prev.map((m) =>
        m.id === id
          ? {
              ...m,
              categoria_id: categoriaId,
              clasificado_por: "MANUAL",
              confianza_ia: null,
              categorias_gasto: {
                nombre: categorias.find((c) => c.id === categoriaId)?.nombre ?? "",
              },
            }
          : m,
      ),
    );

    const res = await fetch("/api/movimientos", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, categoria_id: categoriaId }),
    });
    const json = await res.json();
    if (!json.ok) {
      setError(json.error);
      await cargar();
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Movimientos</h1>
          <p className="text-sm text-slate-600">
            Líneas de los estados de cuenta. Corregir una categoría enseña al
            sistema: el mismo comercio se clasificará así en adelante.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <select
            value={filtro}
            onChange={(e) => {
              setFiltro(e.target.value);
              setCargando(true);
            }}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            {FILTROS.map((f) => (
              <option key={f.valor} value={f.valor}>
                {f.texto}
              </option>
            ))}
          </select>
          <button
            onClick={() => accionMasiva("clasificar")}
            disabled={ocupado}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-100 disabled:opacity-50"
          >
            Clasificar pendientes
          </button>
          <button
            onClick={() => accionMasiva("contabilizar")}
            disabled={ocupado}
            className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            Contabilizar
          </button>
        </div>
      </div>

      {aviso && (
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{aviso}</p>
      )}
      {error && (
        <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>
      )}
      {ocupado && <p className="text-sm text-slate-500">Trabajando…</p>}

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">Fecha</th>
              <th className="px-3 py-2">Descripción</th>
              <th className="px-3 py-2">Cuenta</th>
              <th className="px-3 py-2 text-right">Monto</th>
              <th className="px-3 py-2">Categoría</th>
              <th className="px-3 py-2">Estado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {cargando && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-slate-500">
                  Cargando…
                </td>
              </tr>
            )}
            {!cargando && movimientos.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-slate-500">
                  No hay movimientos con este filtro.
                </td>
              </tr>
            )}
            {movimientos.map((m) => (
              <tr key={m.id} className="hover:bg-slate-50">
                <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                  {fecha(m.fecha)}
                </td>
                <td className="px-3 py-2">
                  <div className="font-medium">{m.comercio ?? m.descripcion}</div>
                  {m.comercio && (
                    <div className="text-xs text-slate-400">{m.descripcion}</div>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-500">
                  {m.cuentas_financieras?.nombre ?? "—"}
                </td>
                <td
                  className={`whitespace-nowrap px-3 py-2 text-right tabular-nums ${
                    m.naturaleza === "DEBITO" ? "text-rose-700" : "text-emerald-700"
                  }`}
                >
                  {m.naturaleza === "DEBITO" ? "−" : "+"}
                  {usd(m.monto)}
                </td>
                <td className="px-3 py-2">
                  <select
                    value={m.categoria_id ?? ""}
                    onChange={(e) => cambiarCategoria(m.id, e.target.value)}
                    disabled={Boolean(m.asiento_id)}
                    className="w-44 rounded border border-slate-300 px-2 py-1 text-xs disabled:bg-slate-100"
                  >
                    <option value="">— sin clasificar —</option>
                    {categorias.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nombre}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-xs">
                  {m.asiento_id ? (
                    <span className="rounded bg-emerald-100 px-2 py-0.5 text-emerald-800">
                      contabilizado
                    </span>
                  ) : m.confianza_ia !== null && m.confianza_ia < 0.7 ? (
                    <span className="rounded bg-amber-100 px-2 py-0.5 text-amber-900">
                      revisar {(m.confianza_ia * 100).toFixed(0)} %
                    </span>
                  ) : m.categoria_id ? (
                    <span className="text-slate-500">
                      {m.clasificado_por?.toLowerCase() ?? "clasificado"}
                    </span>
                  ) : (
                    <span className="text-slate-400">pendiente</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
