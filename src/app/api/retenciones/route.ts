import { contexto, manejar, ErrorPeticion } from "@/lib/api";
import { contabilizarRetencion } from "@/lib/contabilizacion";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  return manejar(async () => {
    const url = new URL(request.url);
    const { sb, entidadId } = await contexto(url.searchParams.get("entidad_id"));

    let q = sb
      .from("retenciones")
      .select(
        "id, clase, fecha, numero, ruc_contraparte, nombre_contraparte, base_renta, porc_renta, ret_renta, base_iva, porc_iva, ret_iva, ret_isd, total_retenido, asiento_id, estado",
      )
      .eq("entidad_id", entidadId)
      .order("fecha", { ascending: false })
      .limit(200);

    const clase = url.searchParams.get("clase");
    if (clase === "RECIBIDA" || clase === "EFECTUADA") q = q.eq("clase", clase);

    const { data, error } = await q;
    if (error) throw new ErrorPeticion(error.message, 500);
    return data;
  });
}

/**
 * Registra un comprobante de retención y lo contabiliza. Las recibidas
 * alimentan el crédito tributario de IVA y de renta.
 */
export async function POST(request: Request) {
  return manejar(async () => {
    const b = (await request.json()) as Record<string, unknown>;
    const clase = String(b.clase ?? "");
    const fecha = String(b.fecha ?? "");
    const ruc = String(b.ruc_contraparte ?? "").trim();
    const nombre = String(b.nombre_contraparte ?? "").trim();

    if (clase !== "RECIBIDA" && clase !== "EFECTUADA") {
      throw new ErrorPeticion("La clase debe ser RECIBIDA o EFECTUADA.");
    }
    if (!fecha) throw new ErrorPeticion("Indica la fecha del comprobante.");
    if (!ruc || !nombre) throw new ErrorPeticion("Indica el RUC y el nombre de la contraparte.");

    const n = (v: unknown) => {
      const x = Number(v ?? 0);
      if (!Number.isFinite(x) || x < 0) throw new ErrorPeticion("Los valores no pueden ser negativos.");
      return x;
    };

    const retRenta = n(b.ret_renta);
    const retIva = n(b.ret_iva);
    const retIsd = n(b.ret_isd);

    if (retRenta + retIva + retIsd <= 0) {
      throw new ErrorPeticion("El comprobante no tiene ningún valor retenido.");
    }

    const { sb, entidadId } = await contexto();

    const { data, error } = await sb
      .from("retenciones")
      .insert({
        entidad_id: entidadId,
        clase,
        fecha,
        numero: b.numero ? String(b.numero) : null,
        autorizacion: b.autorizacion ? String(b.autorizacion) : null,
        periodo_fiscal: b.periodo_fiscal ? String(b.periodo_fiscal) : fecha.slice(0, 7),
        ruc_contraparte: ruc,
        nombre_contraparte: nombre,
        base_renta: n(b.base_renta),
        porc_renta: n(b.porc_renta),
        ret_renta: retRenta,
        codigo_renta: b.codigo_renta ? String(b.codigo_renta) : null,
        base_iva: n(b.base_iva),
        porc_iva: n(b.porc_iva),
        ret_iva: retIva,
        codigo_iva: b.codigo_iva ? String(b.codigo_iva) : null,
        ret_isd: retIsd,
        venta_id: b.venta_id ? String(b.venta_id) : null,
        compra_id: b.compra_id ? String(b.compra_id) : null,
      })
      .select("id, clase, total_retenido")
      .single();

    if (error) throw new ErrorPeticion(error.message, 500);

    let asientoId: string | null = null;
    if (b.contabilizar !== false) {
      try {
        asientoId = await contabilizarRetencion(sb, entidadId, data.id);
      } catch (e) {
        return {
          ...data,
          asiento_id: null,
          aviso: e instanceof Error ? e.message : "No se pudo contabilizar",
        };
      }
    }

    return { ...data, asiento_id: asientoId };
  });
}
