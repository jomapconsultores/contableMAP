import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Genera los asientos de partida doble a partir de los documentos operativos.
 * Cada función deja el asiento en estado CONTABILIZADO; el trigger de la base
 * de datos rechaza cualquier asiento descuadrado, así que un error aquí falla
 * en voz alta en lugar de corromper el mayor.
 */

export const CUENTAS = {
  CAJA: "1.1.01.01",
  BANCOS: "1.1.01.02",
  COOPERATIVAS: "1.1.01.03",
  // Bolsa del sueldo entre el rol y el extracto. Va en el pasivo: el dinero ya
  // entró y el ingreso todavía no se ha reconocido, así que es una obligación
  // pendiente, no un activo con saldo negativo.
  SUELDO_PENDIENTE: "2.1.07",
  CLIENTES: "1.1.02.01",
  DOC_COBRAR: "1.1.02.02",
  IVA_COMPRAS: "1.1.03.01",
  RET_RENTA_RECIBIDA: "1.1.03.03",
  RET_IVA_RECIBIDA: "1.1.03.04",
  PROVEEDORES: "2.1.01",
  DOC_PAGAR: "2.1.02",
  TARJETAS: "2.1.03",
  IVA_VENTAS: "2.1.04.01",
  RET_IVA_POR_PAGAR: "2.1.04.03",
  RET_RENTA_POR_PAGAR: "2.1.04.04",
  ISD_POR_PAGAR: "2.1.04.06",
  IESS_POR_PAGAR: "2.1.05",
  APORTES_IESS: "6.1.02",
  INGRESO_SERVICIOS: "4.1.02",
  INGRESO_DEPENDENCIA: "4.2",
  OTROS_INGRESOS: "4.3",
  GASTO_SIN_CLASIFICAR: "6.1.99",
  GASTO_FINANCIERO: "6.2.02",
} as const;

export interface Linea {
  cuentaCodigo: string;
  detalle?: string;
  terceroId?: string | null;
  debe?: number;
  haber?: number;
}

class ErrorContable extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ErrorContable";
  }
}

/** Redondea a centavos evitando el arrastre binario de los flotantes. */
const c = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * PostgREST devuelve las relaciones anidadas como objeto o como arreglo según
 * cómo infiera la cardinalidad. Esto normaliza ambos casos.
 */
function unaFila<T>(v: unknown): T | null {
  if (v == null) return null;
  return (Array.isArray(v) ? (v[0] ?? null) : v) as T | null;
}

async function mapaCuentas(sb: SupabaseClient, entidadId: string) {
  const { data, error } = await sb
    .from("plan_cuentas")
    .select("id, codigo")
    .eq("entidad_id", entidadId);
  if (error) throw new ErrorContable(`No se pudo leer el plan de cuentas: ${error.message}`);
  return new Map((data ?? []).map((r) => [r.codigo as string, r.id as string]));
}

/**
 * Crea el asiento con sus líneas y lo contabiliza. Si algo falla después de
 * insertar la cabecera, se elimina para no dejar asientos huérfanos.
 */
export async function crearAsiento(
  sb: SupabaseClient,
  entidadId: string,
  cabecera: {
    fecha: string;
    glosa: string;
    tipo?: string;
    origen: string;
    origenId?: string | null;
    confianzaIA?: number | null;
  },
  lineas: Linea[],
): Promise<string> {
  const totalDebe = c(lineas.reduce((s, l) => s + (l.debe ?? 0), 0));
  const totalHaber = c(lineas.reduce((s, l) => s + (l.haber ?? 0), 0));

  if (lineas.length < 2) {
    throw new ErrorContable("Un asiento necesita al menos dos líneas.");
  }
  if (totalDebe !== totalHaber) {
    throw new ErrorContable(
      `Asiento descuadrado: debe ${totalDebe.toFixed(2)} ≠ haber ${totalHaber.toFixed(2)}.`,
    );
  }
  if (totalDebe === 0) {
    throw new ErrorContable("El asiento no mueve ningún valor.");
  }

  const cuentas = await mapaCuentas(sb, entidadId);
  for (const l of lineas) {
    if (!cuentas.has(l.cuentaCodigo)) {
      throw new ErrorContable(`La cuenta ${l.cuentaCodigo} no existe en el plan de cuentas.`);
    }
  }

  const { data: asiento, error: errAsiento } = await sb
    .from("asientos")
    .insert({
      entidad_id: entidadId,
      fecha: cabecera.fecha,
      glosa: cabecera.glosa,
      tipo: cabecera.tipo ?? "DIARIO",
      origen: cabecera.origen,
      origen_id: cabecera.origenId ?? null,
      confianza_ia: cabecera.confianzaIA ?? null,
      estado: "BORRADOR",
    })
    .select("id")
    .single();

  if (errAsiento || !asiento) {
    throw new ErrorContable(`No se pudo crear el asiento: ${errAsiento?.message}`);
  }

  try {
    const { error: errLineas } = await sb.from("asiento_lineas").insert(
      lineas.map((l, i) => ({
        asiento_id: asiento.id,
        orden: i + 1,
        cuenta_id: cuentas.get(l.cuentaCodigo)!,
        tercero_id: l.terceroId ?? null,
        detalle: l.detalle ?? null,
        debe: c(l.debe ?? 0),
        haber: c(l.haber ?? 0),
      })),
    );
    if (errLineas) throw new ErrorContable(`No se pudieron crear las líneas: ${errLineas.message}`);

    // El trigger valida cuadre y período abierto en esta transición.
    const { error: errEstado } = await sb
      .from("asientos")
      .update({ estado: "CONTABILIZADO" })
      .eq("id", asiento.id);
    if (errEstado) throw new ErrorContable(errEstado.message);

    return asiento.id as string;
  } catch (e) {
    await sb.from("asientos").delete().eq("id", asiento.id);
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Cuenta contable que representa a una cuenta financiera
// ---------------------------------------------------------------------------
async function cuentaDeFinanciera(
  sb: SupabaseClient,
  cuentaFinancieraId: string,
): Promise<{ codigo: string; tipo: string; nombre: string }> {
  const { data, error } = await sb
    .from("cuentas_financieras")
    .select("nombre, tipo, plan_cuentas(codigo)")
    .eq("id", cuentaFinancieraId)
    .single();

  if (error || !data) {
    throw new ErrorContable("No se encontró la cuenta financiera indicada.");
  }

  // Cada cuenta financiera tiene la suya: se la da un trigger al crearla, así
  // que aquí no hay respaldo que valga. Sin ella el asiento iría a una cuenta
  // de agrupación —que la base rechaza— o, peor, mezclaría el saldo de once
  // libretas en un solo renglón.
  const vinculada = unaFila<{ codigo: string }>(data.plan_cuentas);
  if (!vinculada?.codigo) {
    throw new ErrorContable(
      `La cuenta «${data.nombre}» no tiene cuenta contable propia; asígnesela antes de contabilizar.`,
    );
  }

  return {
    codigo: vinculada.codigo,
    tipo: data.tipo as string,
    nombre: data.nombre as string,
  };
}

// ---------------------------------------------------------------------------
// Compra
// ---------------------------------------------------------------------------
export async function contabilizarCompra(
  sb: SupabaseClient,
  entidadId: string,
  compraId: string,
): Promise<string> {
  const { data: compra, error } = await sb
    .from("compras")
    .select("*, categorias_gasto(nombre, plan_cuentas(codigo))")
    .eq("id", compraId)
    .single();

  if (error || !compra) throw new ErrorContable("No se encontró la compra.");
  if (compra.asiento_id) throw new ErrorContable("La compra ya está contabilizada.");

  const cat = unaFila<{ nombre: string; plan_cuentas?: unknown }>(compra.categorias_gasto);
  const cuentaGasto =
    unaFila<{ codigo: string }>(cat?.plan_cuentas)?.codigo ?? CUENTAS.GASTO_SIN_CLASIFICAR;

  const base = c(
    Number(compra.base_0) + Number(compra.base_5) + Number(compra.base_8) +
      Number(compra.base_15) + Number(compra.no_objeto_iva) + Number(compra.exento_iva),
  );
  const iva = c(Number(compra.iva_5) + Number(compra.iva_8) + Number(compra.iva_15));
  const ice = c(Number(compra.ice));
  const propina = c(Number(compra.propina));
  const total = c(Number(compra.total));

  const lineas: Linea[] = [];

  // El IVA sin derecho a crédito no es un activo: engrosa el gasto.
  const gasto = compra.da_credito_iva ? c(base + ice + propina) : c(base + ice + propina + iva);
  lineas.push({
    cuentaCodigo: cuentaGasto,
    detalle: compra.concepto ?? cat?.nombre ?? "Compra",
    terceroId: compra.tercero_id,
    debe: gasto,
  });

  if (compra.da_credito_iva && iva > 0) {
    lineas.push({
      cuentaCodigo: CUENTAS.IVA_COMPRAS,
      detalle: "IVA en compras",
      debe: iva,
    });
  }

  // Contrapartida: crédito del proveedor o salida efectiva de dinero.
  if (compra.a_credito || !compra.cuenta_financiera_id) {
    lineas.push({
      cuentaCodigo: CUENTAS.PROVEEDORES,
      detalle: `${compra.nombre_proveedor} · ${compra.numero}`,
      terceroId: compra.tercero_id,
      haber: total,
    });
  } else {
    const fin = await cuentaDeFinanciera(sb, compra.cuenta_financiera_id);
    lineas.push({
      cuentaCodigo: fin.codigo,
      detalle: `Pago ${fin.nombre}`,
      haber: total,
    });
  }

  const asientoId = await crearAsiento(
    sb,
    entidadId,
    {
      fecha: compra.fecha,
      glosa: `Compra ${compra.numero} · ${compra.nombre_proveedor}`,
      tipo: "EGRESO",
      origen: "COMPRA",
      origenId: compraId,
      confianzaIA: compra.confianza_ia,
    },
    lineas,
  );

  await sb
    .from("compras")
    .update({ asiento_id: asientoId, estado: "CONTABILIZADA" })
    .eq("id", compraId);

  // Una compra a crédito genera automáticamente la cuenta por pagar.
  if (compra.a_credito) {
    await sb.from("cartera").insert({
      entidad_id: entidadId,
      clase: "CXP",
      tercero_id: compra.tercero_id,
      nombre_tercero: compra.nombre_proveedor,
      identificacion: compra.ruc_proveedor,
      descripcion: `Compra ${compra.numero}`,
      referencia: compra.numero,
      fecha_emision: compra.fecha,
      fecha_vencimiento: compra.fecha_vencimiento ?? compra.fecha,
      monto_original: total,
      compra_id: compraId,
      asiento_id: asientoId,
    });
  }

  // El IVA soportado alimenta el mayor de crédito tributario.
  if (compra.da_credito_iva && iva > 0) {
    const fecha = new Date(compra.fecha);
    await sb.from("credito_tributario").insert({
      entidad_id: entidadId,
      impuesto: "IVA",
      anio: fecha.getUTCFullYear(),
      mes: fecha.getUTCMonth() + 1,
      fecha: compra.fecha,
      tipo: "ADQUISICIONES",
      concepto: `IVA en compra ${compra.numero}`,
      monto: iva,
      referencia_id: compraId,
    });
  }

  return asientoId;
}

// ---------------------------------------------------------------------------
// Venta
// ---------------------------------------------------------------------------
export async function contabilizarVenta(
  sb: SupabaseClient,
  entidadId: string,
  ventaId: string,
): Promise<string> {
  const { data: venta, error } = await sb
    .from("ventas")
    .select("*, plan_cuentas!ventas_cuenta_ingreso_id_fkey(codigo)")
    .eq("id", ventaId)
    .single();

  if (error || !venta) throw new ErrorContable("No se encontró la venta.");
  if (venta.asiento_id) throw new ErrorContable("La venta ya está contabilizada.");

  const cuentaIngreso =
    unaFila<{ codigo: string }>(venta.plan_cuentas)?.codigo ?? CUENTAS.INGRESO_SERVICIOS;

  const base = c(
    Number(venta.base_0) + Number(venta.base_5) + Number(venta.base_8) +
      Number(venta.base_15) + Number(venta.no_objeto_iva) + Number(venta.exento_iva),
  );
  const iva = c(Number(venta.iva_5) + Number(venta.iva_8) + Number(venta.iva_15));
  const total = c(Number(venta.total));

  const lineas: Linea[] = [];

  if (venta.a_credito || !venta.cuenta_financiera_id) {
    lineas.push({
      cuentaCodigo: CUENTAS.CLIENTES,
      detalle: `${venta.razon_social_cliente} · ${venta.numero}`,
      terceroId: venta.tercero_id,
      debe: total,
    });
  } else {
    const fin = await cuentaDeFinanciera(sb, venta.cuenta_financiera_id);
    lineas.push({ cuentaCodigo: fin.codigo, detalle: `Cobro ${fin.nombre}`, debe: total });
  }

  lineas.push({
    cuentaCodigo: cuentaIngreso,
    detalle: venta.concepto ?? "Venta",
    terceroId: venta.tercero_id,
    haber: base,
  });

  if (iva > 0) {
    lineas.push({ cuentaCodigo: CUENTAS.IVA_VENTAS, detalle: "IVA en ventas", haber: iva });
  }

  const asientoId = await crearAsiento(
    sb,
    entidadId,
    {
      fecha: venta.fecha,
      glosa: `Venta ${venta.numero} · ${venta.razon_social_cliente}`,
      tipo: "INGRESO",
      origen: "VENTA",
      origenId: ventaId,
    },
    lineas,
  );

  await sb
    .from("ventas")
    .update({ asiento_id: asientoId, estado: "CONTABILIZADA" })
    .eq("id", ventaId);

  if (venta.a_credito) {
    await sb.from("cartera").insert({
      entidad_id: entidadId,
      clase: "CXC",
      tercero_id: venta.tercero_id,
      nombre_tercero: venta.razon_social_cliente,
      identificacion: venta.id_cliente,
      descripcion: `Venta ${venta.numero}`,
      referencia: venta.numero,
      fecha_emision: venta.fecha,
      fecha_vencimiento: venta.fecha_vencimiento ?? venta.fecha,
      monto_original: total,
      venta_id: ventaId,
      asiento_id: asientoId,
    });
  }

  return asientoId;
}

// ---------------------------------------------------------------------------
// Movimiento de extracto ya clasificado
// ---------------------------------------------------------------------------
export async function contabilizarMovimiento(
  sb: SupabaseClient,
  entidadId: string,
  movimientoId: string,
): Promise<string> {
  const { data: mov, error } = await sb
    .from("movimientos_extracto")
    .select("*, categorias_gasto(nombre, plan_cuentas(codigo))")
    .eq("id", movimientoId)
    .single();

  if (error || !mov) throw new ErrorContable("No se encontró el movimiento.");
  if (mov.asiento_id) throw new ErrorContable("El movimiento ya está contabilizado.");
  if (!mov.categoria_id) {
    throw new ErrorContable("Clasifica el movimiento antes de contabilizarlo.");
  }

  const cat = unaFila<{ nombre: string; plan_cuentas?: unknown }>(mov.categorias_gasto);
  const cuentaCategoria =
    unaFila<{ codigo: string }>(cat?.plan_cuentas)?.codigo ?? CUENTAS.GASTO_SIN_CLASIFICAR;
  const fin = await cuentaDeFinanciera(sb, mov.cuenta_id);
  const monto = c(Number(mov.monto));

  // DEBITO en la cuenta financiera = sale dinero o crece la deuda de la
  // tarjeta; CREDITO = entra dinero o se abona la tarjeta.
  const lineas: Linea[] =
    mov.naturaleza === "DEBITO"
      ? [
          {
            cuentaCodigo: cuentaCategoria,
            detalle: mov.descripcion,
            terceroId: mov.tercero_id,
            debe: monto,
          },
          { cuentaCodigo: fin.codigo, detalle: fin.nombre, haber: monto },
        ]
      : [
          { cuentaCodigo: fin.codigo, detalle: fin.nombre, debe: monto },
          {
            cuentaCodigo: cuentaCategoria,
            detalle: mov.descripcion,
            terceroId: mov.tercero_id,
            haber: monto,
          },
        ];

  const asientoId = await crearAsiento(
    sb,
    entidadId,
    {
      fecha: mov.fecha,
      glosa: `${fin.nombre} · ${mov.descripcion}`.slice(0, 200),
      tipo: mov.naturaleza === "DEBITO" ? "EGRESO" : "INGRESO",
      origen: "EXTRACTO",
      origenId: movimientoId,
      confianzaIA: mov.confianza_ia,
    },
    lineas,
  );

  await sb
    .from("movimientos_extracto")
    .update({ asiento_id: asientoId, conciliado: true })
    .eq("id", movimientoId);

  return asientoId;
}

// ---------------------------------------------------------------------------
// Retenciones
// ---------------------------------------------------------------------------

/**
 * Una retención RECIBIDA no es un gasto: es impuesto ya entregado al Estado
 * por cuenta nuestra, así que descarga la cuenta por cobrar y nace como
 * crédito tributario. Una retención EFECTUADA es lo simétrico: reduce lo que
 * le debemos al proveedor y crea una obligación con el SRI.
 */
export async function contabilizarRetencion(
  sb: SupabaseClient,
  entidadId: string,
  retencionId: string,
): Promise<string> {
  const { data: r, error } = await sb
    .from("retenciones")
    .select("*")
    .eq("id", retencionId)
    .single();

  if (error || !r) throw new ErrorContable("No se encontró la retención.");
  if (r.asiento_id) throw new ErrorContable("La retención ya está contabilizada.");

  const renta = c(Number(r.ret_renta));
  const iva = c(Number(r.ret_iva));
  const isd = c(Number(r.ret_isd));
  const total = c(renta + iva + isd);

  if (total <= 0) throw new ErrorContable("La retención no tiene valores.");

  const recibida = r.clase === "RECIBIDA";
  const lineas: Linea[] = [];

  if (recibida) {
    if (renta > 0) {
      lineas.push({
        cuentaCodigo: CUENTAS.RET_RENTA_RECIBIDA,
        detalle: "Retención de renta que nos efectuaron",
        debe: renta,
      });
    }
    if (iva > 0) {
      lineas.push({
        cuentaCodigo: CUENTAS.RET_IVA_RECIBIDA,
        detalle: "Retención de IVA que nos efectuaron",
        debe: iva,
      });
    }
    if (isd > 0) {
      lineas.push({ cuentaCodigo: CUENTAS.GASTO_FINANCIERO, detalle: "ISD retenido", debe: isd });
    }
    lineas.push({
      cuentaCodigo: CUENTAS.CLIENTES,
      detalle: `${r.nombre_contraparte} · retención ${r.numero ?? ""}`.trim(),
      terceroId: r.tercero_id,
      haber: total,
    });
  } else {
    lineas.push({
      cuentaCodigo: CUENTAS.PROVEEDORES,
      detalle: `${r.nombre_contraparte} · retención ${r.numero ?? ""}`.trim(),
      terceroId: r.tercero_id,
      debe: total,
    });
    if (renta > 0) {
      lineas.push({
        cuentaCodigo: CUENTAS.RET_RENTA_POR_PAGAR,
        detalle: "Retención de renta por pagar",
        haber: renta,
      });
    }
    if (iva > 0) {
      lineas.push({
        cuentaCodigo: CUENTAS.RET_IVA_POR_PAGAR,
        detalle: "Retención de IVA por pagar",
        haber: iva,
      });
    }
    if (isd > 0) {
      lineas.push({ cuentaCodigo: CUENTAS.ISD_POR_PAGAR, detalle: "ISD por pagar", haber: isd });
    }
  }

  const asientoId = await crearAsiento(
    sb,
    entidadId,
    {
      fecha: r.fecha,
      glosa: `Retención ${recibida ? "recibida de" : "efectuada a"} ${r.nombre_contraparte}`,
      tipo: "DIARIO",
      origen: "IMPUESTO",
      origenId: retencionId,
    },
    lineas,
  );

  await sb
    .from("retenciones")
    .update({ asiento_id: asientoId, estado: "CONTABILIZADA" })
    .eq("id", retencionId);

  // Solo lo que nos retienen a nosotros es crédito a nuestro favor.
  if (recibida) {
    const fecha = new Date(`${String(r.fecha).slice(0, 10)}T00:00:00Z`);
    const filas = [];
    if (iva > 0) {
      filas.push({
        entidad_id: entidadId,
        impuesto: "IVA",
        anio: fecha.getUTCFullYear(),
        mes: fecha.getUTCMonth() + 1,
        fecha: r.fecha,
        tipo: "RETENCION_RECIBIDA",
        concepto: `Retención de IVA de ${r.nombre_contraparte}`,
        monto: iva,
        referencia_id: retencionId,
      });
    }
    if (renta > 0) {
      filas.push({
        entidad_id: entidadId,
        impuesto: "RENTA",
        anio: fecha.getUTCFullYear(),
        mes: fecha.getUTCMonth() + 1,
        fecha: r.fecha,
        tipo: "RETENCION_RECIBIDA",
        concepto: `Retención de renta de ${r.nombre_contraparte}`,
        monto: renta,
        referencia_id: retencionId,
      });
    }
    if (filas.length) await sb.from("credito_tributario").insert(filas);
  }

  return asientoId;
}

// ---------------------------------------------------------------------------
// Cartera registrada a mano (préstamos, letras, pagarés)
// ---------------------------------------------------------------------------

/** Cuenta contable que corresponde a cada clase de documento de cartera. */
const CUENTA_CARTERA: Record<string, string> = {
  CXC: CUENTAS.CLIENTES,
  DOC_COBRAR: CUENTAS.DOC_COBRAR,
  CXP: CUENTAS.PROVEEDORES,
  DOC_PAGAR: CUENTAS.DOC_PAGAR,
};

const ES_COBRO = (clase: string) => clase === "CXC" || clase === "DOC_COBRAR";

export async function contabilizarCartera(
  sb: SupabaseClient,
  entidadId: string,
  carteraId: string,
): Promise<string> {
  const { data: doc, error } = await sb
    .from("cartera")
    .select("*")
    .eq("id", carteraId)
    .single();

  if (error || !doc) throw new ErrorContable("No se encontró el documento de cartera.");
  if (doc.asiento_id) throw new ErrorContable("El documento ya está contabilizado.");
  if (doc.compra_id || doc.venta_id) {
    throw new ErrorContable(
      "Este documento nació de una factura y ya quedó contabilizado con ella.",
    );
  }

  const cuentaCartera = CUENTA_CARTERA[doc.clase as string];
  if (!cuentaCartera) throw new ErrorContable(`Clase de cartera desconocida: ${doc.clase}`);

  // La contrapartida hay que decirla: «Bancos» ya no vale como cajón de
  // sastre, porque cada cuenta lleva su propio saldo.
  if (!doc.cuenta_id) {
    throw new ErrorContable("Indique la cuenta contra la que nace el documento.");
  }
  const contrapartida = (
    await sb.from("plan_cuentas").select("codigo").eq("id", doc.cuenta_id).single()
  ).data?.codigo;

  if (!contrapartida) throw new ErrorContable("No se resolvió la cuenta de contrapartida.");

  const monto = c(Number(doc.monto_original));

  // Un documento por cobrar nace contra la entrega de dinero; uno por pagar,
  // contra su recepción.
  const lineas: Linea[] = ES_COBRO(doc.clase)
    ? [
        { cuentaCodigo: cuentaCartera, detalle: doc.descripcion, terceroId: doc.tercero_id, debe: monto },
        { cuentaCodigo: contrapartida, detalle: doc.nombre_tercero, haber: monto },
      ]
    : [
        { cuentaCodigo: contrapartida, detalle: doc.nombre_tercero, debe: monto },
        { cuentaCodigo: cuentaCartera, detalle: doc.descripcion, terceroId: doc.tercero_id, haber: monto },
      ];

  const asientoId = await crearAsiento(
    sb,
    entidadId,
    {
      fecha: doc.fecha_emision,
      glosa: `${doc.descripcion} · ${doc.nombre_tercero}`,
      tipo: "DIARIO",
      origen: ES_COBRO(doc.clase) ? "COBRO" : "PAGO",
      origenId: carteraId,
    },
    lineas,
  );

  await sb.from("cartera").update({ asiento_id: asientoId }).eq("id", carteraId);
  return asientoId;
}

// ---------------------------------------------------------------------------
// Abono: cobro o pago aplicado a un documento de cartera
// ---------------------------------------------------------------------------
export async function contabilizarAbono(
  sb: SupabaseClient,
  entidadId: string,
  abonoId: string,
): Promise<string> {
  const { data: abono, error } = await sb
    .from("abonos")
    .select("*, cartera(clase, nombre_tercero, tercero_id, descripcion)")
    .eq("id", abonoId)
    .single();

  if (error || !abono) throw new ErrorContable("No se encontró el abono.");
  if (abono.asiento_id) throw new ErrorContable("El abono ya está contabilizado.");

  const doc = unaFila<{
    clase: string;
    nombre_tercero: string;
    tercero_id: string | null;
    descripcion: string;
  }>(abono.cartera);
  if (!doc) throw new ErrorContable("El abono no está ligado a ningún documento.");

  const cuentaCartera = CUENTA_CARTERA[doc.clase];
  // Sin cuenta no hay dónde apuntar el dinero. Antes caía en «Bancos», que
  // sumaba a ciegas el saldo de todas; ahora cada una lleva el suyo y hay que
  // decir cuál.
  if (!abono.cuenta_financiera_id) {
    throw new ErrorContable("Indique la cuenta por la que entró o salió el dinero.");
  }
  const fin = await cuentaDeFinanciera(sb, abono.cuenta_financiera_id);

  const monto = c(Number(abono.monto));
  const interes = c(Number(abono.interes ?? 0));
  const cobro = ES_COBRO(doc.clase);

  const lineas: Linea[] = [];

  if (cobro) {
    // Entra dinero y se descarga la cuenta por cobrar.
    lineas.push({ cuentaCodigo: fin.codigo, detalle: `Cobro ${doc.nombre_tercero}`, debe: c(monto + interes) });
    lineas.push({
      cuentaCodigo: cuentaCartera,
      detalle: doc.descripcion,
      terceroId: doc.tercero_id,
      haber: monto,
    });
    if (interes > 0) {
      lineas.push({ cuentaCodigo: CUENTAS.OTROS_INGRESOS, detalle: "Interés cobrado", haber: interes });
    }
  } else {
    lineas.push({
      cuentaCodigo: cuentaCartera,
      detalle: doc.descripcion,
      terceroId: doc.tercero_id,
      debe: monto,
    });
    if (interes > 0) {
      lineas.push({ cuentaCodigo: CUENTAS.GASTO_FINANCIERO, detalle: "Interés pagado", debe: interes });
    }
    lineas.push({ cuentaCodigo: fin.codigo, detalle: `Pago ${doc.nombre_tercero}`, haber: c(monto + interes) });
  }

  const asientoId = await crearAsiento(
    sb,
    entidadId,
    {
      fecha: abono.fecha,
      glosa: `${cobro ? "Cobro" : "Pago"} · ${doc.nombre_tercero}`,
      tipo: cobro ? "INGRESO" : "EGRESO",
      origen: cobro ? "COBRO" : "PAGO",
      origenId: abonoId,
    },
    lineas,
  );

  await sb.from("abonos").update({ asiento_id: asientoId }).eq("id", abonoId);
  return asientoId;
}

// ---------------------------------------------------------------------------
// Rol de pago (ingreso en relación de dependencia)
// ---------------------------------------------------------------------------
export async function contabilizarRolPago(
  sb: SupabaseClient,
  entidadId: string,
  rolId: string,
): Promise<string> {
  const { data: rol, error } = await sb
    .from("roles_pago")
    .select("*")
    .eq("id", rolId)
    .single();

  if (error || !rol) throw new ErrorContable("No se encontró el rol de pago.");
  if (rol.asiento_id) throw new ErrorContable("El rol ya está contabilizado.");

  const ingresos = c(Number(rol.total_ingresos));
  const iess = c(Number(rol.aporte_iess));
  const renta = c(Number(rol.impuesto_renta));
  const otros = c(
    Number(rol.prestamos_iess) + Number(rol.anticipos) + Number(rol.otros_descuentos),
  );
  const liquido = c(Number(rol.liquido_recibir));

  if (c(ingresos - iess - renta - otros) !== liquido) {
    throw new ErrorContable(
      `El rol no cuadra: ingresos ${ingresos} − descuentos ${c(iess + renta + otros)} ≠ líquido ${liquido}.`,
    );
  }

  // El líquido queda siempre en la bolsa, nunca en la cuenta de destino: el
  // dinero entra en la libreta cuando lo dice su extracto, y ese movimiento,
  // clasificado como ACREDITACIÓN DE SUELDO, es el que vacía la bolsa. Debitar
  // aquí la cuenta real dejaría el sueldo dos veces en ella.
  const lineas: Linea[] = [
    { cuentaCodigo: CUENTAS.SUELDO_PENDIENTE, detalle: "Sueldo acreditado", debe: liquido },
  ];
  if (iess > 0) {
    // El aporte personal lo retiene y lo remite el empleador: el trabajador no
    // le queda debiendo nada al IESS. Llevarlo a «Obligaciones con el IESS»
    // dejaba un pasivo con saldo deudor —una deuda en negativo— en el balance.
    // Desde su contabilidad es un gasto que le rebaja la renta, y ahí va.
    lineas.push({ cuentaCodigo: CUENTAS.APORTES_IESS, detalle: "Aporte personal IESS", debe: iess });
  }
  if (renta > 0) {
    lineas.push({
      cuentaCodigo: CUENTAS.RET_RENTA_RECIBIDA,
      detalle: "Retención de renta del empleador",
      debe: renta,
    });
  }
  if (otros > 0) {
    lineas.push({ cuentaCodigo: CUENTAS.GASTO_SIN_CLASIFICAR, detalle: "Otros descuentos", debe: otros });
  }
  lineas.push({
    cuentaCodigo: CUENTAS.INGRESO_DEPENDENCIA,
    detalle: `Rol ${String(rol.mes).padStart(2, "0")}/${rol.anio} · ${rol.nombre_empleador}`,
    terceroId: rol.tercero_id,
    haber: ingresos,
  });

  const fecha = new Date(Date.UTC(rol.anio, rol.mes, 0)).toISOString().slice(0, 10);

  const asientoId = await crearAsiento(
    sb,
    entidadId,
    {
      fecha,
      glosa: `Rol de pago ${String(rol.mes).padStart(2, "0")}/${rol.anio} · ${rol.nombre_empleador}`,
      tipo: "INGRESO",
      origen: "ROL_PAGO",
      origenId: rolId,
    },
    lineas,
  );

  await sb
    .from("roles_pago")
    .update({ asiento_id: asientoId, estado: "CONTABILIZADO" })
    .eq("id", rolId);

  // La retención del empleador es crédito contra el impuesto a la renta anual.
  if (renta > 0) {
    await sb.from("credito_tributario").insert({
      entidad_id: entidadId,
      impuesto: "RENTA",
      anio: rol.anio,
      mes: rol.mes,
      fecha,
      tipo: "RETENCION_RECIBIDA",
      concepto: `Retención en relación de dependencia ${rol.nombre_empleador}`,
      monto: renta,
      referencia_id: rolId,
    });
  }

  return asientoId;
}
