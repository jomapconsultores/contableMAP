import { contexto, ErrorPeticion } from "@/lib/api";
import { NoAutorizado } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Descarga el XML de la factura. Por defecto el autorizado, que es el
 * documento con validez tributaria; con `?tipo=firmado`, el que se envió.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const tipo = new URL(request.url).searchParams.get("tipo") ?? "autorizado";
    const { sb } = await contexto();

    const { data: venta } = await sb
      .from("ventas")
      .select("clave_acceso, xml_firmado_path, xml_autorizado_path, sri_estado")
      .eq("id", id)
      .maybeSingle();

    if (!venta) throw new ErrorPeticion("La factura no existe.", 404);

    const ruta =
      tipo === "firmado"
        ? (venta.xml_firmado_path as string | null)
        : ((venta.xml_autorizado_path ?? venta.xml_firmado_path) as string | null);

    if (!ruta) {
      throw new ErrorPeticion(
        venta.sri_estado === "AUTORIZADA"
          ? "No se guardó el XML de esta factura."
          : `La factura está en estado ${venta.sri_estado}: todavía no hay XML autorizado.`,
        404,
      );
    }

    const { data, error } = await sb.storage.from("comprobantes").download(ruta);
    if (error || !data) throw new ErrorPeticion("No se pudo leer el archivo.", 500);

    const sufijo = ruta.endsWith("-autorizado.xml") ? "-autorizado" : "";

    return new Response(await data.arrayBuffer(), {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Content-Disposition": `attachment; filename="${venta.clave_acceso}${sufijo}.xml"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    if (e instanceof NoAutorizado) return new Response("No autorizado", { status: 401 });
    if (e instanceof ErrorPeticion) return new Response(e.message, { status: e.estado });
    console.error("[xml]", e);
    return new Response("No se pudo descargar el XML.", { status: 500 });
  }
}
