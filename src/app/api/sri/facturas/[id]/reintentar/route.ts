import { contexto, manejar } from "@/lib/api";
import { reintentarEnvio } from "@/lib/sri/emision";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Reintenta una factura que quedó firmada, devuelta o en la cola del SRI.
 *
 * Reutiliza la clave de acceso y el XML ya firmados: volver a generarlos
 * gastaría otro secuencial y dejaría un hueco en la numeración.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return manejar(async () => {
    const { id } = await params;
    const { sb, userId, entidadId } = await contexto();
    return reintentarEnvio(sb, entidadId, userId, id);
  });
}
