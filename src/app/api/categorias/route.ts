import { contexto, manejar, ErrorPeticion } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Catálogo de categorías de gasto de la entidad activa. */
export async function GET() {
  return manejar(async () => {
    const { sb, entidadId } = await contexto();
    const { data, error } = await sb
      .from("categorias_gasto")
      .select("id, nombre, rubro_personal, deducible_negocio, credito_iva")
      .eq("entidad_id", entidadId)
      .eq("activo", true)
      .order("nombre");
    if (error) throw new ErrorPeticion(error.message, 500);
    return data;
  });
}
