import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

import { ErrorPeticion } from "@/lib/api";
import { claveAcceso, codigoNumericoAleatorio } from "./clave-acceso";
import { leerP12, descifrar, ErrorCertificado, type Certificado } from "./certificado";
import { firmarXml } from "./firma";
import { generarXmlFactura, codigoIdentificacion, n2, type DatosFactura } from "./xml";
import { TIPO_COMPROBANTE, FORMAS_PAGO, leyendaRegimen } from "./catalogos";
import { enviarRecepcion, esperarAutorizacion, consultarAutorizacion, ErrorSri } from "./ws";

/**
 * Emisión de una factura electrónica de principio a fin.
 *
 * El orden importa y no es negociable: primero se reserva el secuencial y se
 * guarda la venta, y solo después se habla con el SRI. Si el envío falla, la
 * factura queda registrada con su clave de acceso y se puede reintentar; al
 * revés se perdería el rastro de un secuencial ya consumido, que es
 * precisamente lo que el SRI no perdona.
 */

const ITEM = z.object({
  codigo_principal: z.string().min(1).max(25),
  codigo_auxiliar: z.string().max(25).nullish(),
  descripcion: z.string().min(1).max(300),
  cantidad: z.number().positive(),
  precio_unitario: z.number().min(0),
  descuento: z.number().min(0).default(0),
  tarifa: z.enum(["0", "5", "8", "15", "NO_OBJETO", "EXENTO"]).default("15"),
});

const PAGO = z.object({
  forma_pago: z.string().refine((v) => v in FORMAS_PAGO, "Forma de pago no prevista por el SRI."),
  total: z.number().positive(),
  plazo: z.number().int().positive().nullish(),
  unidad_tiempo: z.string().nullish(),
});

export const FacturaAEmitir = z.object({
  punto_emision_id: z.string().uuid().nullish(),
  fecha: z.string().nullish(),
  tipo_id_cliente: z.enum(["RUC", "CEDULA", "PASAPORTE", "CONSUMIDOR_FINAL", "IDENT_EXTERIOR"]),
  id_cliente: z.string().min(1).max(20),
  razon_social_cliente: z.string().min(1).max(300),
  direccion_cliente: z.string().max(300).nullish(),
  email_cliente: z.string().email().nullish().or(z.literal("")),
  telefono_cliente: z.string().max(50).nullish(),
  concepto: z.string().max(300).nullish(),
  propina: z.number().min(0).default(0),
  items: z.array(ITEM).min(1, "La factura necesita al menos una línea."),
  pagos: z.array(PAGO).min(1, "Hay que indicar cómo se paga la factura."),
  a_credito: z.boolean().default(false),
  fecha_vencimiento: z.string().nullish(),
  cuenta_financiera_id: z.string().uuid().nullish(),
  cuenta_ingreso_id: z.string().uuid().nullish(),
  /** Solo pruebas: no envía nada al SRI, devuelve el XML firmado. */
  simular: z.boolean().default(false),
});

export type FacturaAEmitir = z.infer<typeof FacturaAEmitir>;

const CONSUMIDOR_FINAL = "9999999999999";
/** Tope del consumidor final. Por encima hay que identificar al comprador. */
const TOPE_CONSUMIDOR_FINAL = 50;

/** Cédula ecuatoriana: módulo 10 sobre los nueve primeros dígitos. */
function cedulaValida(v: string): boolean {
  if (!/^[0-9]{10}$/.test(v)) return false;
  const provincia = Number(v.slice(0, 2));
  if (provincia < 1 || (provincia > 24 && provincia !== 30)) return false;
  let suma = 0;
  for (let i = 0; i < 9; i += 1) {
    let d = Number(v[i]) * (i % 2 === 0 ? 2 : 1);
    if (d > 9) d -= 9;
    suma += d;
  }
  return (10 - (suma % 10)) % 10 === Number(v[9]);
}

function validarIdentificacion(tipo: string, id: string) {
  if (tipo === "CONSUMIDOR_FINAL") return;
  if (tipo === "RUC") {
    if (!/^[0-9]{13}$/.test(id)) throw new ErrorPeticion(`El RUC "${id}" no tiene 13 dígitos.`);
    if (!cedulaValida(id.slice(0, 10)) && !/^[0-9]{2}[69]/.test(id)) {
      throw new ErrorPeticion(`El RUC "${id}" no supera la comprobación del dígito verificador.`);
    }
    return;
  }
  if (tipo === "CEDULA" && !cedulaValida(id)) {
    throw new ErrorPeticion(`La cédula "${id}" no es válida.`);
  }
}

export interface ResultadoEmision {
  venta_id: string;
  clave_acceso: string;
  numero: string;
  estado: string;
  autorizacion: string | null;
  fecha_autorizacion: string | null;
  mensajes: { identificador: string; mensaje: string; informacionAdicional: string | null; tipo: string }[];
  total: number;
  xml_firmado?: string;
}

interface Emisor {
  entidad: {
    id: string;
    ruc: string;
    razon_social: string;
    nombre_comercial: string | null;
    regimen: string;
    obligado_contabilidad: boolean;
    direccion: string | null;
  };
  config: {
    ambiente: number;
    tipo_emision: number;
    dir_matriz: string;
    num_resolucion_especial: string | null;
    agente_retencion_resolucion: string | null;
    email_emisor: string | null;
    cert_path: string | null;
    cert_password_cifrada: string | null;
    cert_hasta: string | null;
  };
}

/** Lee entidad y configuración, y comprueba que se puede emitir. */
async function cargarEmisor(sb: SupabaseClient, entidadId: string): Promise<Emisor> {
  const { data: entidad } = await sb
    .from("entidades")
    .select("id, ruc, razon_social, nombre_comercial, regimen, obligado_contabilidad, direccion")
    .eq("id", entidadId)
    .maybeSingle();

  if (!entidad) throw new ErrorPeticion("No se encontró la entidad emisora.", 404);

  const { data: config } = await sb
    .from("sri_config")
    .select(
      "ambiente, tipo_emision, dir_matriz, num_resolucion_especial, agente_retencion_resolucion, email_emisor, cert_path, cert_password_cifrada, cert_hasta",
    )
    .eq("entidad_id", entidadId)
    .maybeSingle();

  if (!config) {
    throw new ErrorPeticion(
      "Todavía no está configurada la facturación electrónica. Ve a Ajustes y carga el certificado y la dirección de la matriz.",
      409,
    );
  }
  if (!config.cert_path || !config.cert_password_cifrada) {
    throw new ErrorPeticion("Falta cargar el certificado de firma electrónica en Ajustes.", 409);
  }
  if (config.cert_hasta && new Date(config.cert_hasta) < new Date()) {
    throw new ErrorPeticion(
      "El certificado de firma está caducado. Renuévalo antes de emitir.",
      409,
    );
  }

  return { entidad, config } as Emisor;
}

/** Descarga el .p12 del almacenamiento privado y lo abre. */
export async function cargarCertificado(
  sb: SupabaseClient,
  config: Emisor["config"],
): Promise<Certificado> {
  const { data, error } = await sb.storage.from("certificados").download(config.cert_path as string);
  if (error || !data) {
    throw new ErrorPeticion(
      `No se pudo leer el certificado guardado: ${error?.message ?? "archivo no encontrado"}`,
      500,
    );
  }
  const bytes = Buffer.from(await data.arrayBuffer());
  try {
    return leerP12(bytes, descifrar(config.cert_password_cifrada as string));
  } catch (e) {
    if (e instanceof ErrorCertificado) throw new ErrorPeticion(e.message, 409);
    throw e;
  }
}

/** Punto de emisión indicado, o el primero activo de la entidad. */
async function cargarPunto(sb: SupabaseClient, entidadId: string, puntoId?: string | null) {
  let q = sb
    .from("puntos_emision")
    .select("id, establecimiento, punto_emision, direccion")
    .eq("entidad_id", entidadId)
    .eq("activo", true);

  q = puntoId ? q.eq("id", puntoId) : q.order("created_at", { ascending: true }).limit(1);

  const { data } = await q.maybeSingle();
  if (!data) {
    throw new ErrorPeticion(
      "No hay ningún punto de emisión configurado. Créalo en Ajustes (por ejemplo 001-001).",
      409,
    );
  }
  return data;
}

/** Deja constancia de cada conversación con el SRI. */
async function anotarEnvio(
  sb: SupabaseClient,
  fila: {
    entidad_id: string;
    venta_id: string;
    clave_acceso: string;
    ambiente: number;
    paso: "RECEPCION" | "AUTORIZACION";
    estado: string;
    mensajes: unknown;
    duracion_ms: number;
  },
) {
  await sb.from("sri_envios").insert(fila);
}

export async function emitirFactura(
  sb: SupabaseClient,
  entidadId: string,
  userId: string,
  entrada: FacturaAEmitir,
): Promise<ResultadoEmision> {
  const { entidad, config } = await cargarEmisor(sb, entidadId);
  const punto = await cargarPunto(sb, entidadId, entrada.punto_emision_id);

  validarIdentificacion(entrada.tipo_id_cliente, entrada.id_cliente);

  const identificacion =
    entrada.tipo_id_cliente === "CONSUMIDOR_FINAL" ? CONSUMIDOR_FINAL : entrada.id_cliente.trim();

  const fecha = entrada.fecha ? new Date(`${entrada.fecha}T12:00:00`) : new Date();
  if (Number.isNaN(fecha.getTime())) throw new ErrorPeticion("La fecha de emisión no es válida.");

  const certificado = await cargarCertificado(sb, config);

  // --- XML -----------------------------------------------------------------
  const datos: DatosFactura = {
    ambiente: config.ambiente,
    tipoEmision: config.tipo_emision,
    razonSocial: entidad.razon_social,
    nombreComercial: entidad.nombre_comercial,
    ruc: entidad.ruc,
    claveAcceso: "0".repeat(49), // se sustituye tras reservar el secuencial
    establecimiento: punto.establecimiento,
    puntoEmision: punto.punto_emision,
    secuencial: "0".repeat(9),
    dirMatriz: config.dir_matriz,
    contribuyenteRimpe: leyendaRegimen(entidad.regimen),
    agenteRetencion: config.agente_retencion_resolucion,
    fechaEmision: fecha,
    dirEstablecimiento: punto.direccion ?? entidad.direccion,
    contribuyenteEspecial: config.num_resolucion_especial,
    obligadoContabilidad: entidad.obligado_contabilidad,
    tipoIdComprador: codigoIdentificacion(entrada.tipo_id_cliente),
    razonSocialComprador:
      entrada.tipo_id_cliente === "CONSUMIDOR_FINAL"
        ? "CONSUMIDOR FINAL"
        : entrada.razon_social_cliente,
    identificacionComprador: identificacion,
    direccionComprador: entrada.direccion_cliente,
    propina: entrada.propina,
    items: entrada.items.map((i) => ({
      codigoPrincipal: i.codigo_principal,
      codigoAuxiliar: i.codigo_auxiliar,
      descripcion: i.descripcion,
      cantidad: i.cantidad,
      precioUnitario: i.precio_unitario,
      descuento: i.descuento,
      tarifa: i.tarifa,
    })),
    pagos: entrada.pagos.map((p) => ({
      formaPago: p.forma_pago,
      total: p.total,
      plazo: p.plazo,
      unidadTiempo: p.unidad_tiempo,
    })),
    infoAdicional: [
      { nombre: "Email", valor: entrada.email_cliente || "" },
      { nombre: "Teléfono", valor: entrada.telefono_cliente || "" },
      { nombre: "Dirección", valor: entrada.direccion_cliente || "" },
    ],
  };

  // Se generan los totales antes de reservar nada: si la factura no cuadra,
  // no se gasta un secuencial.
  const previo = generarXmlFactura(datos);

  if (
    entrada.tipo_id_cliente === "CONSUMIDOR_FINAL" &&
    previo.totales.importeTotal > TOPE_CONSUMIDOR_FINAL
  ) {
    throw new ErrorPeticion(
      `Con consumidor final el SRI solo admite hasta $${TOPE_CONSUMIDOR_FINAL}. Esta factura suma $${previo.totales.importeTotal.toFixed(2)}: identifica al comprador.`,
    );
  }

  // --- Secuencial y clave de acceso ---------------------------------------
  const { data: secuencialCrudo, error: errorSec } = await sb.rpc("sri_siguiente_secuencial", {
    p_punto: punto.id,
    p_tipo: "FACTURA",
  });
  if (errorSec) throw new ErrorPeticion(`No se pudo reservar el secuencial: ${errorSec.message}`, 500);

  const secuencial = String(secuencialCrudo).padStart(9, "0");
  const codigoNumerico = codigoNumericoAleatorio();
  const clave = claveAcceso({
    fecha,
    tipoComprobante: TIPO_COMPROBANTE.FACTURA,
    ruc: entidad.ruc,
    ambiente: config.ambiente,
    establecimiento: punto.establecimiento,
    puntoEmision: punto.punto_emision,
    secuencial,
    codigoNumerico,
    tipoEmision: config.tipo_emision,
  });

  const { xml, totales } = generarXmlFactura({ ...datos, claveAcceso: clave, secuencial });
  const xmlFirmado = firmarXml(xml, certificado, { fecha });

  // --- Cliente y venta -----------------------------------------------------
  const terceroId = await upsertCliente(sb, entidadId, entrada, identificacion);

  const porTarifa = (t: string) => totales.porTarifa.find((g) => g.tarifa === t)?.base ?? 0;
  const ivaTarifa = (t: string) => totales.porTarifa.find((g) => g.tarifa === t)?.valor ?? 0;

  const { data: venta, error: errorVenta } = await sb
    .from("ventas")
    .insert({
      entidad_id: entidadId,
      fecha: fecha.toISOString().slice(0, 10),
      tipo_comprobante: "FACTURA",
      establecimiento: punto.establecimiento,
      punto_emision: punto.punto_emision,
      secuencial,
      punto_emision_id: punto.id,
      clave_acceso: clave,
      codigo_numerico: codigoNumerico,
      tercero_id: terceroId,
      tipo_id_cliente: entrada.tipo_id_cliente,
      id_cliente: identificacion,
      razon_social_cliente: datos.razonSocialComprador,
      direccion_cliente: entrada.direccion_cliente ?? null,
      email_cliente: entrada.email_cliente || null,
      telefono_cliente: entrada.telefono_cliente ?? null,
      base_0: porTarifa("0"),
      base_5: porTarifa("5"),
      base_8: porTarifa("8"),
      base_15: porTarifa("15"),
      no_objeto_iva: porTarifa("NO_OBJETO"),
      exento_iva: porTarifa("EXENTO"),
      iva_5: ivaTarifa("5"),
      iva_8: ivaTarifa("8"),
      iva_15: ivaTarifa("15"),
      descuento: totales.totalDescuento,
      propina: totales.propina,
      total: totales.importeTotal,
      concepto: entrada.concepto ?? entrada.items[0]?.descripcion ?? null,
      forma_pago_sri: entrada.pagos[0]?.forma_pago ?? null,
      cuenta_ingreso_id: entrada.cuenta_ingreso_id ?? null,
      cuenta_financiera_id: entrada.cuenta_financiera_id ?? null,
      a_credito: entrada.a_credito,
      fecha_vencimiento: entrada.fecha_vencimiento ?? null,
      sri_ambiente: config.ambiente,
      sri_estado: "FIRMADA",
      estado: "REGISTRADA",
    })
    .select("id, numero")
    .single();

  if (errorVenta || !venta) {
    throw new ErrorPeticion(
      `No se pudo registrar la factura ${punto.establecimiento}-${punto.punto_emision}-${secuencial}: ${errorVenta?.message}`,
      500,
    );
  }

  await sb.from("venta_items").insert(
    totales.items.map((i, idx) => ({
      venta_id: venta.id,
      orden: idx + 1,
      codigo_principal: i.codigoPrincipal,
      codigo_auxiliar: i.codigoAuxiliar ?? null,
      descripcion: i.descripcion,
      cantidad: i.cantidad,
      precio_unitario: i.precioUnitario,
      descuento: i.descuento,
      tarifa: i.tarifa,
      base: i.base,
      iva: i.iva,
    })),
  );

  const rutaFirmado = `${userId}/${clave}.xml`;
  await sb.storage.from("comprobantes").upload(rutaFirmado, new Blob([xmlFirmado], { type: "application/xml" }), {
    upsert: true,
    contentType: "application/xml",
  });
  await sb.from("ventas").update({ xml_firmado_path: rutaFirmado }).eq("id", venta.id);

  const base: ResultadoEmision = {
    venta_id: venta.id as string,
    clave_acceso: clave,
    numero: (venta.numero as string) ?? `${punto.establecimiento}-${punto.punto_emision}-${secuencial}`,
    estado: "FIRMADA",
    autorizacion: null,
    fecha_autorizacion: null,
    mensajes: [],
    total: totales.importeTotal,
  };

  // En modo simulación se para aquí: sirve para revisar el XML antes de
  // mandar nada al SRI.
  if (entrada.simular) return { ...base, xml_firmado: xmlFirmado };

  return enviarAlSri(sb, entidadId, userId, {
    ...base,
    xmlFirmado,
    ambiente: config.ambiente,
  });
}

/** Recepción + autorización, con el resultado guardado en la venta. */
async function enviarAlSri(
  sb: SupabaseClient,
  entidadId: string,
  userId: string,
  ctx: ResultadoEmision & { xmlFirmado: string; ambiente: number },
): Promise<ResultadoEmision> {
  const { venta_id, clave_acceso, ambiente } = ctx;

  let recepcion;
  const t0 = Date.now();
  try {
    recepcion = await enviarRecepcion(ctx.xmlFirmado, ambiente);
  } catch (e) {
    const mensaje = e instanceof ErrorSri ? e.message : "Error al contactar con el SRI.";
    await sb
      .from("ventas")
      .update({
        sri_estado: "FIRMADA",
        sri_intentos: 1,
        sri_mensajes: [{ tipo: "ERROR", mensaje }],
      })
      .eq("id", venta_id);
    throw new ErrorPeticion(
      `${mensaje} La factura ${ctx.numero} quedó firmada y guardada: puedes reintentar el envío sin volver a crearla.`,
      502,
    );
  }

  await anotarEnvio(sb, {
    entidad_id: entidadId,
    venta_id,
    clave_acceso,
    ambiente,
    paso: "RECEPCION",
    estado: recepcion.estado,
    mensajes: recepcion.mensajes,
    duracion_ms: Date.now() - t0,
  });

  if (recepcion.estado !== "RECIBIDA") {
    await sb
      .from("ventas")
      .update({
        sri_estado: "DEVUELTA",
        sri_mensajes: recepcion.mensajes,
        sri_intentos: 1,
      })
      .eq("id", venta_id);
    return { ...ctx, estado: "DEVUELTA", mensajes: recepcion.mensajes };
  }

  await sb.from("ventas").update({ sri_estado: "RECIBIDA", sri_intentos: 1 }).eq("id", venta_id);

  return await resolverAutorizacion(sb, entidadId, userId, venta_id, clave_acceso, ambiente, ctx);
}

/** Consulta la autorización y deja la venta en su estado definitivo. */
async function resolverAutorizacion(
  sb: SupabaseClient,
  entidadId: string,
  userId: string,
  ventaId: string,
  clave: string,
  ambiente: number,
  base: ResultadoEmision,
  inmediata = false,
): Promise<ResultadoEmision> {
  const t0 = Date.now();
  const auth = inmediata
    ? await consultarAutorizacion(clave, ambiente)
    : await esperarAutorizacion(clave, ambiente);

  await anotarEnvio(sb, {
    entidad_id: entidadId,
    venta_id: ventaId,
    clave_acceso: clave,
    ambiente,
    paso: "AUTORIZACION",
    estado: auth.estado,
    mensajes: auth.mensajes,
    duracion_ms: Date.now() - t0,
  });

  if (auth.estado === "AUTORIZADO") {
    let rutaAutorizado: string | null = null;
    if (auth.comprobante) {
      rutaAutorizado = `${userId}/${clave}-autorizado.xml`;
      await sb.storage
        .from("comprobantes")
        .upload(rutaAutorizado, new Blob([auth.comprobante], { type: "application/xml" }), {
          upsert: true,
          contentType: "application/xml",
        });
    }

    await sb
      .from("ventas")
      .update({
        sri_estado: "AUTORIZADA",
        autorizacion: auth.numeroAutorizacion ?? clave,
        sri_fecha_autorizacion: auth.fechaAutorizacion,
        sri_mensajes: auth.mensajes,
        xml_autorizado_path: rutaAutorizado,
      })
      .eq("id", ventaId);

    return {
      ...base,
      estado: "AUTORIZADA",
      autorizacion: auth.numeroAutorizacion ?? clave,
      fecha_autorizacion: auth.fechaAutorizacion,
      mensajes: auth.mensajes,
    };
  }

  const estado = auth.estado === "EN PROCESAMIENTO" ? "RECIBIDA" : "NO_AUTORIZADA";
  await sb
    .from("ventas")
    .update({ sri_estado: estado, sri_mensajes: auth.mensajes })
    .eq("id", ventaId);

  return { ...base, estado, mensajes: auth.mensajes };
}

/**
 * Reintenta el envío de una factura que quedó firmada o a medias. No vuelve a
 * generar ni a firmar nada: la clave de acceso ya está reservada y reutilizarla
 * es justamente lo correcto.
 */
export async function reintentarEnvio(
  sb: SupabaseClient,
  entidadId: string,
  userId: string,
  ventaId: string,
): Promise<ResultadoEmision> {
  const { data: venta } = await sb
    .from("ventas")
    .select("id, numero, clave_acceso, sri_estado, sri_ambiente, sri_intentos, xml_firmado_path, total")
    .eq("id", ventaId)
    .maybeSingle();

  if (!venta) throw new ErrorPeticion("La factura no existe.", 404);
  if (!venta.clave_acceso) throw new ErrorPeticion("Esa venta no se emitió electrónicamente.", 409);
  if (venta.sri_estado === "AUTORIZADA") {
    throw new ErrorPeticion("La factura ya está autorizada por el SRI.", 409);
  }

  const ambiente = Number(venta.sri_ambiente ?? 1);
  const base: ResultadoEmision = {
    venta_id: venta.id as string,
    clave_acceso: venta.clave_acceso as string,
    numero: venta.numero as string,
    estado: venta.sri_estado as string,
    autorizacion: null,
    fecha_autorizacion: null,
    mensajes: [],
    total: Number(venta.total ?? 0),
  };

  // Si ya está en la cola del SRI, basta con volver a preguntar.
  if (venta.sri_estado === "RECIBIDA") {
    return resolverAutorizacion(
      sb,
      entidadId,
      userId,
      ventaId,
      venta.clave_acceso as string,
      ambiente,
      base,
      true,
    );
  }

  if (!venta.xml_firmado_path) {
    throw new ErrorPeticion(
      "No se guardó el XML firmado de esta factura; hay que emitirla de nuevo con otro secuencial.",
      409,
    );
  }

  const { data: archivo, error } = await sb.storage
    .from("comprobantes")
    .download(venta.xml_firmado_path as string);
  if (error || !archivo) {
    throw new ErrorPeticion(`No se pudo recuperar el XML firmado: ${error?.message}`, 500);
  }

  await sb
    .from("ventas")
    .update({ sri_intentos: Number(venta.sri_intentos ?? 0) + 1 })
    .eq("id", ventaId);

  return enviarAlSri(sb, entidadId, userId, {
    ...base,
    xmlFirmado: await archivo.text(),
    ambiente,
  });
}

/** Crea o actualiza el cliente en `terceros` para no reescribirlo cada vez. */
async function upsertCliente(
  sb: SupabaseClient,
  entidadId: string,
  entrada: FacturaAEmitir,
  identificacion: string,
): Promise<string | null> {
  if (entrada.tipo_id_cliente === "CONSUMIDOR_FINAL") return null;

  const { data } = await sb
    .from("terceros")
    .upsert(
      {
        entidad_id: entidadId,
        tipo_identificacion: entrada.tipo_id_cliente,
        identificacion,
        razon_social: entrada.razon_social_cliente,
        es_cliente: true,
        email: entrada.email_cliente || null,
        telefono: entrada.telefono_cliente ?? null,
      },
      { onConflict: "entidad_id,identificacion" },
    )
    .select("id")
    .maybeSingle();

  return (data?.id as string) ?? null;
}

export { n2 };
