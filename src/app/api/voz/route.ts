import { contexto, manejar, registrarIA, ErrorPeticion } from "@/lib/api";
import { consultar } from "@/lib/ia";
import { MovimientoDictado } from "@/lib/esquemas";
import { SISTEMA_VOZ } from "@/lib/prompts";
import { contabilizarCompra, contabilizarVenta } from "@/lib/contabilizacion";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const HOY = () => new Date().toISOString().slice(0, 10);

/**
 * Interpreta una instrucción dictada y, si se pide y está completa, la
 * registra y contabiliza.
 */
export async function POST(request: Request) {
  return manejar(async () => {
    const cuerpo = (await request.json()) as {
      texto?: string;
      registrar?: boolean;
      entidad_id?: string;
    };

    const texto = (cuerpo.texto ?? "").trim();
    if (texto.length < 3) throw new ErrorPeticion("No se recibió texto que interpretar.");
    if (texto.length > 4000) throw new ErrorPeticion("El dictado es demasiado largo.");

    const { sb, userId, entidadId } = await contexto(cuerpo.entidad_id);

    // Se entregan al modelo los catálogos reales para que no invente nombres.
    const [{ data: categorias }, { data: cuentas }] = await Promise.all([
      sb.from("categorias_gasto").select("nombre").eq("entidad_id", entidadId).eq("activo", true),
      sb.from("cuentas_financieras").select("nombre, tipo").eq("entidad_id", entidadId).eq("activo", true),
    ]);

    const contextoTexto = [
      `Fecha de hoy: ${HOY()}`,
      `Categorías disponibles: ${(categorias ?? []).map((c) => c.nombre).join(", ") || "ninguna"}`,
      `Cuentas financieras: ${(cuentas ?? []).map((c) => `${c.nombre} (${c.tipo})`).join(", ") || "ninguna"}`,
      "",
      "Texto dictado:",
      texto,
    ].join("\n");

    const { datos, uso } = await consultar({
      sistema: SISTEMA_VOZ,
      esquema: MovimientoDictado,
      maxTokens: 8000,
      esfuerzo: "medium",
      contenido: [{ type: "text", text: contextoTexto }],
    });

    await registrarIA(sb, entidadId, userId, "VOZ", uso);

    if (!cuerpo.registrar) {
      return { propuesta: datos, registrado: null };
    }

    if (datos.operacion === "DESCONOCIDO") {
      throw new ErrorPeticion(
        `No se entendió como una operación contable. ${datos.interpretacion}`,
      );
    }
    if (datos.faltantes.length > 0) {
      throw new ErrorPeticion(
        `Faltan datos para registrar: ${datos.faltantes.join("; ")}`,
      );
    }
    if (!datos.monto_total || datos.monto_total <= 0) {
      throw new ErrorPeticion("No se identificó el monto de la operación.");
    }

    const registrado = await registrar(sb, entidadId, datos);
    return { propuesta: datos, registrado };
  });
}

type Dictado = Awaited<ReturnType<typeof MovimientoDictado.parseAsync>>;

async function registrar(
  sb: Awaited<ReturnType<typeof contexto>>["sb"],
  entidadId: string,
  d: Dictado,
) {
  const fecha = d.fecha ?? HOY();
  const total = d.monto_total!;
  const iva = d.iva ?? 0;
  const base = d.base_imponible ?? Number((total - iva).toFixed(2));

  const cuentaFinanciera = d.cuenta_financiera
    ? (
        await sb
          .from("cuentas_financieras")
          .select("id")
          .eq("entidad_id", entidadId)
          .ilike("nombre", d.cuenta_financiera)
          .maybeSingle()
      ).data?.id ?? null
    : null;

  const esEgreso = ["GASTO", "COMPRA", "CUENTA_POR_PAGAR", "PAGO"].includes(d.operacion);

  if (esEgreso) {
    const categoria = d.categoria
      ? (
          await sb
            .from("categorias_gasto")
            .select("id, rubro_personal, deducible_negocio, credito_iva")
            .eq("entidad_id", entidadId)
            .ilike("nombre", d.categoria)
            .maybeSingle()
        ).data
      : null;

    const { data, error } = await sb
      .from("compras")
      .insert({
        entidad_id: entidadId,
        fecha,
        tipo_comprobante: "FACTURA",
        secuencial: `VOZ-${Date.now()}`,
        ruc_proveedor: d.identificacion_contraparte ?? "9999999999999",
        nombre_proveedor: d.contraparte ?? "Proveedor no identificado",
        base_15: iva > 0 ? base : 0,
        base_0: iva > 0 ? 0 : base,
        iva_15: iva,
        total,
        concepto: d.descripcion,
        categoria_id: categoria?.id ?? null,
        clasificado_por: "IA",
        confianza_ia: d.confianza,
        rubro_personal: categoria?.rubro_personal ?? null,
        deducible_ir: categoria?.deducible_negocio ?? true,
        da_credito_iva: (categoria?.credito_iva ?? true) && iva > 0,
        forma_pago: d.forma_pago,
        cuenta_financiera_id: cuentaFinanciera,
        a_credito: d.a_credito,
        fecha_vencimiento: d.fecha_vencimiento,
      })
      .select("id")
      .single();

    if (error) throw new ErrorPeticion(`No se pudo registrar el gasto: ${error.message}`, 500);

    const asientoId = await contabilizarCompra(sb, entidadId, data.id);
    return { tipo: "COMPRA", id: data.id, asiento_id: asientoId };
  }

  const { data, error } = await sb
    .from("ventas")
    .insert({
      entidad_id: entidadId,
      fecha,
      tipo_comprobante: "FACTURA",
      secuencial: `VOZ-${Date.now()}`,
      tipo_id_cliente: d.identificacion_contraparte ? "RUC" : "CONSUMIDOR_FINAL",
      id_cliente: d.identificacion_contraparte,
      razon_social_cliente: d.contraparte ?? "CONSUMIDOR FINAL",
      base_15: iva > 0 ? base : 0,
      base_0: iva > 0 ? 0 : base,
      iva_15: iva,
      total,
      concepto: d.descripcion,
      forma_pago: d.forma_pago,
      cuenta_financiera_id: cuentaFinanciera,
      a_credito: d.a_credito,
      fecha_vencimiento: d.fecha_vencimiento,
    })
    .select("id")
    .single();

  if (error) throw new ErrorPeticion(`No se pudo registrar el ingreso: ${error.message}`, 500);

  const asientoId = await contabilizarVenta(sb, entidadId, data.id);
  return { tipo: "VENTA", id: data.id, asiento_id: asientoId };
}
