import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { consultar } from "@/lib/ia";
import { huella } from "@/lib/procesamiento";
import { SISTEMA_EFECTIVO } from "@/lib/prompts";

/**
 * Gastos en efectivo dictados a Microsoft To Do.
 *
 * El titular dicta lo que paga en efectivo a una lista de To Do («Gastos
 * personales»). Una tarea programada en su PC lee esa lista y manda aquí las
 * notas nuevas; el modelo las interpreta y quedan en la cuenta Caja, clasificadas
 * pero sin contabilizar, para revisarlas como cualquier extracto.
 *
 * Cada fila guarda en `referencia` el identificador de su tarea de To Do. Así
 * una nota ya importada no se vuelve a interpretar —ni a pagar su consulta—
 * aunque la tarea programada la mande otra vez.
 */

export const CUENTA_CAJA = "Caja - Efectivo";

export const Nota = z.object({
  id: z.string().min(1).max(300),
  texto: z.string().min(1).max(2000),
  creada: z.string().min(10),
});
export type Nota = z.infer<typeof Nota>;

const Interpretacion = z.object({
  filas: z.array(
    z.object({
      nota: z.number().int(),
      fecha: z.string(),
      monto: z.number().positive(),
      naturaleza: z.enum(["DEBITO", "CREDITO"]),
      descripcion: z.string(),
      categoria: z.string(),
      confianza: z.number().min(0).max(1),
    }),
  ),
});

export interface ResultadoEfectivo {
  recibidas: number;
  yaImportadas: number;
  interpretadas: number;
  registradas: number;
  sinCategoria: string[];
}

export async function importarNotas(
  sb: SupabaseClient,
  entidadId: string,
  notas: Nota[],
): Promise<ResultadoEfectivo> {
  const { data: caja } = await sb
    .from("cuentas_financieras")
    .select("id")
    .eq("entidad_id", entidadId)
    .eq("nombre", CUENTA_CAJA)
    .single();
  if (!caja) throw new Error(`No existe la cuenta «${CUENTA_CAJA}».`);

  // Las notas que ya tienen algún movimiento no se vuelven a interpretar.
  const { data: previas } = await sb
    .from("movimientos_extracto")
    .select("referencia")
    .eq("entidad_id", entidadId)
    .eq("cuenta_id", caja.id)
    .like("referencia", "TODO:%");
  const importadas = new Set(
    (previas ?? []).map((p) => (p.referencia as string).split(":")[1]),
  );
  const nuevas = notas.filter((n) => !importadas.has(n.id));

  const resultado: ResultadoEfectivo = {
    recibidas: notas.length,
    yaImportadas: notas.length - nuevas.length,
    interpretadas: 0,
    registradas: 0,
    sinCategoria: [],
  };
  if (nuevas.length === 0) return resultado;

  const { data: cats } = await sb
    .from("categorias_gasto")
    .select("id, nombre")
    .eq("entidad_id", entidadId)
    .eq("activo", true);
  const porNombre = new Map((cats ?? []).map((c) => [c.nombre as string, c.id as string]));

  const { datos } = await consultar({
    sistema: SISTEMA_EFECTIVO,
    esquema: Interpretacion,
    maxTokens: 8000,
    contenido: [
      {
        type: "text",
        text:
          `Catálogo de categorías:\n${[...porNombre.keys()].map((n) => `- ${n}`).join("\n")}\n\n` +
          `Notas (número | fecha de creación | texto):\n` +
          nuevas.map((n, i) => `${i + 1} | ${n.creada.slice(0, 10)} | ${n.texto}`).join("\n"),
      },
    ],
  });

  // El modelo cita cada nota por su número en la lista, no por el id de To Do:
  // copiar de vuelta un identificador de 150 caracteres es invitarlo a errar.
  const porNota = new Map<string, number>();
  const filas = [];

  for (const f of datos.filas) {
    const nota = nuevas[f.nota - 1];
    if (!nota || !/^\d{4}-\d{2}-\d{2}$/.test(f.fecha)) continue;
    const orden = (porNota.get(nota.id) ?? 0) + 1;
    porNota.set(nota.id, orden);

    const categoriaId = porNombre.get(f.categoria) ?? null;
    if (!categoriaId) resultado.sinCategoria.push(`${f.descripcion} (${f.categoria})`);

    const referencia = `TODO:${nota.id}:${orden}`;
    const descripcion = `${f.descripcion} (efectivo, To Do)`;
    filas.push({
      entidad_id: entidadId,
      cuenta_id: caja.id,
      fecha: f.fecha,
      descripcion,
      referencia,
      naturaleza: f.naturaleza,
      monto: Math.round(f.monto * 100) / 100,
      moneda: "USD",
      categoria_id: categoriaId,
      clasificado_por: categoriaId ? "IA" : null,
      confianza_ia: categoriaId ? f.confianza : null,
      hash_linea: huella(f.fecha, descripcion, f.monto, f.naturaleza, referencia),
    });
  }
  resultado.interpretadas = filas.length;

  if (filas.length > 0) {
    const { data, error } = await sb
      .from("movimientos_extracto")
      .upsert(filas, { onConflict: "entidad_id,cuenta_id,hash_linea", ignoreDuplicates: true })
      .select("id");
    if (error) throw new Error(`No se pudieron guardar los gastos: ${error.message}`);
    resultado.registradas = data?.length ?? 0;
  }

  return resultado;
}
