import type { SupabaseClient } from "@supabase/supabase-js";
import { contexto, manejar, ErrorPeticion } from "@/lib/api";
import { clasificarLote } from "@/lib/clasificacion";
import { contabilizarMovimiento } from "@/lib/contabilizacion";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const COLUMNAS =
  "id, fecha, descripcion, comercio, naturaleza, monto, confianza_ia, clasificado_por, asiento_id, categoria_id, cuenta_id, categorias_gasto(nombre), cuentas_financieras(nombre, tipo)";

const POR_PAGINA_MAX = 200;

/**
 * Vista mínima del constructor de consultas para esta lista. El tipado
 * completo de Supabase se atasca («excessively deep») al combinar una
 * selección con relaciones embebidas y filtros aplicados por una función
 * común; esta interfaz declara solo lo que se usa.
 */
interface Consulta
  extends PromiseLike<{
    data: Record<string, unknown>[] | null;
    count: number | null;
    error: { message: string } | null;
  }> {
  eq(columna: string, valor: unknown): Consulta;
  gte(columna: string, valor: unknown): Consulta;
  lte(columna: string, valor: unknown): Consulta;
  or(filtros: string): Consulta;
  is(columna: string, valor: null): Consulta;
  lt(columna: string, valor: unknown): Consulta;
  not(columna: string, operador: string, valor: unknown): Consulta;
  order(columna: string, opciones: { ascending: boolean }): Consulta;
  range(desde: number, hasta: number): Consulta;
  limit(n: number): Consulta;
}

type Seleccion = (columnas: string, opciones?: { count?: "exact"; head?: boolean }) => Consulta;

/**
 * Movimientos de extracto con filtros, página y totales.
 *
 * Parámetros: estado (sin_clasificar | revisar | sin_contabilizar), cuenta,
 * categoria, q (texto en la descripción o el comercio), desde, hasta, pagina
 * (desde 1) y por_pagina. Además de la página devuelve cuántos hay en total,
 * lo que suman y cuántos caen en cada estado con los demás filtros puestos:
 * así las pestañas de la pantalla muestran su número sin pedirlo aparte.
 */
export async function GET(request: Request) {
  return manejar(async () => {
    const p = new URL(request.url).searchParams;
    const { sb, entidadId } = await contexto(p.get("entidad_id"));

    const pagina = Math.max(1, Number(p.get("pagina") ?? 1));
    const porPagina = Math.min(POR_PAGINA_MAX, Math.max(10, Number(p.get("por_pagina") ?? 50)));
    const desdeFila = (pagina - 1) * porPagina;

    // Todos los filtros menos el estado: valen igual para la página, para los
    // totales y para el número de cada pestaña.
    const cuenta = p.get("cuenta");
    const categoria = p.get("categoria");
    const desde = p.get("desde");
    const hasta = p.get("hasta");
    const texto = (p.get("q") ?? "").trim().replace(/[%,()*]/g, " ");

    // Cada consulta parte de su propio from(): el constructor de Supabase
    // guarda la URL en él, y reutilizarlo mezclaría los filtros de una con otra.
    const seleccionar: Seleccion = (c, o) =>
      (sb.from("movimientos_extracto") as unknown as { select: Seleccion }).select(c, o);

    function filtrar(q: Consulta, estado: string | null): Consulta {
      let r = q.eq("entidad_id", entidadId);
      if (cuenta) r = r.eq("cuenta_id", cuenta);
      if (categoria) r = r.eq("categoria_id", categoria);
      if (desde) r = r.gte("fecha", desde);
      if (hasta) r = r.lte("fecha", hasta);
      if (texto) r = r.or(`descripcion.ilike.%${texto}%,comercio.ilike.%${texto}%`);
      if (estado === "sin_clasificar") r = r.is("categoria_id", null);
      if (estado === "revisar") r = r.is("asiento_id", null).lt("confianza_ia", 0.7);
      if (estado === "sin_contabilizar") r = r.is("asiento_id", null).not("categoria_id", "is", null);
      return r;
    }

    const estado = p.get("estado");
    const contar = async (e: string | null) => {
      const { count } = await filtrar(seleccionar("id", { count: "exact", head: true }), e);
      return count ?? 0;
    };

    const [filas, montos, todos, sinClasificar, revisar, sinContabilizar] = await Promise.all([
      filtrar(seleccionar(COLUMNAS, { count: "exact" }), estado)
        .order("fecha", { ascending: false })
        .order("created_at", { ascending: false })
        .range(desdeFila, desdeFila + porPagina - 1),
      filtrar(seleccionar("naturaleza, monto"), estado).limit(20000),
      contar(null),
      contar("sin_clasificar"),
      contar("revisar"),
      contar("sin_contabilizar"),
    ]);

    if (filas.error) throw new ErrorPeticion(filas.error.message, 500);

    let debitos = 0;
    let creditos = 0;
    for (const m of montos.data ?? []) {
      if (m.naturaleza === "DEBITO") debitos += Number(m.monto);
      else creditos += Number(m.monto);
    }

    return {
      filas: filas.data,
      total: filas.count ?? 0,
      pagina,
      por_pagina: porPagina,
      debitos: Math.round(debitos * 100) / 100,
      creditos: Math.round(creditos * 100) / 100,
      conteos: {
        todos,
        sin_clasificar: sinClasificar,
        revisar,
        sin_contabilizar: sinContabilizar,
      },
    };
  });
}

/**
 * Corrige la categoría de un movimiento. La corrección manual se guarda en el
 * mapa como confirmada, de modo que pisa cualquier sugerencia posterior de la
 * IA para ese mismo comercio.
 *
 * Si el movimiento ya estaba contabilizado, la línea de su asiento pasa a la
 * cuenta de la nueva categoría. Cambiar solo la categoría dejaría los estados
 * financieros con la cuenta vieja.
 */
async function recategorizar(
  sb: SupabaseClient,
  entidadId: string,
  id: string,
  categoriaId: string,
  aprender: boolean,
) {
  const { data: previo, error: errPrevio } = await sb
    .from("movimientos_extracto")
    .select("asiento_id, categorias_gasto(cuenta_id)")
    .eq("id", id)
    .single();
  if (errPrevio || !previo) throw new ErrorPeticion("Movimiento no encontrado.", 404);

  if (previo.asiento_id) {
    // El embebido llega como objeto o como arreglo según cómo se infiera la
    // relación; se acepta cualquiera de las dos formas.
    const cat = [previo.categorias_gasto].flat()[0] as { cuenta_id: string | null } | undefined;
    const cuentaVieja = cat?.cuenta_id;
    const { data: nueva } = await sb
      .from("categorias_gasto")
      .select("cuenta_id")
      .eq("id", categoriaId)
      .single();

    if (!cuentaVieja || !nueva?.cuenta_id) {
      throw new ErrorPeticion(
        "El movimiento ya está contabilizado y una de las dos categorías no tiene cuenta contable.",
      );
    }
    if (cuentaVieja !== nueva.cuenta_id) {
      const { error: errLinea } = await sb
        .from("asiento_lineas")
        .update({ cuenta_id: nueva.cuenta_id })
        .eq("asiento_id", previo.asiento_id)
        .eq("cuenta_id", cuentaVieja);
      if (errLinea) throw new ErrorPeticion(errLinea.message, 500);
    }
  }

  const { data: mov, error } = await sb
    .from("movimientos_extracto")
    .update({ categoria_id: categoriaId, clasificado_por: "MANUAL", confianza_ia: null })
    .eq("id", id)
    .select("comercio, descripcion")
    .single();

  if (error) throw new ErrorPeticion(error.message, 500);

  if (aprender && mov?.comercio) {
    await sb.from("mapa_clasificacion").upsert(
      {
        entidad_id: entidadId,
        tipo_clave: "COMERCIO",
        clave: mov.comercio,
        nombre_origen: mov.descripcion,
        categoria_id: categoriaId,
        origen: "MANUAL",
        confirmado: true,
      },
      { onConflict: "entidad_id,tipo_clave,clave" },
    );
  }
}

/** Corrige la categoría de uno (`id`) o de varios movimientos a la vez (`ids`). */
export async function PATCH(request: Request) {
  return manejar(async () => {
    const { id, ids, categoria_id, aprender = true } = (await request.json()) as {
      id?: string;
      ids?: string[];
      categoria_id?: string;
      aprender?: boolean;
    };

    const objetivo = ids?.length ? ids : id ? [id] : [];
    if (objetivo.length === 0 || !categoria_id) {
      throw new ErrorPeticion("Faltan los movimientos y la categoría.");
    }
    const { sb, entidadId } = await contexto();

    for (const m of objetivo) await recategorizar(sb, entidadId, m, categoria_id, aprender);
    return { actualizados: objetivo.length, categoria_id };
  });
}

/**
 * Acciones masivas: clasificar lo pendiente o contabilizar lo ya clasificado.
 */
export async function POST(request: Request) {
  return manejar(async () => {
    const { accion, ids } = (await request.json()) as {
      accion?: "clasificar" | "contabilizar";
      ids?: string[];
    };
    const { sb, entidadId } = await contexto();

    if (accion === "clasificar") {
      const { data: pendientes, error } = await sb
        .from("movimientos_extracto")
        .select("id, fecha, descripcion, comercio, monto")
        .eq("entidad_id", entidadId)
        .is("categoria_id", null)
        .limit(500);

      if (error) throw new ErrorPeticion(error.message, 500);
      if (!pendientes?.length) return { clasificados: 0, consultasIA: 0 };

      const { asignaciones, consultasIA } = await clasificarLote(
        sb,
        entidadId,
        pendientes.map((m, i) => ({
          indice: i,
          descripcion: m.descripcion as string,
          comercio: m.comercio as string | null,
          monto: Number(m.monto),
          fecha: m.fecha as string,
        })),
      );

      let clasificados = 0;
      for (const a of asignaciones) {
        if (!a.categoriaId) continue;
        clasificados += 1;
        await sb
          .from("movimientos_extracto")
          .update({
            categoria_id: a.categoriaId,
            comercio: a.comercio,
            clasificado_por: a.origen,
            confianza_ia: a.origen === "IA" ? a.confianza : null,
          })
          .eq("id", pendientes[a.indice].id as string);
      }

      return { clasificados, pendientes: pendientes.length, consultasIA };
    }

    if (accion === "contabilizar") {
      let objetivo = ids ?? [];
      if (objetivo.length === 0) {
        const { data } = await sb
          .from("movimientos_extracto")
          .select("id")
          .eq("entidad_id", entidadId)
          .is("asiento_id", null)
          .not("categoria_id", "is", null)
          .limit(500);
        objetivo = (data ?? []).map((m) => m.id as string);
      }

      const errores: { id: string; error: string }[] = [];
      let contabilizados = 0;

      for (const id of objetivo) {
        try {
          await contabilizarMovimiento(sb, entidadId, id);
          contabilizados += 1;
        } catch (e) {
          errores.push({ id, error: e instanceof Error ? e.message : "Error" });
        }
      }

      return { contabilizados, errores };
    }

    throw new ErrorPeticion("Acción no reconocida. Usa 'clasificar' o 'contabilizar'.");
  });
}
