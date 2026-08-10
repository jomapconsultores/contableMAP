import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NoAutorizado, supabaseServer, requiereUsuario } from "./supabase/server";
import { ErrorIA } from "./ia";

/** Contexto resuelto una sola vez por petición. */
export interface Contexto {
  sb: SupabaseClient;
  userId: string;
  entidadId: string;
}

export class ErrorPeticion extends Error {
  constructor(
    mensaje: string,
    public readonly estado = 400,
  ) {
    super(mensaje);
    this.name = "ErrorPeticion";
  }
}

/**
 * Resuelve sesión y entidad activa. Si no se indica entidad se usa la primera
 * del usuario, que es el caso normal de una contabilidad personal.
 */
export async function contexto(entidadId?: string | null): Promise<Contexto> {
  const user = await requiereUsuario();
  const sb = await supabaseServer();

  if (entidadId) {
    const { data } = await sb
      .from("entidades")
      .select("id")
      .eq("id", entidadId)
      .maybeSingle();
    if (!data) throw new ErrorPeticion("La entidad no existe o no es tuya.", 404);
    return { sb, userId: user.id, entidadId: data.id };
  }

  const { data } = await sb
    .from("entidades")
    .select("id")
    .eq("activo", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!data) {
    throw new ErrorPeticion(
      "Todavía no hay ninguna entidad configurada. Crea una en Ajustes.",
      409,
    );
  }
  return { sb, userId: user.id, entidadId: data.id };
}

/** Envuelve un handler y traduce los errores conocidos a respuestas HTTP. */
export function manejar<T>(fn: () => Promise<T>) {
  return fn().then(
    (datos) => NextResponse.json({ ok: true, datos }),
    (e: unknown) => {
      if (e instanceof NoAutorizado) {
        return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
      }
      if (e instanceof ErrorPeticion) {
        return NextResponse.json({ ok: false, error: e.message }, { status: e.estado });
      }
      if (e instanceof ErrorIA) {
        return NextResponse.json(
          { ok: false, error: e.message, tipo: "IA" },
          { status: 502 },
        );
      }
      const mensaje = e instanceof Error ? e.message : "Error inesperado";
      console.error("[api]", e);
      return NextResponse.json({ ok: false, error: mensaje }, { status: 500 });
    },
  );
}

/** Registra la llamada al modelo para poder auditar consumo y fallos. */
export async function registrarIA(
  sb: SupabaseClient,
  entidadId: string | null,
  userId: string,
  tipo: string,
  uso: { tokensEntrada: number; tokensSalida: number; duracionMs: number; modelo: string },
  referenciaId?: string | null,
) {
  await sb.from("ia_ejecuciones").insert({
    entidad_id: entidadId,
    tipo,
    modelo: uso.modelo,
    referencia_id: referenciaId ?? null,
    tokens_entrada: uso.tokensEntrada,
    tokens_salida: uso.tokensSalida,
    duracion_ms: uso.duracionMs,
    created_by: userId,
    exito: true,
  });
}
