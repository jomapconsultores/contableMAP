import { contexto, manejar, ErrorPeticion } from "@/lib/api";
import { estaEnCola, YA_CARGADO } from "@/lib/procesamiento";

export const dynamic = "force-dynamic";

/** Estado de un documento, para seguir su procesamiento desde la pantalla. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return manejar(async () => {
    const { id } = await params;
    const { sb } = await contexto();

    const { data: doc, error } = await sb
      .from("documentos")
      .select("id, estado, resumen, error_mensaje, extraccion")
      .eq("id", id)
      .single();
    if (error || !doc) throw new ErrorPeticion("Documento no encontrado.", 404);

    const extraccion = doc.extraccion as { observaciones?: string[] } | null;
    return {
      id: doc.id,
      estado: doc.estado,
      resumen: doc.resumen,
      error: doc.error_mensaje,
      observaciones: extraccion?.observaciones ?? [],
      duplicado: (doc.resumen ?? "").startsWith(YA_CARGADO),
      // PROCESANDO sin estar en la cola: el servidor se reinició a mitad. La
      // pantalla puede volver a pedir el proceso.
      huerfano: doc.estado === "PROCESANDO" && !estaEnCola(id),
    };
  });
}
