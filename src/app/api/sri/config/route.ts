import { contexto, manejar, ErrorPeticion } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * Configuración de la facturación electrónica: ambiente, datos que el SRI
 * exige en la cabecera del comprobante y puntos de emisión.
 *
 * Nunca devuelve la contraseña del certificado, ni cifrada: solo si hay uno
 * cargado, a nombre de quién y hasta cuándo sirve.
 */

const CAMPOS =
  "ambiente, tipo_emision, dir_matriz, num_resolucion_especial, agente_retencion_resolucion, email_emisor, telefono_emisor, cert_path, cert_sujeto, cert_emisor, cert_serie, cert_desde, cert_hasta, updated_at";

export async function GET(request: Request) {
  return manejar(async () => {
    const url = new URL(request.url);
    const { sb, entidadId } = await contexto(url.searchParams.get("entidad_id"));

    const { data: config } = await sb
      .from("sri_config")
      .select(CAMPOS)
      .eq("entidad_id", entidadId)
      .maybeSingle();

    const { data: puntos } = await sb
      .from("puntos_emision")
      .select("id, establecimiento, punto_emision, nombre, direccion, sec_factura, activo")
      .eq("entidad_id", entidadId)
      .order("establecimiento", { ascending: true })
      .order("punto_emision", { ascending: true });

    const certificado = config?.cert_path
      ? {
          sujeto: config.cert_sujeto,
          emisor: config.cert_emisor,
          serie: config.cert_serie,
          desde: config.cert_desde,
          hasta: config.cert_hasta,
          caducado: config.cert_hasta ? new Date(config.cert_hasta as string) < new Date() : false,
        }
      : null;

    return {
      configurado: Boolean(config),
      ambiente: config?.ambiente ?? 1,
      dir_matriz: config?.dir_matriz ?? null,
      num_resolucion_especial: config?.num_resolucion_especial ?? null,
      agente_retencion_resolucion: config?.agente_retencion_resolucion ?? null,
      email_emisor: config?.email_emisor ?? null,
      telefono_emisor: config?.telefono_emisor ?? null,
      certificado,
      puntos_emision: puntos ?? [],
    };
  });
}

/** Crea o actualiza la configuración. */
export async function PUT(request: Request) {
  return manejar(async () => {
    const b = (await request.json()) as Record<string, unknown>;
    const { sb, entidadId } = await contexto(b.entidad_id ? String(b.entidad_id) : null);

    const dirMatriz = String(b.dir_matriz ?? "").trim();
    if (!dirMatriz) {
      throw new ErrorPeticion("La dirección de la matriz es obligatoria en el comprobante.");
    }

    const ambiente = Number(b.ambiente ?? 1);
    if (ambiente !== 1 && ambiente !== 2) {
      throw new ErrorPeticion("El ambiente debe ser 1 (pruebas) o 2 (producción).");
    }

    const { error } = await sb.from("sri_config").upsert(
      {
        entidad_id: entidadId,
        ambiente,
        dir_matriz: dirMatriz,
        num_resolucion_especial: (b.num_resolucion_especial as string) || null,
        agente_retencion_resolucion: (b.agente_retencion_resolucion as string) || null,
        email_emisor: (b.email_emisor as string) || null,
        telefono_emisor: (b.telefono_emisor as string) || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "entidad_id" },
    );

    if (error) throw new ErrorPeticion(error.message, 500);
    return { ambiente, dir_matriz: dirMatriz };
  });
}
