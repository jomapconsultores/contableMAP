/**
 * Códigos de las tablas de la ficha técnica de comprobantes electrónicos.
 *
 * Igual criterio que `parametros_fiscales`: son datos del SRI, no lógica. Si
 * el SRI publica una tabla nueva se edita aquí, en un solo sitio, y ninguna
 * otra parte del sistema se entera.
 */

/** Tabla 3 · Tipo de comprobante */
export const TIPO_COMPROBANTE = {
  FACTURA: "01",
  LIQUIDACION_COMPRA: "03",
  NOTA_CREDITO: "04",
  NOTA_DEBITO: "05",
  GUIA_REMISION: "06",
  RETENCION: "07",
} as const;

/** Tabla 4 · Tipo de ambiente */
export const AMBIENTE = { PRUEBAS: 1, PRODUCCION: 2 } as const;

/** Tabla 6 · Tipo de identificación del comprador */
export const TIPO_ID_COMPRADOR: Record<string, string> = {
  RUC: "04",
  CEDULA: "05",
  PASAPORTE: "06",
  CONSUMIDOR_FINAL: "07",
  IDENT_EXTERIOR: "08",
};

/**
 * Tabla 17 · Código de porcentaje de IVA.
 *
 * Los códigos 2 (12 %) y 3 (14 %) siguen existiendo para comprobantes de
 * ejercicios anteriores; la tarifa general vigente es el 15 % (código 4).
 */
export const CODIGO_IVA: Record<string, string> = {
  "0": "0", // 0 %
  "5": "5", // 5 %
  "8": "8", // 8 % diferenciado
  "15": "4", // 15 % tarifa general
  NO_OBJETO: "6",
  EXENTO: "7",
};

/** Porcentaje numérico que corresponde a cada tarifa. */
export const PORCENTAJE_IVA: Record<string, number> = {
  "0": 0,
  "5": 5,
  "8": 8,
  "15": 15,
  NO_OBJETO: 0,
  EXENTO: 0,
};

/** Código de impuesto: 2 = IVA, 3 = ICE, 5 = IRBPNR */
export const IMPUESTO_IVA = "2";

/** Tabla 24 · Formas de pago */
export const FORMAS_PAGO: Record<string, string> = {
  "01": "Sin utilización del sistema financiero",
  "15": "Compensación de deudas",
  "16": "Tarjeta de débito",
  "17": "Dinero electrónico",
  "18": "Tarjeta prepago",
  "19": "Tarjeta de crédito",
  "20": "Otros con utilización del sistema financiero",
  "21": "Endoso de títulos",
};

/** Leyenda obligatoria del régimen, tal como debe constar en el comprobante. */
export function leyendaRegimen(regimen: string): string | null {
  if (regimen === "RIMPE_EMPRENDEDOR") return "CONTRIBUYENTE RÉGIMEN RIMPE";
  if (regimen === "RIMPE_NEGOCIO_POPULAR") return "CONTRIBUYENTE NEGOCIO POPULAR - RÉGIMEN RIMPE";
  return null;
}

/** Extremos de los web services por ambiente. */
export function endpoints(ambiente: number) {
  const host = ambiente === AMBIENTE.PRODUCCION ? "cel.sri.gob.ec" : "celcer.sri.gob.ec";
  const base = `https://${host}/comprobantes-electronicos-ws`;
  return {
    recepcion: `${base}/RecepcionComprobantesOffline`,
    autorizacion: `${base}/AutorizacionComprobantesOffline`,
  };
}
