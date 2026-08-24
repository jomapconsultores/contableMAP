import { createClient } from "@supabase/supabase-js";
import { manejar, ErrorPeticion } from "@/lib/api";
import { requiereUsuario, supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Mínimo de la clave nueva. GoTrue exige 6; aquí se sube el listón. */
const MINIMO = 8;

/**
 * Cambia la contraseña del usuario en sesión.
 *
 * Se comprueba la clave actual antes de nada. GoTrue no la pide para
 * `updateUser`, así que sin esta verificación bastaría una sesión abierta en
 * un equipo ajeno para dejar al dueño fuera de su propia cuenta.
 *
 * La comprobación va contra un cliente aislado (`persistSession: false`): un
 * `signInWithPassword` sobre el cliente con cookies reescribiría la sesión en
 * curso.
 */
export async function POST(request: Request) {
  return manejar(async () => {
    const user = await requiereUsuario();
    const b = (await request.json()) as Record<string, unknown>;

    const actual = String(b.actual ?? "");
    const nueva = String(b.nueva ?? "");

    if (!actual) throw new ErrorPeticion("Escribe tu contraseña actual.");
    if (nueva.length < MINIMO) {
      throw new ErrorPeticion(`La contraseña nueva debe tener al menos ${MINIMO} caracteres.`);
    }
    if (nueva === actual) {
      throw new ErrorPeticion("La contraseña nueva tiene que ser distinta de la actual.");
    }
    if (!user.email) {
      throw new ErrorPeticion("Tu cuenta no tiene correo asociado.", 409);
    }

    const aislado = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { error: errorActual } = await aislado.auth.signInWithPassword({
      email: user.email,
      password: actual,
    });
    if (errorActual) {
      throw new ErrorPeticion("La contraseña actual no es correcta.", 403);
    }
    await aislado.auth.signOut();

    const sb = await supabaseServer();
    const { error } = await sb.auth.updateUser({ password: nueva });
    if (error) throw new ErrorPeticion(error.message, 500);

    return { cambiada: true };
  });
}
