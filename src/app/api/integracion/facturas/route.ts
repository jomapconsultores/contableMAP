import { z } from "zod";
import { entidadPorRuc, responder as responderIntegracion } from "@/lib/integracion";
import { ErrorPeticion } from "@/lib/api";
import { emitirFactura, FacturaAEmitir } from "@/lib/sri/emision";
import { calcularTotales } from "@/lib/sri/xml";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Entrada para otro sistema, sin sesión de navegador: el Gestor Tributario
 * (tributos-web) factura por aquí los honorarios de los contribuyentes que
 * cobra Marco Antonio. Lo de CMAJ sigue en Odoo.
 *
 * Se protege con un token compartido (INTEGRACION_TOKEN) en
 * `Authorization: Bearer …`. Como no hay usuario, se trabaja con el cliente de
 * service role y la entidad se fija por su RUC: nunca "la primera que haya".
 *
 * Cada factura lleva una `referencia` (HON-AAAA-MM, el mes de honorarios que
 * cubre). Volver a mandar la misma referencia para el mismo cliente devuelve la
 * factura que ya existe en vez de emitir otra.
 */

const Emitir = z.object({
  entidad_ruc: z.string().regex(/^[0-9]{13}$/).nullish(),
  referencia: z.string().regex(/^HON-[0-9]{4}-[0-9]{2}$/),
  tipo_id_cliente: z.enum(["RUC", "CEDULA", "PASAPORTE"]),
  id_cliente: z.string().min(1).max(20),
  razon_social_cliente: z.string().min(1).max(300),
  email_cliente: z.string().email().nullish().or(z.literal("")),
  concepto: z.string().max(300).nullish(),
  items: z
    .array(
      z.object({
        descripcion: z.string().min(1).max(300),
        precio_unitario: z.number().min(0),
        descuento: z.number().min(0).default(0),
      }),
    )
    .min(1),
  forma_pago: z.string().default("20"),
  simular: z.boolean().default(false),
});

// Las que cuentan como emitidas: una NO_AUTORIZADA o anulada no bloquea volver
// a facturar el mes.
const VIGENTE = (v: { sri_estado: string; estado: string }) =>
  v.sri_estado !== "NO_AUTORIZADA" && v.estado !== "ANULADA";

function responder<T>(fn: () => Promise<T>, request: Request) {
  return responderIntegracion(request, "INTEGRACION_TOKEN", fn);
}

/** Facturas de una referencia (HON-AAAA-MM), para saber a quién ya se le facturó el mes. */
export async function GET(request: Request) {
  return responder(async () => {
    const url = new URL(request.url);
    const referencia = url.searchParams.get("referencia") || "";
    if (!/^HON-[0-9]{4}-[0-9]{2}$/.test(referencia)) {
      throw new ErrorPeticion("referencia debe ser HON-AAAA-MM.");
    }
    const { sb, entidad } = await entidadPorRuc(url.searchParams.get("entidad_ruc"));
    const { data, error } = await sb
      .from("ventas")
      .select("id, fecha, numero, id_cliente, razon_social_cliente, total, sri_estado, autorizacion, estado, concepto")
      .eq("entidad_id", entidad.id)
      .ilike("concepto", `%${referencia}%`)
      .order("created_at", { ascending: false });
    if (error) throw new ErrorPeticion(error.message, 500);
    return (data || []).filter(VIGENTE);
  }, request);
}

/** Emite (o devuelve la ya emitida) la factura de honorarios de un mes. */
export async function POST(request: Request) {
  return responder(async () => {
    const analisis = Emitir.safeParse(await request.json());
    if (!analisis.success) {
      const primero = analisis.error.issues[0];
      throw new ErrorPeticion(`${primero.path.join(".") || "factura"}: ${primero.message}`);
    }
    const e = analisis.data;
    const { sb, entidad } = await entidadPorRuc(e.entidad_ruc);

    const { data: previas } = await sb
      .from("ventas")
      .select("id, numero, total, sri_estado, autorizacion, estado, clave_acceso")
      .eq("entidad_id", entidad.id)
      .eq("id_cliente", e.id_cliente)
      .ilike("concepto", `%${e.referencia}%`)
      .order("created_at", { ascending: false });
    const previa = (previas || []).find(VIGENTE);
    if (previa) {
      return {
        ya_existia: true,
        venta_id: previa.id,
        numero: previa.numero,
        total: Number(previa.total),
        estado: previa.sri_estado,
        autorizacion: previa.autorizacion,
        clave_acceso: previa.clave_acceso,
        mensajes: [],
      };
    }

    const items = e.items.map((i, n) => ({
      codigo_principal: `HON${String(n + 1).padStart(2, "0")}`,
      descripcion: i.descripcion,
      cantidad: 1,
      precio_unitario: i.precio_unitario,
      descuento: i.descuento,
      tarifa: "15" as const,
    }));
    // El pago tiene que sumar exactamente lo que el XML va a calcular.
    const { importeTotal } = calcularTotales({
      items: items.map((i) => ({
        codigoPrincipal: i.codigo_principal,
        descripcion: i.descripcion,
        cantidad: i.cantidad,
        precioUnitario: i.precio_unitario,
        descuento: i.descuento,
        tarifa: i.tarifa,
      })),
    });

    const factura = FacturaAEmitir.parse({
      tipo_id_cliente: e.tipo_id_cliente,
      id_cliente: e.id_cliente,
      razon_social_cliente: e.razon_social_cliente,
      email_cliente: e.email_cliente || null,
      concepto: `${e.concepto || "Honorarios"} (${e.referencia})`,
      items,
      pagos: [{ forma_pago: e.forma_pago, total: importeTotal }],
      simular: e.simular,
    });
    const r = await emitirFactura(sb, entidad.id, entidad.user_id, factura);
    return { ya_existia: false, ...r, xml_firmado: undefined };
  }, request);
}
