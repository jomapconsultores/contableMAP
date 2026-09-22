"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowRightLeft,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { usd, fecha, nombreMes } from "@/lib/formato";
import { useCarga, type Respuesta } from "@/lib/carga";
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

interface Pagina {
  filas: Movimiento[];
  total: number;
  pagina: number;
  por_pagina: number;
  debitos: number;
  creditos: number;
  conteos: { todos: number; sin_clasificar: number; revisar: number; sin_contabilizar: number };
}

interface Categoria {
  id: string;
  nombre: string;
}

interface Cuenta {
  id: string;
  nombre: string;
  tipo: string;
}

const PESTANAS = [
  { valor: "", texto: "Todos", conteo: "todos" },
  { valor: "sin_clasificar", texto: "Sin categoría", conteo: "sin_clasificar" },
  { valor: "revisar", texto: "Dudosos", conteo: "revisar" },
  { valor: "sin_contabilizar", texto: "Listos para contabilizar", conteo: "sin_contabilizar" },
] as const;

const TIPO_CUENTA: Record<string, string> = {
  CAJA: "Efectivo",
  BANCO: "Bancos",
  COOPERATIVA: "Cooperativas",
  INVERSION: "Inversiones",
  TARJETA_CREDITO: "Tarjetas de crédito",
};

/** Últimos 18 meses, del más reciente al más antiguo, como AAAA-MM. */
function mesesRecientes() {
  const hoy = new Date();
  return Array.from({ length: 18 }, (_, i) => {
    const d = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() - i, 1));
    const valor = d.toISOString().slice(0, 7);
    return { valor, texto: `${nombreMes(d.getUTCMonth() + 1)} ${d.getUTCFullYear()}` };
  });
}

function rangoDeMes(mes: string) {
  const [a, m] = mes.split("-").map(Number);
  const fin = new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
  return { desde: `${mes}-01`, hasta: fin };
}

export default function PaginaMovimientos() {
  return (
    <Suspense fallback={<Esqueleto className="h-96 w-full" />}>
      <Movimientos />
    </Suspense>
  );
}

function Movimientos() {
  const router = useRouter();
  const ruta = usePathname();
  const params = useSearchParams();

  // Los filtros viven en la URL: el panel enlaza directo a «sin categoría» o
  // a una cuenta, y recargar la página no los pierde.
  const estado = params.get("estado") ?? "";
  const cuenta = params.get("cuenta") ?? "";
  const mes = params.get("mes") ?? "";
  const q = params.get("q") ?? "";
  const pagina = Number(params.get("pagina") ?? 1);

  const [texto, setTexto] = useState(q);
  const [datos, setDatos] = useState<Pagina | null>(null);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());
  const [categoriaLote, setCategoriaLote] = useState("");
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cambiar = useCallback(
    (cambios: Record<string, string | null>) => {
      const nuevo = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(cambios)) {
        if (v) nuevo.set(k, v);
        else nuevo.delete(k);
      }
      // Cualquier filtro nuevo vuelve a la primera página.
      if (!("pagina" in cambios)) nuevo.delete("pagina");
      router.replace(`${ruta}?${nuevo.toString()}`, { scroll: false });
    },
    [params, router, ruta],
  );

  // La búsqueda espera a que se deje de escribir.
  useEffect(() => {
    if (texto === q) return;
    const t = setTimeout(() => cambiar({ q: texto.trim() || null }), 350);
    return () => clearTimeout(t);
  }, [texto, q, cambiar]);

  const consulta = useMemo(() => {
    const s = new URLSearchParams();
    if (estado) s.set("estado", estado);
    if (cuenta) s.set("cuenta", cuenta);
    if (q) s.set("q", q);
    if (mes) {
      const r = rangoDeMes(mes);
      s.set("desde", r.desde);
      s.set("hasta", r.hasta);
    }
    s.set("pagina", String(pagina));
    s.set("por_pagina", "50");
    return s.toString();
  }, [estado, cuenta, q, mes, pagina]);

  const pedir = useCallback(async () => {
    const r = (await fetch(`/api/movimientos?${consulta}`).then((x) => x.json())) as Respuesta<Pagina>;
    if (!r.ok) throw new Error(r.error);
    return r.datos;
  }, [consulta]);

  const aplicar = useCallback((r: Pagina | Error) => {
    if (r instanceof Error) setError(r.message);
    else {
      setDatos(r);
      setSeleccion(new Set());
    }
  }, []);

  const recargar = useCarga(pedir, aplicar);

  // Catálogos: una sola vez.
  useEffect(() => {
    fetch("/api/categorias")
      .then((r) => r.json())
      .then((j: Respuesta<Categoria[]>) => j.ok && setCategorias(j.datos))
      .catch(() => undefined);
    fetch("/api/cuentas")
      .then((r) => r.json())
      .then((j: Respuesta<Cuenta[]>) => j.ok && setCuentas(j.datos))
      .catch(() => undefined);
  }, []);

  async function llamar(metodo: "POST" | "PATCH", cuerpo: object, etiqueta: string) {
    setOcupado(etiqueta);
    setAviso(null);
    setError(null);
    try {
      const res = await fetch("/api/movimientos", {
        method: metodo,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cuerpo),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error);
      await recargar();
      return json.datos;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error inesperado");
      return null;
    } finally {
      setOcupado(null);
    }
  }

  async function clasificarPendientes() {
    const d = await llamar("POST", { accion: "clasificar" }, "clasificar");
    if (d)
      setAviso(
        `${d.clasificados} de ${d.pendientes ?? 0} movimientos clasificados (${d.consultasIA} consultas al modelo).`,
      );
  }

  async function contabilizar(ids?: string[]) {
    const d = await llamar("POST", { accion: "contabilizar", ids }, "contabilizar");
    if (d)
      setAviso(
        `${d.contabilizados} movimientos contabilizados` +
          (d.errores.length ? `; ${d.errores.length} no se pudieron: ${d.errores[0].error}` : "."),
      );
  }

  async function recategorizar(ids: string[], categoriaId: string) {
    if (!categoriaId) return;
    // Se refleja al instante; si el servidor la rechaza, la recarga lo deshace.
    setDatos((prev) =>
      prev && {
        ...prev,
        filas: prev.filas.map((m) =>
          ids.includes(m.id)
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
      },
    );
    const d = await llamar("PATCH", { ids, categoria_id: categoriaId }, "recategorizar");
    if (d && ids.length > 1) setAviso(`${d.actualizados} movimientos recategorizados.`);
  }

  const filas = datos?.filas ?? [];
  const paginas = datos ? Math.max(1, Math.ceil(datos.total / datos.por_pagina)) : 1;
  const todasMarcadas = filas.length > 0 && filas.every((m) => seleccion.has(m.id));
  const hayFiltros = Boolean(cuenta || mes || q);

  const alternar = (id: string) =>
    setSeleccion((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const cuentasPorTipo = useMemo(() => {
    const grupos = new Map<string, Cuenta[]>();
    for (const c of cuentas) grupos.set(c.tipo, [...(grupos.get(c.tipo) ?? []), c]);
    return [...grupos.entries()];
  }, [cuentas]);

  return (
    <div className="space-y-6">
      <Encabezado
        titulo="Movimientos"
        descripcion="Líneas de los estados de cuenta y del efectivo. Corregir una categoría enseña al sistema: el mismo comercio se clasificará así en adelante."
        acciones={
          <>
            <button
              onClick={clasificarPendientes}
              disabled={ocupado !== null}
              className={boton("secundario")}
            >
              <Sparkles size={16} />
              {ocupado === "clasificar" ? "Clasificando…" : "Clasificar pendientes"}
            </button>
            <button
              onClick={() => contabilizar()}
              disabled={ocupado !== null || !datos?.conteos.sin_contabilizar}
              className={boton("primario")}
            >
              <CheckCheck size={16} />
              {ocupado === "contabilizar" ? "Contabilizando…" : "Contabilizar lo listo"}
            </button>
          </>
        }
      />

      {aviso && (
        <Aviso tono="exito" acciones={<Cerrar alCerrar={() => setAviso(null)} />}>
          {aviso}
        </Aviso>
      )}
      {error && (
        <Aviso tono="peligro" acciones={<Cerrar alCerrar={() => setError(null)} />}>
          {error}
        </Aviso>
      )}

      <Tarjeta sinRelleno>
        {/* Pestañas por estado, con cuántos hay en cada una */}
        <div className="flex gap-1 overflow-x-auto border-b border-slate-200 px-3">
          {PESTANAS.map((p) => {
            const activa = estado === p.valor;
            const n = datos?.conteos[p.conteo];
            return (
              <button
                key={p.valor}
                onClick={() => cambiar({ estado: p.valor || null })}
                className={`-mb-px flex shrink-0 items-center gap-2 border-b-2 px-3 py-3 text-sm transition-colors ${
                  activa
                    ? "border-emerald-600 font-medium text-emerald-700"
                    : "border-transparent text-slate-500 hover:text-slate-800"
                }`}
              >
                {p.texto}
                {n !== undefined && (
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs tabular-nums ${
                      activa ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {n.toLocaleString("es-EC")}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Filtros */}
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-5 py-3">
          <div className="relative min-w-56 flex-1">
            <Search
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder="Buscar por descripción o comercio"
              className={`${campo} pl-9`}
            />
          </div>
          <select
            value={cuenta}
            onChange={(e) => cambiar({ cuenta: e.target.value || null })}
            className={`${campo} w-auto min-w-52`}
          >
            <option value="">Todas las cuentas</option>
            {cuentasPorTipo.map(([tipo, lista]) => (
              <optgroup key={tipo} label={TIPO_CUENTA[tipo] ?? tipo}>
                {lista.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nombre}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <select
            value={mes}
            onChange={(e) => cambiar({ mes: e.target.value || null })}
            className={`${campo} w-auto`}
          >
            <option value="">Cualquier fecha</option>
            {mesesRecientes().map((m) => (
              <option key={m.valor} value={m.valor}>
                {m.texto}
              </option>
            ))}
          </select>
          {hayFiltros && (
            <button
              onClick={() => {
                setTexto("");
                cambiar({ cuenta: null, mes: null, q: null });
              }}
              className={boton("fantasma", "sm")}
            >
              <X size={14} /> Quitar filtros
            </button>
          )}
        </div>

        {/* Resumen del conjunto filtrado, o acciones sobre la selección */}
        {seleccion.size > 0 ? (
          <div className="flex flex-wrap items-center gap-3 bg-emerald-50 px-5 py-2.5 text-sm">
            <span className="font-medium text-emerald-900">
              {seleccion.size} seleccionado{seleccion.size === 1 ? "" : "s"}
            </span>
            <select
              value={categoriaLote}
              onChange={(e) => setCategoriaLote(e.target.value)}
              className={`${campo} w-auto py-1.5`}
            >
              <option value="">Asignar categoría…</option>
              {categorias.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
            </select>
            <button
              onClick={() => recategorizar([...seleccion], categoriaLote)}
              disabled={!categoriaLote || ocupado !== null}
              className={boton("secundario", "sm")}
            >
              Aplicar
            </button>
            <button
              onClick={() =>
                contabilizar(filas.filter((m) => seleccion.has(m.id) && !m.asiento_id && m.categoria_id).map((m) => m.id))
              }
              disabled={ocupado !== null}
              className={boton("primario", "sm")}
            >
              Contabilizar seleccionados
            </button>
            <button onClick={() => setSeleccion(new Set())} className={boton("fantasma", "sm")}>
              Cancelar
            </button>
          </div>
        ) : (
          datos && (
            <div className="flex flex-wrap gap-x-6 gap-y-1 px-5 py-2.5 text-xs text-slate-500">
              <span>
                <span className="font-medium text-slate-700">{datos.total.toLocaleString("es-EC")}</span>{" "}
                movimientos
              </span>
              <span>
                Salidas <span className="font-medium tabular-nums text-slate-700">{usd(datos.debitos)}</span>
              </span>
              <span>
                Entradas{" "}
                <span className="font-medium tabular-nums text-emerald-700">{usd(datos.creditos)}</span>
              </span>
            </div>
          )
        )}

        <div className={`${tabla.contenedor} max-h-[70vh]`}>
          <table className={tabla.tabla}>
            <thead className={tabla.cabecera}>
              <tr>
                <th className={`${tabla.th} w-10`}>
                  <input
                    type="checkbox"
                    aria-label="Seleccionar la página"
                    checked={todasMarcadas}
                    onChange={() =>
                      setSeleccion(todasMarcadas ? new Set() : new Set(filas.map((m) => m.id)))
                    }
                    className="h-4 w-4 rounded border-slate-300 accent-emerald-600"
                  />
                </th>
                <th className={tabla.th}>Fecha</th>
                <th className={tabla.th}>Descripción</th>
                <th className={tabla.th}>Categoría</th>
                <th className={tabla.th}>Estado</th>
                <th className={`${tabla.th} text-right`}>Monto</th>
              </tr>
            </thead>
            <tbody className={tabla.cuerpo}>
              {!datos &&
                Array.from({ length: 8 }, (_, i) => (
                  <tr key={i}>
                    <td colSpan={6} className="px-4 py-3">
                      <Esqueleto />
                    </td>
                  </tr>
                ))}
              {datos && filas.length === 0 && (
                <tr>
                  <td colSpan={6}>
                    <Vacio
                      icono={ArrowRightLeft}
                      titulo="No hay movimientos con estos filtros"
                      descripcion={hayFiltros ? "Prueba quitando algún filtro." : undefined}
                    />
                  </td>
                </tr>
              )}
              {filas.map((m) => (
                <tr
                  key={m.id}
                  className={`${tabla.fila} ${seleccion.has(m.id) ? "bg-emerald-50/60" : ""}`}
                >
                  <td className={tabla.td}>
                    <input
                      type="checkbox"
                      aria-label="Seleccionar"
                      checked={seleccion.has(m.id)}
                      onChange={() => alternar(m.id)}
                      className="h-4 w-4 rounded border-slate-300 accent-emerald-600"
                    />
                  </td>
                  <td className={`${tabla.td} whitespace-nowrap text-slate-500`}>{fecha(m.fecha)}</td>
                  <td className={`${tabla.td} min-w-64`}>
                    <div className="font-medium text-slate-900">{m.comercio ?? m.descripcion}</div>
                    <div className="text-xs text-slate-400">
                      {m.comercio && m.comercio !== m.descripcion ? `${m.descripcion} · ` : ""}
                      {m.cuentas_financieras?.nombre}
                    </div>
                  </td>
                  <td className={tabla.td}>
                    <select
                      value={m.categoria_id ?? ""}
                      onChange={(e) => recategorizar([m.id], e.target.value)}
                      disabled={ocupado !== null}
                      title={m.asiento_id ? "Al cambiarla se corrige también su asiento" : undefined}
                      className={`${campo} w-52 py-1.5 text-xs ${m.categoria_id ? "" : "border-amber-300 bg-amber-50"}`}
                    >
                      <option value="">— sin categoría —</option>
                      {categorias.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.nombre}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className={`${tabla.td} whitespace-nowrap`}>
                    <Estado m={m} />
                  </td>
                  <td
                    className={`${tabla.td} ${tabla.numero} font-medium ${
                      m.naturaleza === "DEBITO" ? "text-slate-900" : "text-emerald-700"
                    }`}
                  >
                    {m.naturaleza === "DEBITO" ? "−" : "+"}
                    {usd(m.monto)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {datos && datos.total > datos.por_pagina && (
          <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3 text-sm text-slate-500">
            <span>
              Página {pagina} de {paginas}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => cambiar({ pagina: String(pagina - 1) })}
                disabled={pagina <= 1}
                className={boton("secundario", "sm")}
              >
                <ChevronLeft size={14} /> Anterior
              </button>
              <button
                onClick={() => cambiar({ pagina: String(pagina + 1) })}
                disabled={pagina >= paginas}
                className={boton("secundario", "sm")}
              >
                Siguiente <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </Tarjeta>
    </div>
  );
}

function Estado({ m }: { m: Movimiento }) {
  if (m.asiento_id) return <Insignia tono="exito">Contabilizado</Insignia>;
  if (!m.categoria_id) return <Insignia tono="aviso">Sin categoría</Insignia>;
  if (m.confianza_ia !== null && m.confianza_ia < 0.7)
    return <Insignia tono="aviso">Revisar · {Math.round(m.confianza_ia * 100)} %</Insignia>;
  return (
    <Insignia tono="info">
      {m.clasificado_por === "MANUAL" ? "Revisado" : m.clasificado_por === "MAPA" ? "Por regla" : "Por IA"}
    </Insignia>
  );
}

function Cerrar({ alCerrar }: { alCerrar: () => void }) {
  return (
    <button onClick={alCerrar} aria-label="Cerrar" className="rounded p-0.5 opacity-60 hover:opacity-100">
      <X size={16} />
    </button>
  );
}
