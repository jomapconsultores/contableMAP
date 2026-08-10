import { contexto, manejar, ErrorPeticion } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * Punto único de lectura de los informes. Todo el cálculo vive en funciones
 * de PostgreSQL: la aplicación no duplica ninguna regla contable ni fiscal.
 */
export async function GET(request: Request) {
  return manejar(async () => {
    const url = new URL(request.url);
    const p = url.searchParams;
    const tipo = p.get("tipo") ?? "dashboard";
    const { sb, entidadId } = await contexto(p.get("entidad_id"));

    const hoy = new Date();
    const anio = Number(p.get("anio") ?? hoy.getUTCFullYear());
    const mes = Number(p.get("mes") ?? hoy.getUTCMonth() + 1);

    if (anio < 2000 || anio > 2100) throw new ErrorPeticion("Año fuera de rango.");
    if (mes < 1 || mes > 12) throw new ErrorPeticion("Mes fuera de rango.");

    const desde = p.get("desde") ?? `${anio}-01-01`;
    const hasta =
      p.get("hasta") ??
      new Date(Date.UTC(anio, mes, 0)).toISOString().slice(0, 10);

    const llamada = async (fn: string, args: Record<string, unknown>) => {
      const { data, error } = await sb.rpc(fn, args);
      if (error) throw new ErrorPeticion(`${fn}: ${error.message}`, 500);
      return data;
    };

    switch (tipo) {
      case "dashboard":
        return llamada("fn_dashboard", { p_entidad: entidadId, p_anio: anio, p_mes: mes });

      case "resultados":
        return llamada("fn_estado_resultados", {
          p_entidad: entidadId,
          p_desde: desde,
          p_hasta: hasta,
        });

      case "balance":
        return llamada("fn_balance_general", { p_entidad: entidadId, p_hasta: hasta });

      case "sumas_saldos":
        return llamada("fn_balance_saldos", {
          p_entidad: entidadId,
          p_desde: desde,
          p_hasta: hasta,
        });

      case "iva":
        return llamada("fn_calcular_iva", { p_entidad: entidadId, p_anio: anio, p_mes: mes });

      case "renta":
        return llamada("fn_calcular_renta", { p_entidad: entidadId, p_anio: anio });

      case "gastos_personales":
        return llamada("fn_gastos_personales", { p_entidad: entidadId, p_anio: anio });

      case "cartera": {
        const { data, error } = await sb
          .from("v_cartera_antiguedad")
          .select("*")
          .eq("entidad_id", entidadId)
          .not("estado", "in", "(CANCELADO,ANULADO)")
          .order("fecha_vencimiento", { ascending: true });
        if (error) throw new ErrorPeticion(error.message, 500);
        return data;
      }

      case "mayor": {
        const { data, error } = await sb
          .from("v_libro_mayor")
          .select("*")
          .eq("entidad_id", entidadId)
          .gte("fecha", desde)
          .lte("fecha", hasta)
          .order("fecha", { ascending: true })
          .limit(2000);
        if (error) throw new ErrorPeticion(error.message, 500);
        return data;
      }

      default:
        throw new ErrorPeticion(`Informe desconocido: ${tipo}`);
    }
  });
}
