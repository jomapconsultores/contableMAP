import { contexto, manejar, ErrorPeticion } from "@/lib/api";
import { encolar, estaEnCola } from "@/lib/procesamiento";

export const dynamic = "force-dynamic";

/**
 * Pone el documento en la cola de la IA y responde en el acto. El avance se
 * consulta en GET /api/documentos/{id}; ver `src/lib/procesamiento.ts`.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return manejar(async () => {
    const { id } = await params;
    const { sb, userId, entidadId } = await contexto();

    // Leído con la sesión: si el RLS lo deja ver, es de este usuario.
    const { data: doc, error } = await sb
      .from("documentos")
      .select("id, estado")
      .eq("id", id)
      .single();
    if (error || !doc) throw new ErrorPeticion("Documento no encontrado.", 404);

    if (estaEnCola(id)) return { id, estado: "PROCESANDO" };

    await sb
      .from("documentos")
      .update({ estado: "PROCESANDO", error_mensaje: null, resumen: "En cola para la IA" })
      .eq("id", id);

    encolar(id, userId, entidadId);
    return { id, estado: "PROCESANDO" };
  });
}
