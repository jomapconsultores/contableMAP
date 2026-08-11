import { createHash } from "node:crypto";
import { aISO } from "@/lib/fechas";
import { contexto, manejar, registrarIA, ErrorPeticion } from "@/lib/api";
import { clasificarLote, normalizarComercio } from "@/lib/clasificacion";
import {
  extraerExtracto,
  extraerFactura,
  extraerRolPago,
  type TipoDocumento,
} from "@/lib/extraccion";
import type { Uso } from "@/lib/ia";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const ES_EXTRACTO = ["ESTADO_TARJETA", "ESTADO_BANCO", "ESTADO_COOPERATIVA"];

/** Huella estable de una línea de extracto, para no duplicar al recargar. */
function huella(
  fecha: string,
  descripcion: string,
  monto: number,
  naturaleza: string,
): string {
  return createHash("sha256")
    .update(`${fecha}|${descripcion.trim().toUpperCase()}|${monto.toFixed(2)}|${naturaleza}`)
    .digest("hex")
    .slice(0, 32);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return manejar(async () => {
    const { id } = await params;
    const { sb, userId, entidadId } = await contexto();

    const { data: doc, error } = await sb
      .from("documentos")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !doc) throw new ErrorPeticion("Documento no encontrado.", 404);
    if (doc.estado === "PROCESANDO") {
      throw new ErrorPeticion("Este documento ya se está procesando.", 409);
    }

    await sb.from("documentos").update({ estado: "PROCESANDO", error_mensaje: null }).eq("id", id);

    try {
      const { data: blob, error: errDesc } = await sb.storage
        .from("documentos")
        .download(doc.storage_path);
      if (errDesc || !blob) {
        throw new ErrorPeticion(`No se pudo leer el archivo: ${errDesc?.message}`, 500);
      }

      const base64 = Buffer.from(await blob.arrayBuffer()).toString("base64");
      const mime = doc.mime_type ?? "application/pdf";

      let resumen = "";
      let uso: Uso;
      let extraccion: unknown;

      if (ES_EXTRACTO.includes(doc.tipo)) {
        const r = await procesarExtracto(sb, entidadId, doc, base64, mime);
        resumen = r.resumen;
        uso = r.uso;
        extraccion = r.extraccion;
      } else if (doc.tipo === "FACTURA_COMPRA" || doc.tipo === "FACTURA_VENTA") {
        const r = await procesarFactura(sb, entidadId, doc, base64, mime);
        resumen = r.resumen;
        uso = r.uso;
        extraccion = r.extraccion;
      } else if (doc.tipo === "ROL_PAGO") {
        const r = await procesarRol(sb, entidadId, doc, base64, mime);
        resumen = r.resumen;
        uso = r.uso;
        extraccion = r.extraccion;
      } else {
        throw new ErrorPeticion(
          `El tipo ${doc.tipo} todavía no tiene extracción automática. Regístralo a mano.`,
        );
      }

      await sb
        .from("documentos")
        .update({
          estado: "EXTRAIDO",
          extraccion: extraccion as never,
          resumen,
          modelo_ia: uso.modelo,
          tokens_entrada: uso.tokensEntrada,
          tokens_salida: uso.tokensSalida,
          procesado_at: new Date().toISOString(),
        })
        .eq("id", id);

      await registrarIA(sb, entidadId, userId, "EXTRACCION_DOC", uso, id);

      return { id, estado: "EXTRAIDO", resumen };
    } catch (e) {
      const mensaje = e instanceof Error ? e.message : "Error desconocido";
      await sb
        .from("documentos")
        .update({ estado: "ERROR", error_mensaje: mensaje })
        .eq("id", id);
      throw e;
    }
  });
}

// ---------------------------------------------------------------------------

type Doc = Record<string, unknown> & { id: string; tipo: string; cuenta_id: string | null };

async function procesarExtracto(
  sb: Awaited<ReturnType<typeof contexto>>["sb"],
  entidadId: string,
  doc: Doc,
  base64: string,
  mime: string,
) {
  if (!doc.cuenta_id) {
    throw new ErrorPeticion(
      "Asigna una cuenta financiera al documento antes de procesarlo: sin ella no se sabe a qué cuenta pertenecen los movimientos.",
    );
  }

  const { datos, uso } = await extraerExtracto(base64, mime, doc.tipo as TipoDocumento);

  if (datos.movimientos.length === 0) {
    throw new ErrorPeticion(
      "No se reconoció ningún movimiento en el documento. Revisa que el archivo sea legible.",
    );
  }

  // La fecha se normaliza a ISO aquí; un movimiento sin fecha reconocible se
  // descarta en vez de romper toda la carga, y se avisa cuántos.
  let sinFecha = 0;
  const filas = datos.movimientos
    .map((m) => {
      const fecha = aISO(m.fecha);
      if (!fecha) {
        sinFecha += 1;
        return null;
      }
      return {
        entidad_id: entidadId,
        documento_id: doc.id,
        cuenta_id: doc.cuenta_id as string,
        fecha,
        descripcion: m.descripcion,
        comercio: m.comercio ? normalizarComercio(m.comercio) : null,
        referencia: m.referencia,
        naturaleza: m.naturaleza,
        monto: m.monto,
        moneda: m.moneda ?? "USD",
        hash_linea: huella(fecha, m.descripcion, m.monto, m.naturaleza),
      };
    })
    .filter((f): f is NonNullable<typeof f> => f !== null);

  if (filas.length === 0) {
    throw new ErrorPeticion(
      "No se pudo interpretar la fecha de ningún movimiento. Revisa que el documento sea legible.",
    );
  }

  // ignoreDuplicates deja pasar sin error las líneas ya cargadas en otra
  // corrida del mismo extracto.
  const { data: insertadas, error } = await sb
    .from("movimientos_extracto")
    .upsert(filas, {
      onConflict: "entidad_id,cuenta_id,hash_linea",
      ignoreDuplicates: true,
    })
    .select("id, fecha, descripcion, comercio, monto");

  if (error) throw new ErrorPeticion(`No se pudieron guardar los movimientos: ${error.message}`, 500);

  const nuevas = insertadas ?? [];

  // Clasificación inmediata de lo recién cargado.
  let clasificados = 0;
  if (nuevas.length > 0) {
    const { asignaciones } = await clasificarLote(
      sb,
      entidadId,
      nuevas.map((m, i) => ({
        indice: i,
        descripcion: m.descripcion as string,
        comercio: m.comercio as string | null,
        monto: Number(m.monto),
        fecha: m.fecha as string,
      })),
    );

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
        .eq("id", nuevas[a.indice].id as string);
    }
  }

  await sb
    .from("documentos")
    .update({
      periodo_desde: aISO(datos.periodo_desde),
      periodo_hasta: aISO(datos.periodo_hasta),
    })
    .eq("id", doc.id);

  const omitidas = datos.movimientos.length - sinFecha - nuevas.length;
  const resumen =
    `${datos.movimientos.length} movimientos leídos · ${nuevas.length} nuevos · ` +
    `${clasificados} clasificados automáticamente` +
    (omitidas > 0 ? ` · ${omitidas} ya existían` : "") +
    (sinFecha > 0 ? ` · ${sinFecha} descartados sin fecha` : "") +
    (datos.observaciones.length ? ` · ${datos.observaciones.length} observaciones` : "");

  return { resumen, uso, extraccion: datos };
}

async function procesarFactura(
  sb: Awaited<ReturnType<typeof contexto>>["sb"],
  entidadId: string,
  doc: Doc,
  base64: string,
  mime: string,
) {
  const esCompra = doc.tipo === "FACTURA_COMPRA";
  const { datos, uso } = await extraerFactura(
    base64,
    mime,
    esCompra ? "FACTURA_COMPRA" : "FACTURA_VENTA",
  );

  const fecha = aISO(datos.fecha);
  if (!fecha) {
    throw new ErrorPeticion(
      "No se pudo interpretar la fecha del comprobante. Regístralo manualmente.",
    );
  }

  const comun = {
    entidad_id: entidadId,
    documento_id: doc.id,
    fecha,
    tipo_comprobante: datos.tipo_comprobante,
    establecimiento: datos.establecimiento,
    punto_emision: datos.punto_emision,
    secuencial: datos.secuencial,
    autorizacion: datos.autorizacion,
    clave_acceso: datos.clave_acceso,
    base_0: datos.base_0,
    base_5: datos.base_5,
    base_8: datos.base_8,
    base_15: datos.base_15,
    no_objeto_iva: datos.no_objeto_iva,
    exento_iva: datos.exento_iva,
    iva_5: datos.iva_5,
    iva_8: datos.iva_8,
    iva_15: datos.iva_15,
    ice: datos.ice,
    descuento: datos.descuento,
    total: datos.total,
    concepto: datos.concepto,
    forma_pago: datos.forma_pago,
  };

  if (esCompra) {
    if (!datos.ruc_emisor || !datos.nombre_emisor) {
      throw new ErrorPeticion(
        "No se pudo leer el RUC o la razón social del proveedor. Complétalo manualmente.",
      );
    }

    const { data, error } = await sb
      .from("compras")
      .insert({
        ...comun,
        propina: datos.propina,
        ruc_proveedor: datos.ruc_emisor,
        nombre_proveedor: datos.nombre_emisor,
      })
      .select("id")
      .single();

    if (error) {
      throw new ErrorPeticion(
        error.code === "23505"
          ? "Esta factura ya estaba registrada."
          : `No se pudo registrar la compra: ${error.message}`,
      );
    }

    // Clasificación por RUC del proveedor.
    const { asignaciones } = await clasificarLote(sb, entidadId, [
      {
        indice: 0,
        descripcion: datos.concepto ?? datos.nombre_emisor,
        comercio: datos.nombre_emisor,
        ruc: datos.ruc_emisor,
        monto: datos.total,
        fecha,
      },
    ]);

    const a = asignaciones[0];
    if (a?.categoriaId) {
      const { data: cat } = await sb
        .from("categorias_gasto")
        .select("rubro_personal, deducible_negocio, credito_iva")
        .eq("id", a.categoriaId)
        .single();

      await sb
        .from("compras")
        .update({
          categoria_id: a.categoriaId,
          clasificado_por: a.origen,
          confianza_ia: a.origen === "IA" ? a.confianza : null,
          rubro_personal: cat?.rubro_personal ?? null,
          deducible_ir: cat?.deducible_negocio ?? true,
          da_credito_iva: cat?.credito_iva ?? true,
        })
        .eq("id", data.id);
    }

    return {
      resumen: `Compra ${datos.secuencial ?? ""} de ${datos.nombre_emisor} por USD ${datos.total.toFixed(2)} · categoría ${a?.categoria ?? "sin asignar"}`,
      uso,
      extraccion: datos,
    };
  }

  const { error } = await sb.from("ventas").insert({
    ...comun,
    tipo_id_cliente: datos.identificacion_receptor ? "RUC" : "CONSUMIDOR_FINAL",
    id_cliente: datos.identificacion_receptor,
    razon_social_cliente: datos.nombre_receptor ?? "CONSUMIDOR FINAL",
  });

  if (error) {
    throw new ErrorPeticion(
      error.code === "23505"
        ? "Esta venta ya estaba registrada."
        : `No se pudo registrar la venta: ${error.message}`,
    );
  }

  return {
    resumen: `Venta ${datos.secuencial ?? ""} a ${datos.nombre_receptor ?? "consumidor final"} por USD ${datos.total.toFixed(2)}`,
    uso,
    extraccion: datos,
  };
}

async function procesarRol(
  sb: Awaited<ReturnType<typeof contexto>>["sb"],
  entidadId: string,
  doc: Doc,
  base64: string,
  mime: string,
) {
  const { datos, uso } = await extraerRolPago(base64, mime);

  const { error } = await sb.from("roles_pago").insert({
    entidad_id: entidadId,
    documento_id: doc.id,
    anio: datos.anio,
    mes: datos.mes,
    ruc_empleador: datos.ruc_empleador,
    nombre_empleador: datos.nombre_empleador,
    sueldo: datos.sueldo,
    horas_extra: datos.horas_extra,
    comisiones: datos.comisiones,
    bonos: datos.bonos,
    fondos_reserva: datos.fondos_reserva,
    decimo_tercero: datos.decimo_tercero,
    decimo_cuarto: datos.decimo_cuarto,
    otros_ingresos: datos.otros_ingresos,
    total_ingresos: datos.total_ingresos,
    aporte_iess: datos.aporte_iess,
    impuesto_renta: datos.impuesto_renta,
    prestamos_iess: datos.prestamos_iess,
    anticipos: datos.anticipos,
    otros_descuentos: datos.otros_descuentos,
    total_descuentos: datos.total_descuentos,
    liquido_recibir: datos.liquido_recibir,
  });

  if (error) {
    throw new ErrorPeticion(
      error.code === "23505"
        ? "Ya existe un rol de este empleador para ese mes."
        : `No se pudo registrar el rol: ${error.message}`,
    );
  }

  return {
    resumen: `Rol ${String(datos.mes).padStart(2, "0")}/${datos.anio} de ${datos.nombre_empleador} · líquido USD ${datos.liquido_recibir.toFixed(2)}`,
    uso,
    extraccion: datos,
  };
}
