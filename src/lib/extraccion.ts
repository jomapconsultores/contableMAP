import { bloqueArchivo, consultar, type Resultado } from "./ia";
import {
  ExtractoExtraido,
  FacturaExtraida,
  RolPagoExtraido,
} from "./esquemas";
import {
  SISTEMA_EXTRACTO,
  SISTEMA_FACTURA,
  SISTEMA_ROL,
} from "./prompts";

export type TipoDocumento =
  | "ESTADO_TARJETA"
  | "ESTADO_BANCO"
  | "ESTADO_COOPERATIVA"
  | "FACTURA_COMPRA"
  | "FACTURA_VENTA"
  | "ROL_PAGO";

const ETIQUETA: Record<TipoDocumento, string> = {
  ESTADO_TARJETA: "estado de cuenta de tarjeta de crédito",
  ESTADO_BANCO: "estado de cuenta bancario",
  ESTADO_COOPERATIVA: "estado de cuenta de cooperativa",
  FACTURA_COMPRA: "comprobante de compra recibido",
  FACTURA_VENTA: "comprobante de venta emitido",
  ROL_PAGO: "rol de pago",
};

export async function extraerExtracto(
  base64: string,
  mimeType: string,
  tipo: TipoDocumento,
): Promise<Resultado<ExtractoExtraido>> {
  return consultar({
    sistema: SISTEMA_EXTRACTO,
    esquema: ExtractoExtraido,
    maxTokens: 64000,
    contenido: [
      bloqueArchivo(base64, mimeType),
      {
        type: "text",
        text: `Este documento es un ${ETIQUETA[tipo]}. Extrae la cabecera y todos los movimientos del período.`,
      },
    ],
  });
}

export async function extraerFactura(
  base64: string,
  mimeType: string,
  tipo: "FACTURA_COMPRA" | "FACTURA_VENTA",
): Promise<Resultado<FacturaExtraida>> {
  return consultar({
    sistema: SISTEMA_FACTURA,
    esquema: FacturaExtraida,
    maxTokens: 16000,
    contenido: [
      bloqueArchivo(base64, mimeType),
      {
        type: "text",
        text: `Este documento es un ${ETIQUETA[tipo]}. Extrae todos sus datos tributarios.`,
      },
    ],
  });
}

export async function extraerRolPago(
  base64: string,
  mimeType: string,
): Promise<Resultado<RolPagoExtraido>> {
  return consultar({
    sistema: SISTEMA_ROL,
    esquema: RolPagoExtraido,
    maxTokens: 16000,
    contenido: [
      bloqueArchivo(base64, mimeType),
      { type: "text", text: "Extrae los datos de este rol de pago." },
    ],
  });
}
