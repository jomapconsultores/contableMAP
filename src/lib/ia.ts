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

/** Modelo por defecto para extracción de documentos, donde importa la exactitud. */
export const MODELO = process.env.MISTRAL_MODEL ?? "mistral-large-latest";

function apiKey(): string {
  const k = process.env.MISTRAL_API_KEY;
  if (!k) throw new Error("Falta MISTRAL_API_KEY");
  return k;
}

/**
 * El esfuerzo se traduce a modelo: los trabajos sensibles (extracción de
 * dinero) van al modelo grande; la clasificación y la voz, de alto volumen, a
 * uno más económico.
 */
function modeloPara(esfuerzo: Esfuerzo): string {
  if (process.env.MISTRAL_MODEL) return process.env.MISTRAL_MODEL;
  return esfuerzo === "low" || esfuerzo === "medium"
    ? "mistral-medium-latest"
    : "mistral-large-latest";
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

/**
 * Convierte un archivo cargado en la parte de contenido correspondiente:
 * PDF → documento; imagen → imagen; texto/XML/CSV → texto plano.
 */
export function bloqueArchivo(base64: string, mimeType: string): ParteContenido {
  if (mimeType === "application/pdf") {
    return { type: "document_url", document_url: `data:application/pdf;base64,${base64}` };
  }
  if (IMAGENES.includes(mimeType)) {
    return { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64}` } };
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
  constructor(
    message: string,
    public readonly motivo?: string | null,
  ) {
    super(message);
    this.name = "ErrorIA";
  }
}
