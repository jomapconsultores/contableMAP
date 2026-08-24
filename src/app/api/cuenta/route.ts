import { manejar, ErrorPeticion } from "@/lib/api";
import { requiereUsuario, supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Los datos que el propio usuario mantiene, guardados en sus metadatos. */
interface Perfil {
  email: string;
  nombre: string;
  telefono: string;
  cargo: string;
}

const texto = (v: unknown) => String(v ?? "").trim();

/** Datos de la cuenta de quien está en sesión. */
export async function GET() {
  return manejar(async (): Promise<Perfil> => {
    const user = await requiereUsuario();
    const m = user.user_metadata ?? {};
    return {
      email: user.email ?? "",
      nombre: texto(m.nombre),
      telefono: texto(m.telefono),
      cargo: texto(m.cargo),
    };
  });
}

/**
 * Actualiza los datos personales. El correo no se toca aquí: cambiarlo en
 * GoTrue exige confirmación por email y este servidor no tiene SMTP, así que
 * el cambio quedaría a medias y sin forma de completarlo.
 */
export async function PUT(request: Request) {
  return manejar(async (): Promise<Perfil> => {
    await requiereUsuario();
    const b = (await request.json()) as Record<string, unknown>;

    const nombre = texto(b.nombre);
    const telefono = texto(b.telefono);
    const cargo = texto(b.cargo);

    if (!nombre) throw new ErrorPeticion("El nombre es obligatorio.");
    if (nombre.length > 120) throw new ErrorPeticion("El nombre es demasiado largo.");
    if (telefono && !/^[\d+\s()-]{7,20}$/.test(telefono)) {
      throw new ErrorPeticion("El teléfono no tiene un formato válido.");
    }
    if (cargo.length > 80) throw new ErrorPeticion("El cargo es demasiado largo.");

    const sb = await supabaseServer();
    const { data, error } = await sb.auth.updateUser({
      data: { nombre, telefono, cargo },
    });
    if (error) throw new ErrorPeticion(error.message, 500);

    const m = data.user?.user_metadata ?? {};
    return {
      email: data.user?.email ?? "",
      nombre: texto(m.nombre),
      telefono: texto(m.telefono),
      cargo: texto(m.cargo),
    };
  });
}
