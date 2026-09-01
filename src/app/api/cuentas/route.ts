import { contexto, manejar, ErrorPeticion } from "@/lib/api";

export const dynamic = "force-dynamic";

const TIPOS = ["BANCO", "TARJETA_CREDITO", "COOPERATIVA", "CAJA", "INVERSION"];

/** Cuentas financieras: bancos, tarjetas, cooperativas y caja. */
export async function GET() {
  return manejar(async () => {
    const { sb, entidadId } = await contexto();
    const { data, error } = await sb
      .from("cuentas_financieras")
      .select("id, nombre, tipo, institucion, numero, dia_corte, dia_pago")
      .eq("entidad_id", entidadId)
      .eq("activo", true)
      .order("nombre");
    if (error) throw new ErrorPeticion(error.message, 500);
    return data;
  });
}

export async function POST(request: Request) {
  return manejar(async () => {
    const b = (await request.json()) as Record<string, unknown>;
    const nombre = String(b.nombre ?? "").trim();
    const tipo = String(b.tipo ?? "");

    if (!nombre) throw new ErrorPeticion("El nombre es obligatorio.");
    if (!TIPOS.includes(tipo)) throw new ErrorPeticion(`Tipo no válido: ${tipo}`);

    const { sb, entidadId } = await contexto();

    // Agrupadora según el tipo de instrumento. La cuenta contable propia —una
    // por cada cuenta financiera— la crea un trigger de la base al insertar.
    const codigo =
      tipo === "TARJETA_CREDITO"
        ? "2.1.03"
        : tipo === "COOPERATIVA"
          ? "1.1.01.03"
          : tipo === "CAJA"
            ? "1.1.01.01"
            : "1.1.01.02";

    const { data: cuenta } = await sb
      .from("plan_cuentas")
      .select("id")
      .eq("entidad_id", entidadId)
      .eq("codigo", codigo)
      .maybeSingle();

    const { data, error } = await sb
      .from("cuentas_financieras")
      .insert({
        entidad_id: entidadId,
        nombre,
        tipo,
        institucion: b.institucion ? String(b.institucion) : null,
        numero: b.numero ? String(b.numero) : null,
        cuenta_id: cuenta?.id ?? null,
        dia_corte: b.dia_corte ? Number(b.dia_corte) : null,
        dia_pago: b.dia_pago ? Number(b.dia_pago) : null,
      })
      .select("id, nombre, tipo")
      .single();

    if (error) {
      throw new ErrorPeticion(
        error.code === "23505"
          ? "Ya existe una cuenta con ese nombre."
          : error.message,
      );
    }
    return data;
  });
}
