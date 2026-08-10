import { contexto, manejar, ErrorPeticion } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TIPOS = [
  "ESTADO_TARJETA",
  "ESTADO_BANCO",
  "ESTADO_COOPERATIVA",
  "FACTURA_COMPRA",
  "FACTURA_VENTA",
  "ROL_PAGO",
  "RETENCION",
  "NOTA_CREDITO",
  "OTRO",
];

const MIMES_OK = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "text/plain",
  "text/csv",
  "text/xml",
  "application/xml",
];

const MAX_BYTES = 25 * 1024 * 1024;

/** Sube un documento al almacenamiento privado y lo deja en cola de proceso. */
export async function POST(request: Request) {
  return manejar(async () => {
    const form = await request.formData();
    const archivo = form.get("archivo");
    const tipo = String(form.get("tipo") ?? "");
    const cuentaId = form.get("cuenta_id") ? String(form.get("cuenta_id")) : null;
    const entidad = form.get("entidad_id") ? String(form.get("entidad_id")) : null;

    if (!(archivo instanceof File)) {
      throw new ErrorPeticion("Falta el archivo.");
    }
    if (!TIPOS.includes(tipo)) {
      throw new ErrorPeticion(`Tipo de documento no válido: ${tipo}`);
    }
    if (archivo.size > MAX_BYTES) {
      throw new ErrorPeticion("El archivo supera los 25 MB.");
    }
    if (archivo.type && !MIMES_OK.includes(archivo.type)) {
      throw new ErrorPeticion(`Formato no admitido: ${archivo.type}`);
    }

    const { sb, userId, entidadId } = await contexto(entidad);

    // El primer segmento debe ser el id del usuario: así lo exige la política
    // de almacenamiento.
    const limpio = archivo.name.replace(/[^\w.\-]+/g, "_").slice(-120);
    const ruta = `${userId}/${crypto.randomUUID()}-${limpio}`;

    const { error: errSubida } = await sb.storage
      .from("documentos")
      .upload(ruta, archivo, {
        contentType: archivo.type || "application/octet-stream",
        upsert: false,
      });

    if (errSubida) throw new ErrorPeticion(`No se pudo subir: ${errSubida.message}`, 500);

    const { data, error } = await sb
      .from("documentos")
      .insert({
        entidad_id: entidadId,
        tipo,
        nombre_archivo: archivo.name,
        storage_path: ruta,
        mime_type: archivo.type || null,
        tamano_bytes: archivo.size,
        cuenta_id: cuentaId,
        estado: "PENDIENTE",
        created_by: userId,
      })
      .select("id, nombre_archivo, tipo, estado")
      .single();

    if (error) {
      await sb.storage.from("documentos").remove([ruta]);
      throw new ErrorPeticion(`No se pudo registrar el documento: ${error.message}`, 500);
    }

    return data;
  });
}

/** Lista los documentos cargados, del más reciente al más antiguo. */
export async function GET(request: Request) {
  return manejar(async () => {
    const url = new URL(request.url);
    const { sb, entidadId } = await contexto(url.searchParams.get("entidad_id"));

    const { data, error } = await sb
      .from("documentos")
      .select(
        "id, tipo, nombre_archivo, estado, resumen, error_mensaje, periodo_desde, periodo_hasta, created_at, procesado_at",
      )
      .eq("entidad_id", entidadId)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) throw new ErrorPeticion(error.message, 500);
    return data;
  });
}
