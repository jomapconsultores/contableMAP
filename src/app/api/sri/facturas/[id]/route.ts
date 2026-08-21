import { contexto, manejar, ErrorPeticion } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Una factura electrónica con su detalle y el historial de envíos al SRI. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return manejar(async () => {
    const { id } = await params;
    const { sb } = await contexto();

    const { data: venta } = await sb
      .from("ventas")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (!venta) throw new ErrorPeticion("La factura no existe.", 404);

    const { data: items } = await sb
      .from("venta_items")
      .select("*")
      .eq("venta_id", id)
      .order("orden", { ascending: true });

    const { data: envios } = await sb
      .from("sri_envios")
      .select("paso, estado, mensajes, duracion_ms, created_at")
      .eq("venta_id", id)
      .order("created_at", { ascending: false });

    return { venta, items: items ?? [], envios: envios ?? [] };
  });
}
