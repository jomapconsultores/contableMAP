import { z } from "zod";

/**
 * Esquemas de todo lo que la IA devuelve. Se usan dos veces: para generar el
 * JSON Schema que restringe la respuesta del modelo y para validar lo que
 * llega antes de tocar la base de datos.
 *
 * Regla: nada opcional, todo `.nullable()`. Las salidas estructuradas exigen
 * que cada propiedad esté en `required`, y un campo ausente es indistinguible
 * de un campo que el modelo decidió omitir.
 */

const importe = z.number();
const fechaISO = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Se espera una fecha AAAA-MM-DD");

// ---------------------------------------------------------------------------
// Estados de cuenta: tarjeta de crédito, banco, cooperativa
// ---------------------------------------------------------------------------
export const LineaExtracto = z.object({
  fecha: fechaISO,
  descripcion: z.string(),
  /** Comercio normalizado, sin códigos de terminal ni ciudad. */
  comercio: z.string().nullable(),
  referencia: z.string().nullable(),
  /**
   * DEBITO: sale dinero de la cuenta o aumenta la deuda de la tarjeta.
   * CREDITO: entra dinero o disminuye la deuda (pagos, notas de crédito).
   */
  naturaleza: z.enum(["DEBITO", "CREDITO"]),
  monto: importe.positive(),
  moneda: z.string().nullable(),
});

export const ExtractoExtraido = z.object({
  institucion: z.string().nullable(),
  tipo_cuenta: z.enum(["BANCO", "TARJETA_CREDITO", "COOPERATIVA", "OTRO"]),
  numero_cuenta: z.string().nullable(),
  titular: z.string().nullable(),
  periodo_desde: fechaISO.nullable(),
  periodo_hasta: fechaISO.nullable(),
  saldo_anterior: importe.nullable(),
  saldo_actual: importe.nullable(),
  /** Solo tarjetas de crédito. */
  pago_minimo: importe.nullable(),
  fecha_pago: fechaISO.nullable(),
  movimientos: z.array(LineaExtracto),
  /** Advertencias del modelo: páginas ilegibles, totales que no cuadran, etc. */
  observaciones: z.array(z.string()),
});

// ---------------------------------------------------------------------------
// Facturas (compra y venta)
// ---------------------------------------------------------------------------
export const FacturaExtraida = z.object({
  tipo_comprobante: z.enum([
    "FACTURA",
    "NOTA_VENTA",
    "LIQUIDACION_COMPRA",
    "NOTA_CREDITO",
    "NOTA_DEBITO",
    "TIQUETE",
    "OTRO",
  ]),
  fecha: fechaISO,
  establecimiento: z.string().nullable(),
  punto_emision: z.string().nullable(),
  secuencial: z.string().nullable(),
  autorizacion: z.string().nullable(),
  clave_acceso: z.string().nullable(),
  ruc_emisor: z.string().nullable(),
  nombre_emisor: z.string().nullable(),
  identificacion_receptor: z.string().nullable(),
  nombre_receptor: z.string().nullable(),
  /** Bases por tarifa de IVA vigente en Ecuador. */
  base_0: importe,
  base_5: importe,
  base_8: importe,
  base_15: importe,
  no_objeto_iva: importe,
  exento_iva: importe,
  iva_5: importe,
  iva_8: importe,
  iva_15: importe,
  ice: importe,
  descuento: importe,
  propina: importe,
  total: importe,
  concepto: z.string().nullable(),
  forma_pago: z.string().nullable(),
  observaciones: z.array(z.string()),
});

// ---------------------------------------------------------------------------
// Rol de pago
// ---------------------------------------------------------------------------
export const RolPagoExtraido = z.object({
  anio: z.number().int(),
  mes: z.number().int().min(1).max(12),
  ruc_empleador: z.string().nullable(),
  nombre_empleador: z.string(),
  nombre_empleado: z.string().nullable(),
  sueldo: importe,
  horas_extra: importe,
  comisiones: importe,
  bonos: importe,
  fondos_reserva: importe,
  decimo_tercero: importe,
  decimo_cuarto: importe,
  otros_ingresos: importe,
  total_ingresos: importe,
  aporte_iess: importe,
  impuesto_renta: importe,
  prestamos_iess: importe,
  anticipos: importe,
  otros_descuentos: importe,
  total_descuentos: importe,
  liquido_recibir: importe,
  observaciones: z.array(z.string()),
});

// ---------------------------------------------------------------------------
// Clasificación de gastos (criterio tributos-web)
// ---------------------------------------------------------------------------
export const ItemClasificado = z.object({
  /** Índice del movimiento en el lote enviado. */
  indice: z.number().int(),
  /** Nombre exacto de una categoría del catálogo, o SIN CLASIFICAR. */
  categoria: z.string(),
  /** Comercio normalizado, para alimentar el mapa de aprendizaje. */
  comercio: z.string().nullable(),
  /** 0 a 1. Por debajo de 0.7 el movimiento queda para revisión manual. */
  confianza: z.number().min(0).max(1),
  motivo: z.string(),
});

export const LoteClasificado = z.object({
  items: z.array(ItemClasificado),
});

// ---------------------------------------------------------------------------
// Entrada por voz
// ---------------------------------------------------------------------------
export const MovimientoDictado = z.object({
  /**
   * Qué quiso registrar el usuario. Determina el asiento que se propone.
   */
  operacion: z.enum([
    "GASTO",
    "INGRESO",
    "COMPRA",
    "VENTA",
    "COBRO",
    "PAGO",
    "TRANSFERENCIA",
    "CUENTA_POR_COBRAR",
    "CUENTA_POR_PAGAR",
    "DESCONOCIDO",
  ]),
  fecha: fechaISO.nullable(),
  descripcion: z.string(),
  contraparte: z.string().nullable(),
  identificacion_contraparte: z.string().nullable(),
  /** Monto total incluido IVA cuando el usuario lo dicta así. */
  monto_total: importe.nullable(),
  base_imponible: importe.nullable(),
  tarifa_iva: z.number().nullable(),
  iva: importe.nullable(),
  categoria: z.string().nullable(),
  /** Nombre de la cuenta bancaria/tarjeta mencionada, si la hubo. */
  cuenta_financiera: z.string().nullable(),
  forma_pago: z.string().nullable(),
  a_credito: z.boolean(),
  fecha_vencimiento: fechaISO.nullable(),
  confianza: z.number().min(0).max(1),
  /** Qué falta para poder contabilizar. Vacío si está completo. */
  faltantes: z.array(z.string()),
  interpretacion: z.string(),
});

export type LineaExtracto = z.infer<typeof LineaExtracto>;
export type ExtractoExtraido = z.infer<typeof ExtractoExtraido>;
export type FacturaExtraida = z.infer<typeof FacturaExtraida>;
export type RolPagoExtraido = z.infer<typeof RolPagoExtraido>;
export type LoteClasificado = z.infer<typeof LoteClasificado>;
export type ItemClasificado = z.infer<typeof ItemClasificado>;
export type MovimientoDictado = z.infer<typeof MovimientoDictado>;
