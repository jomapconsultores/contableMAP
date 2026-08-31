import { z } from "zod";

/**
 * Capa de IA. Todo el acoplamiento con el proveedor vive aquí: el resto del
 * sistema (esquemas, prompts, extracción, clasificación, rutas) solo conoce
 * `consultar`, `bloqueArchivo` y los tipos de resultado.
 *
 * Proveedor: Mistral (chat completions con salidas estructuradas por esquema
 * JSON). Los modelos con visión leen imágenes y PDF directamente.
 */

const BASE = "https://api.mistral.ai/v1/chat/completions";
const BASE_OCR = "https://api.mistral.ai/v1/ocr";

/**
 * Modelo de transcripción. Los estados de cuenta llegan escaneados, sin capa
 * de texto, y un modelo de chat con visión se equivoca leyendo cifras —en las
 * pruebas confundió 46,80 con 46,50—. El OCR dedicado las lee exactas, así que
 * transcribe primero y el modelo de chat solo estructura texto.
 */
const MODELO_OCR = process.env.MISTRAL_OCR_MODEL ?? "mistral-ocr-latest";

/** Modelo por defecto para extracción de documentos, donde importa la exactitud. */
export const MODELO = process.env.MISTRAL_MODEL ?? "mistral-medium-latest";

function apiKey(): string {
  const k = process.env.MISTRAL_API_KEY;
  if (!k) throw new Error("Falta MISTRAL_API_KEY");
  return k;
}

/**
 * El esfuerzo se traduce a modelo. Desde que el OCR transcribe los documentos,
 * ningún trabajo necesita visión ni el nivel de `large`: al modelo de chat le
 * llega texto ya leído y solo tiene que estructurarlo. Si la suscripción
 * vuelve a admitir un modelo mayor, basta con fijar `MISTRAL_MODEL`.
 */
function modeloPara(esfuerzo: Esfuerzo): string {
  if (process.env.MISTRAL_MODEL) return process.env.MISTRAL_MODEL;
  return esfuerzo === "low" ? "mistral-small-latest" : "mistral-medium-latest";
}

type Esfuerzo = "low" | "medium" | "high" | "xhigh" | "max";

// ---------------------------------------------------------------------------
// JSON Schema para salidas estructuradas
// ---------------------------------------------------------------------------

/**
 * Palabras clave de JSON Schema que el modo estricto no admite. Se eliminan
 * del esquema enviado al modelo; la validación real la hace zod sobre la
 * respuesta, así que no se pierde ninguna garantía.
 */
const NO_SOPORTADAS = new Set([
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "pattern",
  "format",
  "minItems",
  "maxItems",
  "uniqueItems",
  "default",
]);

type Json = Record<string, unknown>;

function sanear(nodo: unknown): unknown {
  if (Array.isArray(nodo)) return nodo.map(sanear);
  if (nodo === null || typeof nodo !== "object") return nodo;

  const salida: Json = {};
  for (const [clave, valor] of Object.entries(nodo as Json)) {
    if (NO_SOPORTADAS.has(clave)) continue;
    salida[clave] = sanear(valor);
  }

  // El modo estricto exige objetos cerrados con todas las propiedades
  // declaradas como obligatorias.
  if (salida.type === "object" && salida.properties) {
    salida.additionalProperties = false;
    salida.required = Object.keys(salida.properties as Json);
  }

  return salida;
}

export function esquemaJson(schema: z.ZodType): Json {
  return sanear(z.toJSONSchema(schema, { io: "output" })) as Json;
}

// ---------------------------------------------------------------------------
// Contenido: texto, imagen o documento
// ---------------------------------------------------------------------------

export type ParteContenido =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "document_url"; document_url: string };

const IMAGENES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

/** Documento nativo del OCR: el PDF completo o una sola imagen. */
function documentoOcr(base64: string, mimeType: string) {
  return mimeType === "application/pdf"
    ? { type: "document_url", document_url: `data:application/pdf;base64,${base64}` }
    : { type: "image_url", image_url: `data:${mimeType};base64,${base64}` };
}

interface RespuestaOcr {
  pages?: { index?: number; markdown?: string }[];
  message?: string;
}

/**
 * Transcribe un PDF o una imagen a texto con el OCR de Mistral. Devuelve el
 * markdown de todas las páginas concatenado: las tablas del extracto se
 * conservan como tablas, que es lo que después permite al modelo asociar cada
 * importe con su fecha y su concepto.
 */
export async function transcribir(base64: string, mimeType: string): Promise<string> {
  const ac = new AbortController();
  const temporizador = setTimeout(() => ac.abort(), 280_000);

  let respuesta: Response;
  try {
    respuesta = await fetch(BASE_OCR, {
      method: "POST",
      signal: ac.signal,
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        model: MODELO_OCR,
        document: documentoOcr(base64, mimeType),
      }),
    });
  } catch (e) {
    clearTimeout(temporizador);
    if (e instanceof Error && e.name === "AbortError") {
      throw new ErrorIA("La transcripción del documento excedió el tiempo máximo.");
    }
    throw new ErrorIA(
      `No se pudo contactar al servicio de OCR: ${e instanceof Error ? e.message : e}`,
    );
  }
  clearTimeout(temporizador);

  const cuerpo = (await respuesta.json().catch(() => null)) as RespuestaOcr | null;

  if (!respuesta.ok) {
    throw new ErrorIA(
      `El OCR respondió con error: ${cuerpo?.message ?? `HTTP ${respuesta.status}`}`,
    );
  }

  const texto = (cuerpo?.pages ?? [])
    .map((p) => p.markdown ?? "")
    .join("\n\n")
    .trim();

  if (!texto) throw new ErrorIA("El OCR no devolvió texto para este documento.");
  return texto;
}

/**
 * Convierte un archivo cargado en la parte de contenido correspondiente.
 *
 * Los PDF e imágenes pasan primero por el OCR y llegan al modelo como texto:
 * es más exacto con las cifras que la visión del modelo de chat, y más barato.
 * Si el OCR falla se entrega el archivo tal cual, para que un modelo con visión
 * pueda intentarlo igualmente en vez de perder el documento.
 */
export async function bloqueArchivo(
  base64: string,
  mimeType: string,
): Promise<ParteContenido> {
  const esImagen = IMAGENES.includes(mimeType);

  if (mimeType === "application/pdf" || esImagen) {
    try {
      return { type: "text", text: await transcribir(base64, mimeType) };
    } catch {
      return mimeType === "application/pdf"
        ? { type: "document_url", document_url: `data:application/pdf;base64,${base64}` }
        : { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64}` } };
    }
  }

  // XML de comprobantes electrónicos, CSV del banco, texto plano.
  return { type: "text", text: Buffer.from(base64, "base64").toString("utf-8") };
}

// ---------------------------------------------------------------------------
// Llamada tipada al modelo
// ---------------------------------------------------------------------------

export interface Uso {
  tokensEntrada: number;
  tokensSalida: number;
  duracionMs: number;
  modelo: string;
}

export interface Resultado<T> {
  datos: T;
  uso: Uso;
}

interface OpcionesLlamada<T extends z.ZodType> {
  sistema: string;
  contenido: ParteContenido[];
  esquema: T;
  maxTokens?: number;
  esfuerzo?: Esfuerzo;
}

interface RespuestaMistral {
  model?: string;
  choices?: {
    finish_reason?: string;
    message?: { content?: string };
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  message?: string;
}

/**
 * Ejecuta una consulta y devuelve la respuesta ya validada contra el esquema.
 */
export async function consultar<T extends z.ZodType>({
  sistema,
  contenido,
  esquema,
  maxTokens = 32000,
  esfuerzo = "high",
}: OpcionesLlamada<T>): Promise<Resultado<z.infer<T>>> {
  const inicio = Date.now();
  const modelo = modeloPara(esfuerzo);

  // Los documentos largos pueden tardar; el AbortController impide que una
  // petición colgada agote el tiempo de la ruta sin un error claro.
  const ac = new AbortController();
  const temporizador = setTimeout(() => ac.abort(), 280_000);

  let respuesta: Response;
  try {
    respuesta = await fetch(BASE, {
      method: "POST",
      signal: ac.signal,
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        model: modelo,
        max_tokens: maxTokens,
        messages: [
          { role: "system", content: sistema },
          { role: "user", content: contenido },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "resultado",
            strict: true,
            schema: esquemaJson(esquema),
          },
        },
      }),
    });
  } catch (e) {
    clearTimeout(temporizador);
    if (e instanceof Error && e.name === "AbortError") {
      throw new ErrorIA("La consulta al modelo excedió el tiempo máximo.");
    }
    throw new ErrorIA(
      `No se pudo contactar al servicio de IA: ${e instanceof Error ? e.message : e}`,
    );
  }
  clearTimeout(temporizador);

  const cuerpo = (await respuesta.json().catch(() => null)) as RespuestaMistral | null;

  if (!respuesta.ok) {
    const detalle = cuerpo?.message ?? `HTTP ${respuesta.status}`;
    if (respuesta.status === 429) {
      throw new ErrorIA("El servicio de IA está saturado. Reintenta en unos minutos.");
    }
    if (respuesta.status === 401) {
      throw new ErrorIA("La clave de Mistral es inválida o expiró.");
    }
    throw new ErrorIA(`El servicio de IA respondió con error: ${detalle}`);
  }

  const eleccion = cuerpo?.choices?.[0];
  if (eleccion?.finish_reason === "length") {
    throw new ErrorIA(
      "La respuesta se truncó por límite de tokens. Divide el documento en partes.",
      "length",
    );
  }

  const texto = eleccion?.message?.content;
  if (!texto) {
    throw new ErrorIA("El modelo no devolvió contenido.");
  }

  let crudo: unknown;
  try {
    crudo = JSON.parse(texto);
  } catch {
    throw new ErrorIA("El modelo devolvió un JSON inválido.");
  }

  const validado = esquema.safeParse(crudo);
  if (!validado.success) {
    throw new ErrorIA(
      `La respuesta no cumple el esquema: ${validado.error.issues
        .slice(0, 5)
        .map((i) => `${i.path.join(".")} ${i.message}`)
        .join("; ")}`,
    );
  }

  return {
    datos: validado.data,
    uso: {
      tokensEntrada: cuerpo?.usage?.prompt_tokens ?? 0,
      tokensSalida: cuerpo?.usage?.completion_tokens ?? 0,
      duracionMs: Date.now() - inicio,
      modelo: cuerpo?.model ?? modelo,
    },
  };
}

export class ErrorIA extends Error {
  // Campo declarado y asignado en el cuerpo, no como propiedad de parámetro:
  // así Node puede ejecutar este módulo quitando tipos, sin compilarlo, y las
  // pruebas corren sobre el mismo código que se despliega.
  readonly motivo?: string | null;

  constructor(message: string, motivo?: string | null) {
    super(message);
    this.name = "ErrorIA";
    this.motivo = motivo;
  }
}
