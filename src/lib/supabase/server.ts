import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

const url = () => {
  const v = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!v) throw new Error("Falta NEXT_PUBLIC_SUPABASE_URL");
  return v;
};

const anonKey = () => {
  const v = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!v) throw new Error("Falta NEXT_PUBLIC_SUPABASE_ANON_KEY");
  return v;
};

/**
 * Cliente ligado a la sesión del usuario. Todas las consultas pasan por RLS,
 * así que nunca puede leer datos de otra entidad.
 */
export async function supabaseServer() {
  const store = await cookies();

  return createServerClient(url(), anonKey(), {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) =>
            store.set(name, value, options),
          );
        } catch {
          // Los Server Components no pueden escribir cookies; el middleware
          // ya refresca la sesión, así que se puede ignorar.
        }
      },
    },
  });
}

/**
 * Cliente con service role: salta RLS. Reservado para tareas de backend que
 * no tienen sesión (procesamiento asíncrono de documentos, migraciones).
 * Nunca debe exponerse al navegador.
 */
export function supabaseAdmin() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url(), key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Usuario autenticado o `null`. */
export async function usuarioActual() {
  const sb = await supabaseServer();
  const { data } = await sb.auth.getUser();
  return data.user ?? null;
}

/** Usuario autenticado; lanza si no hay sesión. Para uso en rutas de API. */
export async function requiereUsuario() {
  const user = await usuarioActual();
  if (!user) throw new NoAutorizado();
  return user;
}

export class NoAutorizado extends Error {
  constructor() {
    super("No autorizado");
    this.name = "NoAutorizado";
  }
}
