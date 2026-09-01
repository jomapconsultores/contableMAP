import { endpoints } from "./catalogos";

/**
 * Web services del SRI: Recepción y Autorización del esquema offline.
 *
 * Son dos pasos separados y asíncronos por diseño: la recepción solo dice que
 * el comprobante entró en la cola ("RECIBIDA"); la autorización, que puede
 * tardar, es la que le da validez tributaria. Un comprobante recibido pero no
 * autorizado no existe para el SRI.
 */

export class ErrorSri extends Error {
  // Campo declarado y asignado en el cuerpo, no como propiedad de parámetro:
  // así Node ejecuta este módulo quitando tipos y las pruebas pueden usarlo.
  readonly reintentable: boolean;

  constructor(mensaje: string, reintentable = false) {
    super(mensaje);
    this.name = "ErrorSri";
    this.reintentable = reintentable;
  }
}

export interface MensajeSri {
  identificador: string;
  mensaje: string;
  informacionAdicional: string | null;
  tipo: string;
}

export interface RespuestaRecepcion {
  estado: string; // RECIBIDA | DEVUELTA
  mensajes: MensajeSri[];
}

export interface RespuestaAutorizacion {
  estado: string; // AUTORIZADO | NO AUTORIZADO | EN PROCESAMIENTO | SIN AUTORIZACION
  numeroAutorizacion: string | null;
  fechaAutorizacion: string | null;
  ambiente: string | null;
  /** XML autorizado tal como lo devuelve el SRI, ya fuera del CDATA. */
  comprobante: string | null;
  mensajes: MensajeSri[];
}

/** Contenido de todas las etiquetas con ese nombre, ignorando el prefijo. */
function etiquetas(xml: string, nombre: string): string[] {
  const re = new RegExp(
    `<(?:[\\w.-]+:)?${nombre}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w.-]+:)?${nombre}>`,
    "g",
  );
  const salida: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) salida.push(m[1]);
  return salida;
}

const etiqueta = (xml: string, nombre: string): string | null => etiquetas(xml, nombre)[0] ?? null;

const desescapar = (v: string) =>
  v
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();

/**
 * El SRI anida un `<mensaje>` con el texto dentro del `<mensaje>` que agrupa
 * los campos del error. Una captura no codiciosa sobre el nombre repetido se
 * corta en el cierre del interno y devuelve el bloque partido: se leía el
 * identificador y se perdían el texto y la información adicional, que es donde
 * el SRI dice qué está mal. Se delimita el bloque por `<identificador>` para
 * que el `</mensaje>` que lo cierra sea siempre el de fuera.
 */
export function leerMensajes(xml: string): MensajeSri[] {
  // Se recorre por `<identificador>`, que aparece una vez por error y nunca
  // anidado, y se toma como ventana lo que va hasta el siguiente. Así el
  // `<mensaje>` interior se lee sin depender de emparejar dos etiquetas con el
  // mismo nombre, que es donde se perdía el texto.
  const marcas = [...xml.matchAll(/<(?:[\w.-]+:)?identificador(?:\s[^>]*)?>/g)];

  return marcas.map((marca, i) => {
    const desde = marca.index ?? 0;
    const hasta = i + 1 < marcas.length ? (marcas[i + 1].index ?? xml.length) : xml.length;
    const ventana = xml.slice(desde, hasta);

    return {
      identificador: desescapar(etiqueta(ventana, "identificador") ?? ""),
      mensaje: desescapar(etiqueta(ventana, "mensaje") ?? ""),
      informacionAdicional: etiqueta(ventana, "informacionAdicional")
        ? desescapar(etiqueta(ventana, "informacionAdicional") as string)
        : null,
      tipo: desescapar(etiqueta(ventana, "tipo") ?? "ERROR"),
    };
  });
}

/** Una llamada SOAP 1.1 con su tiempo de espera. */
async function soap(url: string, cuerpo: string, tiempoMs = 45000): Promise<string> {
  let respuesta: Response;
  try {
    respuesta = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml;charset=UTF-8",
        SOAPAction: "",
      },
      body: cuerpo,
      signal: AbortSignal.timeout(tiempoMs),
      cache: "no-store",
    });
  } catch (e) {
    const detalle = e instanceof Error ? e.message : String(e);
    throw new ErrorSri(
      `No se pudo contactar con el SRI (${detalle}). El servicio suele estar caído en horarios de mantenimiento; se puede reintentar.`,
      true,
    );
  }

  const texto = await respuesta.text();

  if (!respuesta.ok) {
    const fault = etiqueta(texto, "faultstring");
    throw new ErrorSri(
      `El SRI respondió ${respuesta.status}${fault ? `: ${desescapar(fault)}` : ""}.`,
      respuesta.status >= 500,
    );
  }

  const fault = etiqueta(texto, "faultstring");
  if (fault) throw new ErrorSri(`El SRI rechazó la petición: ${desescapar(fault)}`, false);

  return texto;
}

/** Paso 1: entregar el comprobante firmado. */
export async function enviarRecepcion(
  xmlFirmado: string,
  ambiente: number,
): Promise<RespuestaRecepcion> {
  const sobre =
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ec="http://ec.gob.sri.ws.recepcion">' +
    "<soapenv:Header></soapenv:Header><soapenv:Body>" +
    "<ec:validarComprobante>" +
    `<xml>${Buffer.from(xmlFirmado, "utf8").toString("base64")}</xml>` +
    "</ec:validarComprobante>" +
    "</soapenv:Body></soapenv:Envelope>";

  const texto = await soap(endpoints(ambiente).recepcion, sobre);
  const estado = desescapar(etiqueta(texto, "estado") ?? "");

  if (!estado) {
    throw new ErrorSri("El SRI respondió algo que no se pudo interpretar en la recepción.", true);
  }
  return { estado, mensajes: leerMensajes(texto) };
}

/** Paso 2: consultar si ya está autorizado. */
export async function consultarAutorizacion(
  claveAcceso: string,
  ambiente: number,
): Promise<RespuestaAutorizacion> {
  const sobre =
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ec="http://ec.gob.sri.ws.autorizacion">' +
    "<soapenv:Header></soapenv:Header><soapenv:Body>" +
    "<ec:autorizacionComprobante>" +
    `<claveAccesoComprobante>${claveAcceso}</claveAccesoComprobante>` +
    "</ec:autorizacionComprobante>" +
    "</soapenv:Body></soapenv:Envelope>";

  const texto = await soap(endpoints(ambiente).autorizacion, sobre);
  const bloque = etiqueta(texto, "autorizacion");

  if (!bloque) {
    // El SRI aún no ha procesado la clave: no es un error, es que hay que
    // volver a preguntar.
    return {
      estado: "EN PROCESAMIENTO",
      numeroAutorizacion: null,
      fechaAutorizacion: null,
      ambiente: null,
      comprobante: null,
      mensajes: [],
    };
  }

  const comprobante = etiqueta(bloque, "comprobante");

  return {
    estado: desescapar(etiqueta(bloque, "estado") ?? "EN PROCESAMIENTO"),
    numeroAutorizacion: etiqueta(bloque, "numeroAutorizacion")
      ? desescapar(etiqueta(bloque, "numeroAutorizacion") as string)
      : null,
    fechaAutorizacion: etiqueta(bloque, "fechaAutorizacion")
      ? desescapar(etiqueta(bloque, "fechaAutorizacion") as string)
      : null,
    ambiente: etiqueta(bloque, "ambiente") ? desescapar(etiqueta(bloque, "ambiente") as string) : null,
    comprobante: comprobante ? desescapar(comprobante) : null,
    mensajes: leerMensajes(bloque),
  };
}

/**
 * Pregunta por la autorización varias veces, espaciando los intentos.
 *
 * El SRI autoriza casi siempre en el primer segundo, pero en cierre de mes
 * puede tardar. Se espera hasta ~15 s y, si sigue en proceso, se deja
 * pendiente: la factura ya está entregada y la consulta se puede repetir
 * después sin volver a enviarla.
 */
export async function esperarAutorizacion(
  claveAcceso: string,
  ambiente: number,
  intentos = 4,
): Promise<RespuestaAutorizacion> {
  const esperas = [1200, 2500, 5000, 8000];
  let ultima: RespuestaAutorizacion | null = null;

  for (let i = 0; i < intentos; i += 1) {
    await new Promise((r) => setTimeout(r, esperas[Math.min(i, esperas.length - 1)]));
    ultima = await consultarAutorizacion(claveAcceso, ambiente);
    if (ultima.estado !== "EN PROCESAMIENTO") return ultima;
  }

  return (
    ultima ?? {
      estado: "EN PROCESAMIENTO",
      numeroAutorizacion: null,
      fechaAutorizacion: null,
      ambiente: null,
      comprobante: null,
      mensajes: [],
    }
  );
}
