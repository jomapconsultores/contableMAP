import { contexto, ErrorPeticion } from "@/lib/api";
import { NoAutorizado } from "@/lib/supabase/server";
import { generarRide, type DatosRide } from "@/lib/sri/ride";
import { leyendaRegimen } from "@/lib/sri/catalogos";

export const dynamic = "force-dynamic";

const ETIQUETAS: Record<string, string> = {
  "0": "0 %",
  "5": "5 %",
  "8": "8 %",
  "15": "15 %",
  NO_OBJETO: "no objeto de IVA",
  EXENTO: "exento de IVA",
};

/**
 * RIDE de la factura, listo para imprimir o guardar como PDF desde el
 * navegador. Se devuelve como HTML y no como PDF para no arrastrar un motor
 * de composición al servidor: el diálogo de impresión del navegador produce
 * el mismo documento.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { sb, entidadId } = await contexto();

    const { data: venta } = await sb.from("ventas").select("*").eq("id", id).maybeSingle();
    if (!venta) throw new ErrorPeticion("La factura no existe.", 404);
    if (!venta.clave_acceso) throw new ErrorPeticion("Esa venta no se emitió electrónicamente.", 409);

    const [{ data: items }, { data: config }, { data: entidad }, { data: punto }] = await Promise.all([
      sb.from("venta_items").select("*").eq("venta_id", id).order("orden", { ascending: true }),
      sb
        .from("sri_config")
        .select("dir_matriz, num_resolucion_especial, email_emisor, telefono_emisor")
        .eq("entidad_id", entidadId)
        .maybeSingle(),
      sb
        .from("entidades")
        .select("razon_social, nombre_comercial, ruc, direccion, obligado_contabilidad, regimen")
        .eq("id", entidadId)
        .single(),
      venta.punto_emision_id
        ? sb.from("puntos_emision").select("direccion").eq("id", venta.punto_emision_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    if (!entidad) throw new ErrorPeticion("No se encontró la entidad emisora.", 404);

    const lineas = items ?? [];

    const porTarifa = ["0", "5", "8", "15", "NO_OBJETO", "EXENTO"]
      .map((t) => ({
        etiqueta: ETIQUETAS[t],
        base: lineas
          .filter((i) => i.tarifa === t)
          .reduce((s, i) => s + Number(i.base), 0),
      }))
      .filter((t) => t.base > 0);

    const datos: DatosRide = {
      emisor: {
        razonSocial: entidad.razon_social,
        nombreComercial: entidad.nombre_comercial,
        ruc: entidad.ruc,
        dirMatriz: config?.dir_matriz ?? entidad.direccion ?? "",
        dirEstablecimiento: punto?.direccion ?? entidad.direccion,
        obligadoContabilidad: entidad.obligado_contabilidad,
        contribuyenteEspecial: config?.num_resolucion_especial ?? null,
        leyendaRegimen: leyendaRegimen(entidad.regimen),
        email: config?.email_emisor ?? null,
        telefono: config?.telefono_emisor ?? null,
      },
      comprobante: {
        numero: venta.numero,
        claveAcceso: venta.clave_acceso,
        ambiente: Number(venta.sri_ambiente ?? 1),
        tipoEmision: 1,
        fechaEmision: new Date(`${venta.fecha}T12:00:00`).toLocaleDateString("es-EC"),
        estado: venta.sri_estado,
        autorizacion: venta.autorizacion,
        fechaAutorizacion: venta.sri_fecha_autorizacion
          ? new Date(venta.sri_fecha_autorizacion).toLocaleString("es-EC")
          : null,
      },
      cliente: {
        razonSocial: venta.razon_social_cliente,
        identificacion: venta.id_cliente ?? "",
        direccion: venta.direccion_cliente,
        email: venta.email_cliente,
        telefono: venta.telefono_cliente,
      },
      items: lineas.map((i) => ({
        codigoPrincipal: i.codigo_principal,
        descripcion: i.descripcion,
        cantidad: Number(i.cantidad),
        precioUnitario: Number(i.precio_unitario),
        descuento: Number(i.descuento),
        base: Number(i.base),
      })),
      totales: {
        porTarifa,
        totalSinImpuestos: lineas.reduce((s, i) => s + Number(i.base), 0),
        totalDescuento: Number(venta.descuento ?? 0),
        iva: Number(venta.iva_5 ?? 0) + Number(venta.iva_8 ?? 0) + Number(venta.iva_15 ?? 0),
        propina: Number(venta.propina ?? 0),
        importeTotal: Number(venta.total ?? 0),
      },
      pagos: venta.forma_pago_sri
        ? [{ formaPago: venta.forma_pago_sri, total: Number(venta.total ?? 0) }]
        : [],
      mensajes: Array.isArray(venta.sri_mensajes) ? venta.sri_mensajes : [],
    };

    return new Response(generarRide(datos), {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    if (e instanceof NoAutorizado) return new Response("No autorizado", { status: 401 });
    if (e instanceof ErrorPeticion) return new Response(e.message, { status: e.estado });
    console.error("[ride]", e);
    return new Response("No se pudo generar el RIDE.", { status: 500 });
  }
}
