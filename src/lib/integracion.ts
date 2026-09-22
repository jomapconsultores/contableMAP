import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { ErrorPeticion } from "@/lib/api";

/**
 * Entradas para otros sistemas, sin sesión de navegador. Cada integración se
 * protege con su propio token compartido en `Authorization: Bearer …`, de modo
 * que revocar uno no corta a los demás. Como no hay usuario, se trabaja con el
 * cliente de service role y la entidad se fija por su RUC: nunca "la primera
 * que haya".
 */

/** null = pasa; si no, la respuesta con la que se corta. */
export function rechazo(request: Request, variable: string) {
  const esperado = process.env[variable] || "";
  if (!esperado) {
    return NextResponse.json(
      { ok: false, error: `La integración no está habilitada: falta ${variable}.` },
      { status: 503 },
    );
  }
  const recibido = Buffer.from((request.headers.get("authorization") || "").replace(/^Bearer\s+/i, ""));
  const clave = Buffer.from(esperado);
  if (recibido.length === clave.length && timingSafeEqual(recibido, clave)) return null;
  return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
}

export async function entidadPorRuc(ruc?: string | null) {
  const sb = supabaseAdmin();
  const elegido = ruc || process.env.INTEGRACION_ENTIDAD_RUC || "";
  if (!elegido) {
    throw new ErrorPeticion("Falta el RUC de la entidad emisora (entidad_ruc o INTEGRACION_ENTIDAD_RUC).", 400);
  }
  const { data } = await sb
    .from("entidades")
    .select("id, user_id, ruc")
    .eq("ruc", elegido)
    .eq("activo", true)
    .limit(1)
    .maybeSingle();
  if (!data) throw new ErrorPeticion(`No hay una entidad activa con RUC ${elegido}.`, 404);
  return { sb, entidad: data };
}

/** Ejecuta el handler tras comprobar el token y traduce los errores a HTTP. */
export function responder<T>(request: Request, variable: string, fn: () => Promise<T>) {
  const corte = rechazo(request, variable);
  if (corte) return Promise.resolve(corte);
  return fn().then(
    (datos) => NextResponse.json({ ok: true, datos }),
    (e: unknown) => {
      if (e instanceof ErrorPeticion) {
        return NextResponse.json({ ok: false, error: e.message }, { status: e.estado });
      }
      console.error("[integracion]", e);
      const mensaje = e instanceof Error ? e.message : "Error inesperado";
      return NextResponse.json({ ok: false, error: mensaje }, { status: 500 });
    },
  );
}
