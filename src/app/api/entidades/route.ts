import { manejar, ErrorPeticion } from "@/lib/api";
import { requiereUsuario, supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const REGIMENES = ["GENERAL", "RIMPE_EMPRENDEDOR", "RIMPE_NEGOCIO_POPULAR"];

export async function GET() {
  return manejar(async () => {
    await requiereUsuario();
    const sb = await supabaseServer();
    const { data, error } = await sb
      .from("entidades")
      .select("*")
      .order("created_at", { ascending: true });
    if (error) throw new ErrorPeticion(error.message, 500);
    return data;
  });
}

/**
 * Crea la entidad. El trigger de la base de datos le provisiona el plan de
 * cuentas y el catálogo de categorías, así que queda operativa al instante.
 */
export async function POST(request: Request) {
  return manejar(async () => {
    const b = (await request.json()) as Record<string, unknown>;
    const ruc = String(b.ruc ?? "").trim();
    const razon = String(b.razon_social ?? "").trim();
    const regimen = String(b.regimen ?? "GENERAL");

    if (!/^\d{10,13}$/.test(ruc)) {
      throw new ErrorPeticion("El RUC o la cédula debe tener entre 10 y 13 dígitos.");
    }
    if (!razon) throw new ErrorPeticion("La razón social es obligatoria.");
    if (!REGIMENES.includes(regimen)) throw new ErrorPeticion("Régimen no válido.");

    const user = await requiereUsuario();
    const sb = await supabaseServer();

    const { data, error } = await sb
      .from("entidades")
      .insert({
        user_id: user.id,
        ruc,
        razon_social: razon,
        tipo_identificacion: ruc.length === 13 ? "RUC" : "CEDULA",
        regimen,
        obligado_contabilidad: Boolean(b.obligado_contabilidad),
        agente_retencion: Boolean(b.agente_retencion),
        periodicidad_iva: b.periodicidad_iva === "SEMESTRAL" ? "SEMESTRAL" : "MENSUAL",
        email: b.email ? String(b.email) : null,
        telefono: b.telefono ? String(b.telefono) : null,
        direccion: b.direccion ? String(b.direccion) : null,
      })
      .select("id, ruc, razon_social")
      .single();

    if (error) {
      throw new ErrorPeticion(
        error.code === "23505" ? "Ya tienes una entidad con ese RUC." : error.message,
      );
    }
    return data;
  });
}
