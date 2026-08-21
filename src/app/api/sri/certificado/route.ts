import { contexto, manejar, ErrorPeticion } from "@/lib/api";
import { leerP12, cifrar, ErrorCertificado } from "@/lib/sri/certificado";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BYTES = 512 * 1024;

/**
 * Carga del certificado de firma electrónica.
 *
 * Se abre en el momento con la contraseña dada: si no se puede abrir, no se
 * guarda nada. Así el error aparece aquí y no la primera vez que se intente
 * facturar. El archivo va al bucket privado y la contraseña queda cifrada.
 */
export async function POST(request: Request) {
  return manejar(async () => {
    const form = await request.formData();
    const archivo = form.get("archivo");
    const password = String(form.get("password") ?? "");
    const entidad = form.get("entidad_id") ? String(form.get("entidad_id")) : null;

    if (!(archivo instanceof File)) throw new ErrorPeticion("Falta el archivo del certificado.");
    if (!password) throw new ErrorPeticion("Falta la contraseña del certificado.");
    if (archivo.size > MAX_BYTES) throw new ErrorPeticion("El certificado no debería pesar tanto.");
    if (!/\.(p12|pfx)$/i.test(archivo.name)) {
      throw new ErrorPeticion("El certificado debe ser un archivo .p12 o .pfx.");
    }

    const { sb, userId, entidadId } = await contexto(entidad);
    const bytes = Buffer.from(await archivo.arrayBuffer());

    // Se valida antes de guardar: contraseña, vigencia y que traiga clave.
    let datos;
    try {
      datos = leerP12(bytes, password);
    } catch (e) {
      if (e instanceof ErrorCertificado) throw new ErrorPeticion(e.message, 400);
      throw e;
    }

    const { data: entidadFila } = await sb
      .from("entidades")
      .select("ruc, direccion")
      .eq("id", entidadId)
      .single();

    const ruta = `${userId}/${entidadId}/firma.p12`;
    const { error: errorSubida } = await sb.storage
      .from("certificados")
      .upload(ruta, new Blob([new Uint8Array(bytes)], { type: "application/x-pkcs12" }), {
        upsert: true,
        contentType: "application/x-pkcs12",
      });

    if (errorSubida) {
      throw new ErrorPeticion(`No se pudo guardar el certificado: ${errorSubida.message}`, 500);
    }

    const { error } = await sb.from("sri_config").upsert(
      {
        entidad_id: entidadId,
        // Si aún no hay configuración, la dirección de la entidad sirve de
        // punto de partida para la matriz; se puede corregir después.
        dir_matriz: entidadFila?.direccion || "Sin dirección registrada",
        cert_path: ruta,
        cert_password_cifrada: cifrar(password),
        cert_sujeto: datos.sujeto,
        cert_emisor: datos.emisorRfc2253,
        cert_serie: datos.serie,
        cert_desde: datos.desde.toISOString(),
        cert_hasta: datos.hasta.toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "entidad_id", ignoreDuplicates: false },
    );

    if (error) throw new ErrorPeticion(error.message, 500);

    const diasRestantes = Math.floor((datos.hasta.getTime() - Date.now()) / 86400000);

    return {
      sujeto: datos.sujeto,
      emisor: datos.emisorRfc2253,
      serie: datos.serie,
      desde: datos.desde.toISOString(),
      hasta: datos.hasta.toISOString(),
      dias_restantes: diasRestantes,
      aviso:
        diasRestantes < 30
          ? `El certificado caduca en ${diasRestantes} días. Conviene renovarlo antes de que caduque.`
          : null,
    };
  });
}

/** Retira el certificado. Las facturas ya emitidas no se tocan. */
export async function DELETE(request: Request) {
  return manejar(async () => {
    const url = new URL(request.url);
    const { sb, entidadId } = await contexto(url.searchParams.get("entidad_id"));

    const { data: config } = await sb
      .from("sri_config")
      .select("cert_path")
      .eq("entidad_id", entidadId)
      .maybeSingle();

    if (config?.cert_path) {
      await sb.storage.from("certificados").remove([config.cert_path as string]);
    }

    const { error } = await sb
      .from("sri_config")
      .update({
        cert_path: null,
        cert_password_cifrada: null,
        cert_sujeto: null,
        cert_emisor: null,
        cert_serie: null,
        cert_desde: null,
        cert_hasta: null,
        updated_at: new Date().toISOString(),
      })
      .eq("entidad_id", entidadId);

    if (error) throw new ErrorPeticion(error.message, 500);
    return { retirado: true };
  });
}
