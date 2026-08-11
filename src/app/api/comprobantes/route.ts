import { contexto, manejar, ErrorPeticion } from "@/lib/api";
import { contabilizarCompra, contabilizarVenta } from "@/lib/contabilizacion";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Clase = "compras" | "ventas";

function claseValida(v: unknown): Clase {
  if (v !== "compras" && v !== "ventas") {
    throw new ErrorPeticion("La clase debe ser 'compras' o 'ventas'.");
  }
  return v;
}

/** Lista comprobantes de compra o de venta. */
export async function GET(request: Request) {
  return manejar(async () => {
    const url = new URL(request.url);
    const clase = claseValida(url.searchParams.get("clase") ?? "compras");
    const { sb, entidadId } = await contexto(url.searchParams.get("entidad_id"));

    const columnas =
      clase === "compras"
        ? "id, fecha, numero, tipo_comprobante, ruc_proveedor, nombre_proveedor, base_0, base_5, base_8, base_15, no_objeto_iva, exento_iva, iva_5, iva_8, iva_15, total, categoria_id, categorias_gasto(nombre), rubro_personal, da_credito_iva, deducible_ir, a_credito, asiento_id, estado, confianza_ia, clasificado_por"
        : "id, fecha, numero, tipo_comprobante, id_cliente, razon_social_cliente, base_0, base_5, base_8, base_15, no_objeto_iva, exento_iva, iva_5, iva_8, iva_15, total, a_credito, asiento_id, estado";

    let q = sb
      .from(clase)
      .select(columnas)
      .eq("entidad_id", entidadId)
      .order("fecha", { ascending: false })
      .limit(Number(url.searchParams.get("limite") ?? 200));

    const estado = url.searchParams.get("estado");
    if (estado === "sin_contabilizar") q = q.is("asiento_id", null);
    if (estado === "sin_clasificar" && clase === "compras") q = q.is("categoria_id", null);

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
 * Ajusta un comprobante antes de contabilizarlo: categoría, tratamiento
 * tributario y forma de pago. Una vez contabilizado queda bloqueado.
 */
export async function PATCH(request: Request) {
  return manejar(async () => {
    const b = (await request.json()) as Record<string, unknown>;
    const clase = claseValida(b.clase);
    const id = String(b.id ?? "");
    if (!id) throw new ErrorPeticion("Falta el id del comprobante.");

    const { sb } = await contexto();

    const { data: actual } = await sb
      .from(clase)
      .select("asiento_id")
      .eq("id", id)
      .maybeSingle();

    if (!actual) throw new ErrorPeticion("Comprobante no encontrado.", 404);
    if (actual.asiento_id) {
      throw new ErrorPeticion(
        "El comprobante ya está contabilizado. Anula el asiento antes de modificarlo.",
        409,
      );
    }

    const cambios: Record<string, unknown> = {};
    if (b.a_credito !== undefined) cambios.a_credito = Boolean(b.a_credito);
    if (b.fecha_vencimiento !== undefined) cambios.fecha_vencimiento = b.fecha_vencimiento;
    if (b.cuenta_financiera_id !== undefined) {
      cambios.cuenta_financiera_id = b.cuenta_financiera_id || null;
    }

    if (clase === "compras") {
      if (b.da_credito_iva !== undefined) cambios.da_credito_iva = Boolean(b.da_credito_iva);
      if (b.deducible_ir !== undefined) cambios.deducible_ir = Boolean(b.deducible_ir);

      // Cambiar la categoría arrastra su tratamiento tributario y enseña al
      // mapa de clasificación para las próximas facturas del mismo RUC.
      if (b.categoria_id) {
        const { data: cat } = await sb
          .from("categorias_gasto")
          .select("id, rubro_personal, deducible_negocio, credito_iva")
          .eq("id", String(b.categoria_id))
          .maybeSingle();
        if (!cat) throw new ErrorPeticion("La categoría no existe.");

        cambios.categoria_id = cat.id;
        cambios.clasificado_por = "MANUAL";
        cambios.confianza_ia = null;
        cambios.rubro_personal = cat.rubro_personal;
        if (b.deducible_ir === undefined) cambios.deducible_ir = cat.deducible_negocio;
        if (b.da_credito_iva === undefined) cambios.da_credito_iva = cat.credito_iva;

        const { data: compra } = await sb
          .from("compras")
          .select("entidad_id, ruc_proveedor, nombre_proveedor")
          .eq("id", id)
          .single();

        if (compra?.ruc_proveedor) {
          await sb.from("mapa_clasificacion").upsert(
            {
              entidad_id: compra.entidad_id,
              tipo_clave: "RUC",
              clave: compra.ruc_proveedor,
              nombre_origen: compra.nombre_proveedor,
              categoria_id: cat.id,
              origen: "MANUAL",
              confirmado: true,
            },
            { onConflict: "entidad_id,tipo_clave,clave" },
          );
        }
      }
    } else if (b.cuenta_ingreso_id !== undefined) {
      cambios.cuenta_ingreso_id = b.cuenta_ingreso_id || null;
    }

    if (Object.keys(cambios).length === 0) {
      throw new ErrorPeticion("No se indicó ningún cambio.");
    }

    const { error } = await sb.from(clase).update(cambios).eq("id", id);
    if (error) throw new ErrorPeticion(error.message, 500);
    return { id, cambios };
  });
}

/** Contabiliza uno, varios o todos los comprobantes pendientes. */
export async function POST(request: Request) {
  return manejar(async () => {
    const b = (await request.json()) as { clase?: unknown; ids?: string[] };
    const clase = claseValida(b.clase);
    const { sb, entidadId } = await contexto();

    let objetivo = b.ids ?? [];
    if (objetivo.length === 0) {
      const { data } = await sb
        .from(clase)
        .select("id")
        .eq("entidad_id", entidadId)
        .is("asiento_id", null)
        .neq("estado", "ANULADA")
        .limit(300);
      objetivo = (data ?? []).map((r) => r.id as string);
    }

    const contabilizar = clase === "compras" ? contabilizarCompra : contabilizarVenta;
    const errores: { id: string; error: string }[] = [];
    let hechos = 0;

    for (const id of objetivo) {
      try {
        await contabilizar(sb, entidadId, id);
        hechos += 1;
      } catch (e) {
        errores.push({ id, error: e instanceof Error ? e.message : "Error" });
      }
    }

    return { contabilizados: hechos, pendientes: objetivo.length, errores };
  });
}
