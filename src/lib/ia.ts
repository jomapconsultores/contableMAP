import { execFile } from "node:child_process";
import http from "node:http";
import https from "node:https";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";

/**
 * Capa de IA. Todo el acoplamiento con el proveedor vive aquí: el resto del
 * sistema (esquemas, prompts, extracción, clasificación, rutas) solo conoce
 * `consultar`, `bloqueArchivo` y los tipos de resultado.
 *
 * Proveedor: Ollama, en el ThinkPad de la malla Tailscale (96 GB de RAM y una
 * RTX 500). Un solo modelo con visión hace las dos cosas —transcribir las
 * páginas escaneadas y estructurar el texto—, así que no hay que cargar y
 * descargar modelos entre un paso y otro.
 *
 * Se eligió gemma4:26b porque, sobre un PacifiCard escaneado, leyó todas las
 * cifras exactas —sus consumos suman los 251,92 que imprime el extracto— donde
 * el OCR anterior había confundido ochos con cincos. El precio es la
 * velocidad: unos 11 tokens por segundo y tres o cuatro minutos por página
 * escaneada. Por eso los documentos se procesan en segundo plano.
 */

const BASE = (process.env.OLLAMA_URL ?? "http://100.78.16.15:11434").replace(/\/$/, "");

/** Modelo para estructurar, clasificar e interpretar la voz. */
export const MODELO = process.env.OLLAMA_MODEL ?? "gemma4:26b";

/** Modelo que transcribe las páginas escaneadas. Debe admitir imágenes. */
const MODELO_VISION = process.env.OLLAMA_VISION_MODEL ?? MODELO;

/**
 * Ventana de contexto. El texto de un estado de cuenta de varias páginas más
 * su JSON de salida caben de sobra; el ThinkPad tiene memoria para ello.
 */
const CONTEXTO = Number(process.env.OLLAMA_NUM_CTX ?? 32768);

/**
 * Tiempo máximo de una llamada. En CPU un documento largo puede tardar
 * minutos; esto solo corta lo que se ha quedado colgado.
 */
const TIEMPO_MAXIMO_MS = 30 * 60_000;

/** El modelo sigue cargado entre documentos de una misma tanda. */
const MANTENER_CARGADO = "30m";

// ---------------------------------------------------------------------------
// JSON Schema para salidas estructuradas
// ---------------------------------------------------------------------------

/**
 * Palabras clave que la gramática de Ollama no aplica. Se eliminan del esquema
 * enviado al modelo; la validación real la hace zod sobre la respuesta, así
 * que no se pierde ninguna garantía.
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

  // Objetos cerrados y con todas sus propiedades obligatorias: así la
  // gramática obliga al modelo a devolver cada campo, aunque sea null.
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
// Contenido: texto o imagen
// ---------------------------------------------------------------------------

export type ParteContenido =
  | { type: "text"; text: string }
  | { type: "image"; base64: string };

const IMAGENES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

const ejecutar = promisify(execFile);

/**
 * Por debajo de esto, el texto incrustado del PDF no es un extracto sino una
 * cáscara —un pie de página, un número de hoja— sobre páginas escaneadas.
 */
const MIN_IMPORTES_TEXTO = 5;

const PROMPT_TRANSCRIPCION =
  "Transcribe esta página de un documento financiero a markdown. " +
  "Reproduce cada tabla como tabla markdown, fila por fila, con todas sus columnas " +
  "(fecha, referencia, concepto, valores, signos). Copia cada cifra exactamente como " +
  "aparece, con sus separadores. Nunca omitas una fila ni un importe. Solo los " +
  "párrafos de texto legal o publicitario puedes reducirlos a una línea.";

/**
 * Transcribe un PDF o una imagen a texto.
 *
 * Si el PDF trae capa de texto se usa tal cual: son las cifras que escribió el
 * banco, sin lectura de por medio, y no cuesta nada. Solo las páginas
 * escaneadas pasan por la visión del modelo, una a una, a 150 ppp.
 */
export async function transcribir(base64: string, mimeType: string): Promise<string> {
  if (IMAGENES.includes(mimeType)) return leerImagen(base64);

  const dir = await mkdtemp(path.join(tmpdir(), "ia-"));
  try {
    const pdf = path.join(dir, "doc.pdf");
    await writeFile(pdf, Buffer.from(base64, "base64"));

    const texto = await textoIncrustado(pdf);
    if (texto) return texto;

    await ejecutar("pdftoppm", ["-r", "150", "-png", pdf, path.join(dir, "p")]);
    const paginas = (await readdir(dir)).filter((f) => f.endsWith(".png")).sort();
    if (paginas.length === 0) throw new ErrorIA("No se pudo convertir el PDF en imágenes.");

    const partes: string[] = [];
    for (const [i, pagina] of paginas.entries()) {
      const img = (await readFile(path.join(dir, pagina))).toString("base64");
      partes.push(`<!-- Página ${i + 1} de ${paginas.length} -->\n${await leerImagen(img)}`);
    }
    return partes.join("\n\n");
  } catch (e) {
    if (e instanceof ErrorIA) throw e;
    throw new ErrorIA(`No se pudo leer el PDF: ${e instanceof Error ? e.message : e}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function textoIncrustado(pdf: string): Promise<string | null> {
  try {
    const { stdout } = await ejecutar("pdftotext", ["-layout", pdf, "-"], {
      maxBuffer: 20 * 1024 * 1024,
    });
    const importes = stdout.match(/\d[\d.,]*[.,]\d{2}\b/g)?.length ?? 0;
    return importes >= MIN_IMPORTES_TEXTO ? stdout.trim() : null;
  } catch {
    return null;
  }
}

async function leerImagen(base64: string): Promise<string> {
  const { texto } = await chat({
    modelo: MODELO_VISION,
    mensajes: [{ role: "user", content: PROMPT_TRANSCRIPCION, images: [base64] }],
    maxTokens: 8000,
  });
  if (!texto.trim()) throw new ErrorIA("El modelo no devolvió texto para una página.");
  return texto.trim();
}

/**
 * Convierte un archivo cargado en la parte de contenido correspondiente.
 *
 * Los PDF e imágenes llegan al modelo como texto ya transcrito: la extracción
 * trabaja sobre cifras leídas una sola vez, y el prompt puede pedirle que las
 * cuadre contra los totales impresos.
 */
export async function bloqueArchivo(
  base64: string,
  mimeType: string,
): Promise<ParteContenido> {
  if (mimeType === "application/pdf" || IMAGENES.includes(mimeType)) {
    return { type: "text", text: await transcribir(base64, mimeType) };
  }

  // XML de comprobantes electrónicos, CSV del banco, texto plano.
  return { type: "text", text: Buffer.from(base64, "base64").toString("utf-8") };
}

// ---------------------------------------------------------------------------
// Llamada al modelo
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

interface Mensaje {
  role: "system" | "user";
  content: string;
  images?: string[];
}

interface Fragmento {
  model?: string;
  message?: { content?: string };
  done?: boolean;
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
  error?: string;
}

/**
 * POST que devuelve la respuesta sin límite de espera para las cabeceras.
 *
 * El fetch de Node corta a los cinco minutos si el servidor no ha empezado a
 * responder. Ollama atiende una petición a la vez: si el ThinkPad está ocupado
 * con otra —otro programa usando otro modelo— la nuestra espera en cola sin
 * recibir nada, y el fetch la daba por perdida. node:http no tiene ese
 * límite; el único tope es el AbortSignal de quien llama.
 */
function postear(url: string, cuerpo: string, signal: AbortSignal): Promise<http.IncomingMessage> {
  return new Promise((resolver, rechazar) => {
    const u = new URL(url);
    const cliente = u.protocol === "https:" ? https : http;
    const pet = cliente.request(
      u,
      {
        method: "POST",
        signal,
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(cuerpo) },
      },
      resolver,
    );
    pet.on("error", rechazar);
    pet.end(cuerpo);
  });
}

/**
 * Llamada a /api/chat en modo streaming. No es por mostrar el avance: sin
 * streaming Ollama no envía nada hasta terminar, y una respuesta larga podía
 * pasarse de cualquier tiempo de espera. Con streaming cada token mantiene
 * viva la conexión.
 */
async function chat({
  modelo,
  mensajes,
  maxTokens,
  formato,
}: {
  modelo: string;
  mensajes: Mensaje[];
  maxTokens: number;
  formato?: Json;
}): Promise<{ texto: string; uso: Uso }> {
  const inicio = Date.now();
  const ac = new AbortController();
  const temporizador = setTimeout(() => ac.abort(), TIEMPO_MAXIMO_MS);

  try {
    let respuesta: http.IncomingMessage;
    try {
      respuesta = await postear(
        `${BASE}/api/chat`,
        JSON.stringify({
          model: modelo,
          messages: mensajes,
          stream: true,
          think: false,
          keep_alive: MANTENER_CARGADO,
          ...(formato ? { format: formato } : {}),
          options: {
            temperature: 0,
            num_ctx: CONTEXTO,
            num_predict: Math.min(maxTokens, CONTEXTO),
          },
        }),
        ac.signal,
      );
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") throw e;
      throw new ErrorIA(
        `El servidor de IA (Ollama en ${new URL(BASE).host}) no responde. ` +
          `Revisa que el equipo esté encendido y conectado a Tailscale. ` +
          `(${e instanceof Error ? (e.cause as Error | undefined)?.message ?? e.message : e})`,
      );
    }

    const estado = respuesta.statusCode ?? 0;
    if (estado < 200 || estado >= 300) {
      let detalle = "";
      for await (const trozo of respuesta) detalle += trozo;
      if (estado === 404) {
        throw new ErrorIA(
          `El modelo ${modelo} no está instalado en Ollama. Descárgalo con «ollama pull ${modelo}».`,
        );
      }
      throw new ErrorIA(`Ollama respondió con error ${estado}: ${detalle.slice(0, 300)}`);
    }

    let texto = "";
    let final: Fragmento | null = null;
    let resto = "";
    const decodificador = new TextDecoder();

    for await (const trozo of respuesta) {
      resto += decodificador.decode(trozo as Buffer, { stream: true });
      const lineas = resto.split("\n");
      resto = lineas.pop() ?? "";
      for (const linea of lineas) {
        if (!linea.trim()) continue;
        const f = JSON.parse(linea) as Fragmento;
        if (f.error) throw new ErrorIA(`Ollama: ${f.error}`);
        texto += f.message?.content ?? "";
        if (f.done) final = f;
      }
    }

    if (final?.done_reason === "length") {
      throw new ErrorIA(
        "La respuesta se truncó por límite de tokens. Divide el documento en partes.",
        "length",
      );
    }

    return {
      texto,
      uso: {
        tokensEntrada: final?.prompt_eval_count ?? 0,
        tokensSalida: final?.eval_count ?? 0,
        duracionMs: Date.now() - inicio,
        modelo: final?.model ?? modelo,
      },
    };
  } catch (e) {
    if (e instanceof ErrorIA) throw e;
    if (e instanceof Error && e.name === "AbortError") {
      throw new ErrorIA("La consulta al modelo excedió el tiempo máximo.");
    }
    throw new ErrorIA(`Fallo en la consulta al modelo: ${e instanceof Error ? e.message : e}`);
  } finally {
    clearTimeout(temporizador);
  }
}

interface OpcionesLlamada<T extends z.ZodType> {
  sistema: string;
  contenido: ParteContenido[];
  esquema: T;
  maxTokens?: number;
}

/**
 * Ejecuta una consulta y devuelve la respuesta ya validada contra el esquema.
 * La gramática de Ollama obliga a que la salida sea JSON con la forma del
 * esquema; zod comprueba después lo que la gramática no puede (rangos, tipos
 * finos).
 */
export async function consultar<T extends z.ZodType>({
  sistema,
  contenido,
  esquema,
  maxTokens = 16000,
}: OpcionesLlamada<T>): Promise<Resultado<z.infer<T>>> {
  const texto = contenido
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("\n\n");
  const imagenes = contenido
    .filter((p): p is { type: "image"; base64: string } => p.type === "image")
    .map((p) => p.base64);

  const { texto: salida, uso } = await chat({
    modelo: imagenes.length ? MODELO_VISION : MODELO,
    mensajes: [
      { role: "system", content: sistema },
      { role: "user", content: texto, ...(imagenes.length ? { images: imagenes } : {}) },
    ],
    maxTokens,
    formato: esquemaJson(esquema),
  });

  if (!salida.trim()) throw new ErrorIA("El modelo no devolvió contenido.");

  let crudo: unknown;
  try {
    crudo = JSON.parse(salida);
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

  return { datos: validado.data, uso };
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
