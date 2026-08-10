import { contexto, manejar, ErrorPeticion } from "@/lib/api";
import { clasificarLote } from "@/lib/clasificacion";
import { contabilizarMovimiento } from "@/lib/contabilizacion";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Lista movimientos de extracto con sus filtros habituales. */
export async function GET(request: Request) {
  return manejar(async () => {
    const url = new URL(request.url);
    const { sb, entidadId } = await contexto(url.searchParams.get("entidad_id"));

    let q = sb
      .from("movimientos_extracto")
      .select(
        "id, fecha, descripcion, comercio, naturaleza, monto, confianza_ia, clasificado_por, asiento_id, categoria_id, categorias_gasto(nombre), cuentas_financieras(nombre, tipo)",
      )
      .eq("entidad_id", entidadId)
      .order("fecha", { ascending: false })
      .limit(Number(url.searchParams.get("limite") ?? 300));

    const estado = url.searchParams.get("estado");
    if (estado === "sin_clasificar") q = q.is("categoria_id", null);
    if (estado === "sin_contabilizar") q = q.is("asiento_id", null);
    if (estado === "revisar") q = q.lt("confianza_ia", 0.7);

    const desde = url.searchParams.get("desde");
    const hasta = url.searchParams.get("hasta");
    if (desde) q = q.gte("fecha", desde);
    if (hasta) q = q.lte("fecha", hasta);

    const { data, error } = await q;
    if (error) throw new ErrorPeticion(error.message, 500);
    return data;
  });
}

/**
 * Corrige la categoría de un movimiento. La corrección manual se guarda en el
 * mapa como confirmada, de modo que pisa cualquier sugerencia posterior de la
 * IA para ese mismo comercio.
 */
export async function PATCH(request: Request) {
  return manejar(async () => {
    const { id, categoria_id, aprender = true } = (await request.json()) as {
      id?: string;
      categoria_id?: string;
      aprender?: boolean;
    };

    if (!id || !categoria_id) throw new ErrorPeticion("Faltan id y categoria_id.");
    const { sb, entidadId } = await contexto();

    const { data: mov, error } = await sb
      .from("movimientos_extracto")
      .update({ categoria_id, clasificado_por: "MANUAL", confianza_ia: null })
      .eq("id", id)
      .select("comercio, descripcion")
      .single();

    if (error) throw new ErrorPeticion(error.message, 500);

    if (aprender && mov?.comercio) {
      await sb.from("mapa_clasificacion").upsert(
        {
          entidad_id: entidadId,
          tipo_clave: "COMERCIO",
          clave: mov.comercio,
          nombre_origen: mov.descripcion,
          categoria_id,
          origen: "MANUAL",
          confirmado: true,
        },
        { onConflict: "entidad_id,tipo_clave,clave" },
      );
    }

    return { id, categoria_id };
  });
}

/**
 * Acciones masivas: clasificar lo pendiente o contabilizar lo ya clasificado.
 */
export async function POST(request: Request) {
  return manejar(async () => {
    const { accion, ids } = (await request.json()) as {
      accion?: "clasificar" | "contabilizar";
      ids?: string[];
    };
    const { sb, entidadId } = await contexto();

    if (accion === "clasificar") {
      const { data: pendientes, error } = await sb
        .from("movimientos_extracto")
        .select("id, fecha, descripcion, comercio, monto")
        .eq("entidad_id", entidadId)
        .is("categoria_id", null)
        .limit(500);

      if (error) throw new ErrorPeticion(error.message, 500);
      if (!pendientes?.length) return { clasificados: 0, consultasIA: 0 };

      const { asignaciones, consultasIA } = await clasificarLote(
        sb,
        entidadId,
        pendientes.map((m, i) => ({
          indice: i,
          descripcion: m.descripcion as string,
          comercio: m.comercio as string | null,
          monto: Number(m.monto),
          fecha: m.fecha as string,
        })),
      );

      let clasificados = 0;
      for (const a of asignaciones) {
        if (!a.categoriaId) continue;
        clasificados += 1;
        await sb
          .from("movimientos_extracto")
          .update({
            categoria_id: a.categoriaId,
            comercio: a.comercio,
            clasificado_por: a.origen,
            confianza_ia: a.origen === "IA" ? a.confianza : null,
          })
          .eq("id", pendientes[a.indice].id as string);
      }

      return { clasificados, pendientes: pendientes.length, consultasIA };
    }

    if (accion === "contabilizar") {
      let objetivo = ids ?? [];
      if (objetivo.length === 0) {
        const { data } = await sb
          .from("movimientos_extracto")
          .select("id")
          .eq("entidad_id", entidadId)
          .is("asiento_id", null)
          .not("categoria_id", "is", null)
          .limit(500);
        objetivo = (data ?? []).map((m) => m.id as string);
      }

      const errores: { id: string; error: string }[] = [];
      let contabilizados = 0;

      for (const id of objetivo) {
        try {
          await contabilizarMovimiento(sb, entidadId, id);
          contabilizados += 1;
        } catch (e) {
          errores.push({ id, error: e instanceof Error ? e.message : "Error" });
        }
      }

      return { contabilizados, errores };
    }

    throw new ErrorPeticion("Acción no reconocida. Usa 'clasificar' o 'contabilizar'.");
  });
}
