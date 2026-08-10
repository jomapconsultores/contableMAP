import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

export const MODELO = process.env.ANTHROPIC_MODEL ?? "claude-opus-5";

let cliente: Anthropic | null = null;

export function anthropic() {
  if (!cliente) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("Falta ANTHROPIC_API_KEY");
    cliente = new Anthropic({ apiKey });
  }
  return cliente;
}

// ---------------------------------------------------------------------------
// JSON Schema para salidas estructuradas
// ---------------------------------------------------------------------------

/**
 * Palabras clave de JSON Schema que las salidas estructuradas no admiten.
 * Se eliminan del esquema enviado al modelo; la validación real la hace zod
 * sobre la respuesta, así que no se pierde ninguna garantía.
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

  // Las salidas estructuradas exigen objetos cerrados con todas las
  // propiedades declaradas como obligatorias.
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
  contenido: Anthropic.ContentBlockParam[];
  esquema: T;
  maxTokens?: number;
  esfuerzo?: "low" | "medium" | "high" | "xhigh" | "max";
}

/**
 * Ejecuta una consulta y devuelve la respuesta ya validada contra el esquema.
 * Se usa streaming siempre: las extracciones de estados de cuenta largos
 * superan con holgura el tiempo de espera de una petición sin stream.
 */
export async function consultar<T extends z.ZodType>({
  sistema,
  contenido,
  esquema,
  maxTokens = 32000,
  esfuerzo = "high",
}: OpcionesLlamada<T>): Promise<Resultado<z.infer<T>>> {
  const inicio = Date.now();

  const stream = anthropic().messages.stream({
    model: MODELO,
    max_tokens: maxTokens,
    system: [{ type: "text", text: sistema, cache_control: { type: "ephemeral" } }],
    thinking: { type: "adaptive" },
    output_config: {
      effort: esfuerzo,
      format: { type: "json_schema", schema: esquemaJson(esquema) },
    },
    messages: [{ role: "user", content: contenido }],
  } as Anthropic.MessageStreamParams);

  const mensaje = await stream.finalMessage();

  if (mensaje.stop_reason === "refusal") {
    throw new ErrorIA(
      "El modelo rechazó la solicitud por políticas de contenido.",
      mensaje.stop_reason,
    );
  }
  if (mensaje.stop_reason === "max_tokens") {
    throw new ErrorIA(
      "La respuesta se truncó por límite de tokens. Divide el documento en partes.",
      mensaje.stop_reason,
    );
  }

  const texto = mensaje.content.find((b) => b.type === "text");
  if (!texto || texto.type !== "text") {
    throw new ErrorIA("El modelo no devolvió contenido de texto.", mensaje.stop_reason);
  }

  let crudo: unknown;
  try {
    crudo = JSON.parse(texto.text);
  } catch {
    throw new ErrorIA("El modelo devolvió un JSON inválido.", mensaje.stop_reason);
  }

  const validado = esquema.safeParse(crudo);
  if (!validado.success) {
    throw new ErrorIA(
      `La respuesta no cumple el esquema: ${validado.error.issues
        .slice(0, 5)
        .map((i) => `${i.path.join(".")} ${i.message}`)
        .join("; ")}`,
      mensaje.stop_reason,
    );
  }

  return {
    datos: validado.data,
    uso: {
      tokensEntrada: mensaje.usage.input_tokens,
      tokensSalida: mensaje.usage.output_tokens,
      duracionMs: Date.now() - inicio,
      modelo: mensaje.model,
    },
  };
}

export class ErrorIA extends Error {
  constructor(
    message: string,
    public readonly stopReason?: string | null,
  ) {
    super(message);
    this.name = "ErrorIA";
  }
}

// ---------------------------------------------------------------------------
// Construcción del bloque de contenido para un archivo
// ---------------------------------------------------------------------------

const IMAGENES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
type MediaImagen = (typeof IMAGENES)[number];

/**
 * Convierte un archivo cargado en el bloque de contenido correspondiente.
 * PDF → documento; imagen → imagen; texto/XML/CSV → texto plano.
 */
export function bloqueArchivo(
  base64: string,
  mimeType: string,
): Anthropic.ContentBlockParam {
  if (mimeType === "application/pdf") {
    return {
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: base64 },
    };
  }

  if ((IMAGENES as readonly string[]).includes(mimeType)) {
    return {
      type: "image",
      source: { type: "base64", media_type: mimeType as MediaImagen, data: base64 },
    };
  }

  // XML de comprobantes electrónicos, CSV exportado del banco, texto plano.
  return {
    type: "text",
    text: Buffer.from(base64, "base64").toString("utf-8"),
  };
}
