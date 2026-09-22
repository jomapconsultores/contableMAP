import { z } from "zod";
import { ErrorPeticion } from "@/lib/api";
import { importarNotas, Nota } from "@/lib/efectivo";
import { entidadPorRuc, responder } from "@/lib/integracion";

export const dynamic = "force-dynamic";

/**
 * Gastos en efectivo desde Microsoft To Do. Los manda la tarea programada del
 * PC del titular (`deploy/todo-efectivo`); ver `src/lib/efectivo.ts`.
 *
 * Se protege con su propio token (EFECTIVO_TOKEN) y no con el de la
 * facturación, para que revocar uno no corte el otro.
 */

const Entrada = z.object({
  entidad_ruc: z.string().regex(/^[0-9]{13}$/).nullish(),
  // Pocas notas por petición: el modelo corre en local y Cloudflare corta a
  // los cien segundos.
  notas: z.array(Nota).min(1).max(10),
});

export async function POST(request: Request) {
  return responder(request, "EFECTIVO_TOKEN", async () => {
    const analisis = Entrada.safeParse(await request.json());
    if (!analisis.success) {
      const primero = analisis.error.issues[0];
      throw new ErrorPeticion(`${primero.path.join(".") || "entrada"}: ${primero.message}`);
    }
    const { sb, entidad } = await entidadPorRuc(analisis.data.entidad_ruc);
    return importarNotas(sb, entidad.id, analisis.data.notas);
  });
}
