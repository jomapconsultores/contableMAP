import type { SupabaseClient } from "@supabase/supabase-js";
import { consultar } from "./ia";
import { LoteClasificado } from "./esquemas";
import { SISTEMA_CLASIFICACION } from "./prompts";

/**
 * Motor de clasificación de gastos. Replica el comportamiento de
 * tributos-web: el mapa aprendido manda, la IA solo interviene con lo que el
 * mapa no reconoce, y lo que la IA resuelve con alta confianza se incorpora
 * al mapa para no volver a consultarlo.
 */

export interface ItemAClasificar {
  indice: number;
  descripcion: string;
  comercio?: string | null;
  ruc?: string | null;
  actividad?: string | null;
  monto: number;
  fecha: string;
}

export interface Asignacion {
  indice: number;
  categoriaId: string | null;
  categoria: string;
  comercio: string | null;
  confianza: number;
  origen: "MAPA" | "IA";
  motivo: string;
}

/** Confianza mínima para guardar la clasificación en el mapa de aprendizaje. */
const UMBRAL_APRENDIZAJE = 0.85;
/** Movimientos por llamada al modelo. */
const TAMANO_LOTE = 60;

/**
 * Normaliza el nombre de un comercio para que sirva como clave estable:
 * mayúsculas, sin tildes, sin números de terminal ni sufijos de ciudad.
 */
export function normalizarComercio(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // marcas diacríticas separadas por NFD
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, " ")
    .replace(/\b\d+\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .slice(0, 3)
    .join(" ");
}

interface Categoria {
  id: string;
  nombre: string;
  rubro_personal: string | null;
  deducible_negocio: boolean;
  credito_iva: boolean;
}

interface EntradaMapa {
  tipo_clave: string;
  clave: string;
  categoria_id: string;
}

export async function clasificarLote(
  sb: SupabaseClient,
  entidadId: string,
  items: ItemAClasificar[],
): Promise<{ asignaciones: Asignacion[]; consultasIA: number }> {
  if (items.length === 0) return { asignaciones: [], consultasIA: 0 };

  const [{ data: categorias }, { data: mapa }] = await Promise.all([
    sb
      .from("categorias_gasto")
      .select("id, nombre, rubro_personal, deducible_negocio, credito_iva")
      .eq("entidad_id", entidadId)
      .eq("activo", true),
    sb
      .from("mapa_clasificacion")
      .select("tipo_clave, clave, categoria_id")
      .eq("entidad_id", entidadId),
  ]);

  const cats = (categorias ?? []) as Categoria[];
  const porNombre = new Map(cats.map((c) => [c.nombre.toUpperCase(), c]));
  const porId = new Map(cats.map((c) => [c.id, c]));

  const mapaRuc = new Map<string, string>();
  const mapaComercio = new Map<string, string>();
  for (const m of (mapa ?? []) as EntradaMapa[]) {
    (m.tipo_clave === "RUC" ? mapaRuc : mapaComercio).set(m.clave, m.categoria_id);
  }

  const asignaciones: Asignacion[] = [];
  const pendientes: ItemAClasificar[] = [];

  // --- Paso 1: mapa aprendido -------------------------------------------
  for (const item of items) {
    const clave = item.comercio ? normalizarComercio(item.comercio) : null;
    const catId =
      (item.ruc ? mapaRuc.get(item.ruc) : undefined) ??
      (clave ? mapaComercio.get(clave) : undefined);

    if (catId && porId.has(catId)) {
      asignaciones.push({
        indice: item.indice,
        categoriaId: catId,
        categoria: porId.get(catId)!.nombre,
        comercio: clave,
        confianza: 1,
        origen: "MAPA",
        motivo: item.ruc && mapaRuc.has(item.ruc)
          ? "Proveedor ya clasificado anteriormente"
          : "Comercio ya clasificado anteriormente",
      });
    } else {
      pendientes.push(item);
    }
  }

  // --- Paso 2: lo que el mapa no reconoce va al modelo -------------------
  const catalogo = cats
    .map(
      (c) =>
        `- ${c.nombre}${c.rubro_personal ? ` (gasto personal deducible: ${c.rubro_personal})` : ""}`,
    )
    .join("\n");

  let consultasIA = 0;
  const nuevasClaves: {
    entidad_id: string;
    tipo_clave: string;
    clave: string;
    nombre_origen: string;
    actividad: string | null;
    categoria_id: string;
    origen: string;
    confirmado: boolean;
  }[] = [];

  for (let i = 0; i < pendientes.length; i += TAMANO_LOTE) {
    const lote = pendientes.slice(i, i + TAMANO_LOTE);
    consultasIA += 1;

    const listado = lote
      .map(
        (m) =>
          `${m.indice}. ${m.fecha} | ${m.descripcion} | USD ${m.monto.toFixed(2)}` +
          (m.ruc ? ` | RUC ${m.ruc}` : "") +
          (m.actividad ? ` | actividad: ${m.actividad}` : ""),
      )
      .join("\n");

    const { datos } = await consultar({
      sistema: SISTEMA_CLASIFICACION,
      esquema: LoteClasificado,
      maxTokens: 16000,
      esfuerzo: "medium",
      contenido: [
        {
          type: "text",
          text: `Catálogo de categorías disponibles:\n${catalogo}\n\nMovimientos a clasificar (el número inicial es el índice que debes devolver):\n${listado}`,
        },
      ],
    });

    const porIndice = new Map(datos.items.map((r) => [r.indice, r]));

    for (const item of lote) {
      const r = porIndice.get(item.indice);
      const cat = r ? porNombre.get(r.categoria.toUpperCase()) : undefined;

      asignaciones.push({
        indice: item.indice,
        categoriaId: cat?.id ?? null,
        categoria: cat?.nombre ?? "SIN CLASIFICAR",
        comercio: r?.comercio ? normalizarComercio(r.comercio) : null,
        confianza: r?.confianza ?? 0,
        origen: "IA",
        motivo: r?.motivo ?? "El modelo no devolvió resultado para este movimiento",
      });

      // Aprende solo lo que viene con confianza suficiente y categoría real.
      if (cat && r && r.confianza >= UMBRAL_APRENDIZAJE && cat.nombre !== "SIN CLASIFICAR") {
        const clave = item.ruc ?? (r.comercio ? normalizarComercio(r.comercio) : null);
        if (clave) {
          nuevasClaves.push({
            entidad_id: entidadId,
            tipo_clave: item.ruc ? "RUC" : "COMERCIO",
            clave,
            nombre_origen: item.comercio ?? item.descripcion,
            actividad: item.actividad ?? null,
            categoria_id: cat.id,
            origen: "IA",
            confirmado: false,
          });
        }
      }
    }
  }

  if (nuevasClaves.length > 0) {
    // Dedup dentro del lote: una misma clave puede repetirse muchas veces.
    const unicas = new Map(
      nuevasClaves.map((n) => [`${n.tipo_clave}|${n.clave}`, n]),
    );
    await sb
      .from("mapa_clasificacion")
      .upsert([...unicas.values()], {
        onConflict: "entidad_id,tipo_clave,clave",
        ignoreDuplicates: true,
      });
  }

  asignaciones.sort((a, b) => a.indice - b.indice);
  return { asignaciones, consultasIA };
}
