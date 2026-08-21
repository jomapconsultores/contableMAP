import { contexto, manejar, ErrorPeticion } from "@/lib/api";
import { emitirFactura, FacturaAEmitir } from "@/lib/sri/emision";

export const dynamic = "force-dynamic";
// Recepción y autorización son dos llamadas al SRI con esperas entre medias.
export const maxDuration = 120;

/** Facturas electrónicas emitidas y su estado ante el SRI. */
export async function GET(request: Request) {
  return manejar(async () => {
    const url = new URL(request.url);
    const { sb, entidadId } = await contexto(url.searchParams.get("entidad_id"));

    let q = sb
      .from("ventas")
      .select(
        "id, fecha, numero, razon_social_cliente, id_cliente, total, sri_estado, sri_ambiente, clave_acceso, autorizacion, sri_fecha_autorizacion, sri_mensajes, asiento_id, estado",
      )
      .eq("entidad_id", entidadId)
      .not("clave_acceso", "is", null)
      .order("fecha", { ascending: false })
      .order("numero", { ascending: false })
      .limit(Number(url.searchParams.get("limite") ?? 200));

    const estado = url.searchParams.get("estado");
    if (estado === "pendientes") q = q.neq("sri_estado", "AUTORIZADA");
    else if (estado) q = q.eq("sri_estado", estado);

    const desde = url.searchParams.get("desde");
    const hasta = url.searchParams.get("hasta");
    if (desde) q = q.gte("fecha", desde);
    if (hasta) q = q.lte("fecha", hasta);

    const { data, error } = await q;
    if (error) throw new ErrorPeticion(error.message, 500);
    return data;
  });
}

/**
 * Emite una factura: genera el XML, lo firma y lo manda al SRI.
 *
 * Con `simular: true` se queda en el XML firmado sin enviar nada, que es lo
 * que conviene la primera vez que se configura un certificado.
 */
export async function POST(request: Request) {
  return manejar(async () => {
    const cuerpo = await request.json();
    const analisis = FacturaAEmitir.safeParse(cuerpo);

    if (!analisis.success) {
      const primero = analisis.error.issues[0];
      throw new ErrorPeticion(
        `${primero.path.join(".") || "factura"}: ${primero.message}`,
      );
    }

    const { sb, userId, entidadId } = await contexto(
      (cuerpo as { entidad_id?: string }).entidad_id ?? null,
    );

    return emitirFactura(sb, entidadId, userId, analisis.data);
  });
}
