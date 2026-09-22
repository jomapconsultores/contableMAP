import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

/**
 * Cierra la sesión y vuelve a la pantalla de ingreso. Es un POST desde un
 * formulario, no un enlace: un GET lo podría disparar cualquier precarga del
 * navegador y sacar al usuario sin que lo pidiera.
 */
export async function POST(request: Request) {
  const sb = await supabaseServer();
  await sb.auth.signOut();
  // Detrás del proxy, request.url puede traer la dirección interna del
  // contenedor: el destino se arma con el host que vio el navegador.
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const protocolo = request.headers.get("x-forwarded-proto") ?? "https";
  const destino = host ? `${protocolo}://${host}/login` : new URL("/login", request.url);
  return NextResponse.redirect(destino, { status: 303 });
}
