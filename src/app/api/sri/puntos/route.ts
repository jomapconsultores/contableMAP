import { contexto, manejar, ErrorPeticion } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * Puntos de emisión (establecimiento + punto), con su secuencial.
 *
 * El secuencial solo se puede fijar hacia arriba y con la factura recién
 * creada: si ya se emitió con un número, repetirlo es una infracción. Por eso
 * el ajuste manual admite adelantar la numeración —para continuar la serie que
 * el contribuyente ya usaba— pero nunca retrocederla.
 */

const TRES_DIGITOS = /^[0-9]{3}$/;

export async function POST(request: Request) {
  return manejar(async () => {
    const b = (await request.json()) as Record<string, unknown>;
    const { sb, entidadId } = await contexto(b.entidad_id ? String(b.entidad_id) : null);

    const establecimiento = String(b.establecimiento ?? "").padStart(3, "0");
    const punto = String(b.punto_emision ?? "").padStart(3, "0");

    if (!TRES_DIGITOS.test(establecimiento) || !TRES_DIGITOS.test(punto)) {
      throw new ErrorPeticion("El establecimiento y el punto de emisión son tres dígitos: 001-001.");
    }

    const desde = Number(b.sec_factura ?? 1);
    if (!Number.isInteger(desde) || desde < 1 || desde > 999999999) {
      throw new ErrorPeticion("El próximo secuencial tiene que estar entre 1 y 999999999.");
    }

    const { data, error } = await sb
      .from("puntos_emision")
      .insert({
        entidad_id: entidadId,
        establecimiento,
        punto_emision: punto,
        nombre: (b.nombre as string) || null,
        direccion: (b.direccion as string) || null,
        sec_factura: desde,
      })
      .select("id, establecimiento, punto_emision, nombre, direccion, sec_factura, activo")
      .single();

    if (error) {
      if (error.code === "23505") {
        throw new ErrorPeticion(`El punto de emisión ${establecimiento}-${punto} ya existe.`, 409);
      }
      throw new ErrorPeticion(error.message, 500);
    }
    return data;
  });
}

export async function PATCH(request: Request) {
  return manejar(async () => {
    const b = (await request.json()) as Record<string, unknown>;
    const id = String(b.id ?? "");
    if (!id) throw new ErrorPeticion("Falta el punto de emisión.");

    const { sb } = await contexto();

    const { data: actual } = await sb
      .from("puntos_emision")
      .select("sec_factura")
      .eq("id", id)
      .maybeSingle();

    if (!actual) throw new ErrorPeticion("El punto de emisión no existe.", 404);

    const cambios: Record<string, unknown> = {};
    if (b.nombre !== undefined) cambios.nombre = (b.nombre as string) || null;
    if (b.direccion !== undefined) cambios.direccion = (b.direccion as string) || null;
    if (b.activo !== undefined) cambios.activo = Boolean(b.activo);

    if (b.sec_factura !== undefined) {
      const nuevo = Number(b.sec_factura);
      if (!Number.isInteger(nuevo) || nuevo < 1 || nuevo > 999999999) {
        throw new ErrorPeticion("El secuencial tiene que estar entre 1 y 999999999.");
      }
      if (nuevo < Number(actual.sec_factura)) {
        throw new ErrorPeticion(
          `El secuencial solo puede adelantarse. El próximo número ya es el ${actual.sec_factura}: retroceder repetiría facturas ya emitidas.`,
          409,
        );
      }
      cambios.sec_factura = nuevo;
    }

    if (Object.keys(cambios).length === 0) throw new ErrorPeticion("No se indicó ningún cambio.");

    const { data, error } = await sb
      .from("puntos_emision")
      .update(cambios)
      .eq("id", id)
      .select("id, establecimiento, punto_emision, nombre, direccion, sec_factura, activo")
      .single();

    if (error) throw new ErrorPeticion(error.message, 500);
    return data;
  });
}
