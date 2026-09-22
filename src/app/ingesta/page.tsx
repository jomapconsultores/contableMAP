"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { CloudUpload, FileText, LoaderCircle, Mic, Sparkles, Square, X } from "lucide-react";
import { usd } from "@/lib/formato";
import {
  Aviso,
  Encabezado,
  Insignia,
  Tarjeta,
  boton,
  campo,
  etiqueta,
  type Tono,
} from "@/components/ui";

/* -------------------------------------------------------------------------
   Reconocimiento de voz del navegador. Solo se usa para transcribir; la
   interpretación contable la hace el modelo en el servidor.
   ------------------------------------------------------------------------- */

interface ResultadoVoz {
  isFinal: boolean;
  0: { transcript: string };
}
interface EventoVoz {
  resultIndex: number;
  results: { length: number; [i: number]: ResultadoVoz };
}
interface Reconocedor {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: EventoVoz) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}
type ConstructorVoz = new () => Reconocedor;

function obtenerReconocedor(): ConstructorVoz | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: ConstructorVoz;
    webkitSpeechRecognition?: ConstructorVoz;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * Que el navegador traiga o no reconocedor no cambia mientras la página vive,
 * así que la suscripción no tiene a qué avisar. En el servidor se asume que sí
 * lo hay para que el marcado inicial coincida con el de la hidratación; el
 * valor real se lee en cuanto el componente monta en el cliente.
 */
const SIN_CAMBIOS = () => () => {};
const HAY_RECONOCEDOR = () => obtenerReconocedor() !== null;
const HAY_RECONOCEDOR_EN_SERVIDOR = () => true;

interface Propuesta {
  operacion: string;
  fecha: string | null;
  descripcion: string;
  contraparte: string | null;
  monto_total: number | null;
  base_imponible: number | null;
  iva: number | null;
  categoria: string | null;
  cuenta_financiera: string | null;
  a_credito: boolean;
  confianza: number;
  faltantes: string[];
  interpretacion: string;
}

export default function Ingesta() {
  return (
    <div className="space-y-6">
      <Encabezado
        titulo="Ingresar datos"
        descripcion="Dicta un movimiento o carga un documento. En ambos casos se te muestra lo que se entendió antes de registrar nada."
      />
      <PorVoz />
      <PorDocumento />
    </div>
  );
}

/* ------------------------------- Voz ------------------------------------ */

function PorVoz() {
  const [texto, setTexto] = useState("");
  const [escuchando, setEscuchando] = useState(false);
  const soportado = useSyncExternalStore(
    SIN_CAMBIOS,
    HAY_RECONOCEDOR,
    HAY_RECONOCEDOR_EN_SERVIDOR,
  );
  const [propuesta, setPropuesta] = useState<Propuesta | null>(null);
  const [estado, setEstado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const reconocedor = useRef<Reconocedor | null>(null);

  // Al salir de la página se corta la escucha, si quedó abierta.
  useEffect(() => () => reconocedor.current?.stop(), []);

  const alternarEscucha = useCallback(() => {
    if (escuchando) {
      reconocedor.current?.stop();
      setEscuchando(false);
      return;
    }

    const Ctor = obtenerReconocedor();
    if (!Ctor) return;

    const r = new Ctor();
    r.lang = "es-EC";
    r.continuous = true;
    r.interimResults = false;

    r.onresult = (e) => {
      let nuevo = "";
      for (let i = e.resultIndex; i < e.results.length; i += 1) {
        if (e.results[i].isFinal) nuevo += e.results[i][0].transcript;
      }
      if (nuevo) setTexto((t) => (t ? `${t} ${nuevo.trim()}` : nuevo.trim()));
    };
    r.onerror = (e) => {
      setError(
        e.error === "not-allowed"
          ? "El navegador bloqueó el micrófono. Habilítalo y vuelve a intentar."
          : `Error de reconocimiento: ${e.error}`,
      );
      setEscuchando(false);
    };
    r.onend = () => setEscuchando(false);

    reconocedor.current = r;
    setError(null);
    r.start();
    setEscuchando(true);
  }, [escuchando]);

  async function enviar(registrar: boolean) {
    setOcupado(true);
    setError(null);
    setEstado(null);
    try {
      const res = await fetch("/api/voz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texto, registrar }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error);

      setPropuesta(json.datos.propuesta);
      if (json.datos.registrado) {
        setEstado(
          `Registrado y contabilizado como ${json.datos.registrado.tipo.toLowerCase()}.`,
        );
        setTexto("");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error inesperado");
    } finally {
      setOcupado(false);
    }
  }

  const textoValido = texto.trim().length >= 3;

  return (
    <Tarjeta
      id="voz"
      titulo="Por voz o texto"
      descripcion="Por ejemplo: «pagué ciento veinte dólares de gasolina en Primax con la tarjeta del Pichincha»."
    >
      <div className="space-y-4">
        <div>
          <label htmlFor="texto-voz" className={etiqueta}>
            Movimiento
          </label>
          <textarea
            id="texto-voz"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            rows={3}
            placeholder="Dicta o escribe aquí…"
            className={`${campo} resize-y ${
              escuchando ? "border-rose-400 ring-2 ring-rose-500/20" : ""
            }`}
          />
          {escuchando && (
            <p className="mt-1.5 flex items-center gap-1.5 text-xs font-medium text-rose-700">
              <span className="h-2 w-2 animate-pulse rounded-full bg-rose-600" />
              Escuchando… pulsa «Detener» al terminar.
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {soportado ? (
            <button
              onClick={alternarEscucha}
              aria-pressed={escuchando}
              className={boton(escuchando ? "peligro" : "secundario")}
            >
              {escuchando ? <Square size={14} fill="currentColor" /> : <Mic size={16} />}
              {escuchando ? "Detener" : "Dictar"}
            </button>
          ) : (
            <span className="text-xs text-slate-500">
              Este navegador no reconoce voz; escribe el texto.
            </span>
          )}

          <div className="ml-auto flex flex-wrap items-center gap-2">
            {texto && (
              <button
                onClick={() => {
                  setTexto("");
                  setPropuesta(null);
                  setEstado(null);
                }}
                className={boton("fantasma")}
              >
                Limpiar
              </button>
            )}

            <button
              onClick={() => enviar(false)}
              disabled={ocupado || !textoValido}
              className={boton("secundario")}
            >
              <Sparkles size={16} />
              Interpretar
            </button>

            <button
              onClick={() => enviar(true)}
              disabled={ocupado || !textoValido}
              className={boton("primario")}
            >
              Registrar y contabilizar
            </button>
          </div>
        </div>

        {ocupado && (
          <p className="flex items-center gap-2 text-sm text-slate-500">
            <LoaderCircle size={16} className="animate-spin" />
            Interpretando…
          </p>
        )}
        {error && <Aviso tono="peligro">{error}</Aviso>}
        {estado && <Aviso tono="exito">{estado}</Aviso>}

        {propuesta && (
          <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-4 text-sm">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold text-slate-900">{propuesta.operacion}</span>
              <Insignia tono={tonoConfianza(propuesta.confianza)}>
                confianza {(propuesta.confianza * 100).toFixed(0)} %
              </Insignia>
            </div>
            <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
              <Dato k="Descripción" v={propuesta.descripcion} />
              <Dato k="Contraparte" v={propuesta.contraparte} />
              <Dato k="Fecha" v={propuesta.fecha ?? "hoy"} />
              <Dato k="Total" v={propuesta.monto_total ? usd(propuesta.monto_total) : null} />
              <Dato k="Base" v={propuesta.base_imponible ? usd(propuesta.base_imponible) : null} />
              <Dato k="IVA" v={propuesta.iva ? usd(propuesta.iva) : null} />
              <Dato k="Categoría" v={propuesta.categoria} />
              <Dato k="Cuenta" v={propuesta.cuenta_financiera} />
            </dl>
            <p className="mt-3 border-t border-slate-200 pt-3 text-xs text-slate-600">
              {propuesta.interpretacion}
            </p>
            {propuesta.faltantes.length > 0 && (
              <div className="mt-3">
                <Aviso tono="aviso">Falta: {propuesta.faltantes.join("; ")}</Aviso>
              </div>
            )}
          </div>
        )}
      </div>
    </Tarjeta>
  );
}

/** Color de la confianza de la IA: alta, media o baja. */
function tonoConfianza(c: number): Tono {
  if (c >= 0.8) return "exito";
  if (c >= 0.5) return "aviso";
  return "peligro";
}

function Dato({ k, v }: { k: string; v: string | null }) {
  return (
    <div className="flex min-w-0 items-baseline gap-2">
      <dt className="shrink-0 text-xs text-slate-500">{k}</dt>
      <dd className="min-w-0 truncate font-medium text-slate-900">{v ?? "—"}</dd>
    </div>
  );
}

/* ---------------------------- Documentos -------------------------------- */

interface CuentaFinanciera {
  id: string;
  nombre: string;
  tipo: string;
}

const TIPOS_DOC = [
  { valor: "ESTADO_TARJETA", texto: "Estado de cuenta · tarjeta de crédito" },
  { valor: "ESTADO_BANCO", texto: "Estado de cuenta · banco" },
  { valor: "ESTADO_COOPERATIVA", texto: "Estado de cuenta · cooperativa" },
  { valor: "FACTURA_COMPRA", texto: "Factura recibida (compra)" },
  { valor: "FACTURA_VENTA", texto: "Factura emitida (venta)" },
  { valor: "ROL_PAGO", texto: "Rol de pago" },
];

const EXT_OK = ["pdf", "png", "jpg", "jpeg", "webp", "gif", "xml", "csv", "txt"];

type EstadoItem =
  | "pendiente"
  | "subiendo"
  | "procesando"
  | "listo"
  | "duplicado"
  | "error";

interface ItemCarga {
  id: string;
  file: File;
  estado: EstadoItem;
  mensaje: string;
  /** Avisos de la extracción: totales que no cuadran, cifras dudosas. */
  observaciones?: string[];
}

const ETIQUETA_ESTADO: Record<EstadoItem, string> = {
  pendiente: "en cola",
  subiendo: "subiendo…",
  procesando: "procesando (puede tardar minutos)…",
  listo: "listo",
  duplicado: "ya subido",
  error: "error",
};

const TONO_ESTADO: Record<EstadoItem, Tono> = {
  pendiente: "neutro",
  subiendo: "info",
  procesando: "info",
  listo: "exito",
  duplicado: "aviso",
  error: "peligro",
};

function PorDocumento() {
  const [tipo, setTipo] = useState(TIPOS_DOC[0].valor);
  const [cuentaId, setCuentaId] = useState(""); // "" = que la IA la detecte
  const [cuentas, setCuentas] = useState<CuentaFinanciera[]>([]);
  const [items, setItems] = useState<ItemCarga[]>([]);
  const [arrastrando, setArrastrando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const esExtracto = tipo.startsWith("ESTADO_");
  const pendientes = items.filter((i) => i.estado === "pendiente" || i.estado === "error").length;

  useEffect(() => {
    fetch("/api/cuentas")
      .then((r) => r.json())
      .then((j) => j.ok && setCuentas(j.datos))
      .catch(() => undefined);
  }, []);

  /** Añade archivos a la cola validando su formato; avisa de los rechazados. */
  function agregar(lista: FileList | File[] | null | undefined) {
    if (!lista) return;
    const nuevos: ItemCarga[] = [];
    const rechazados: string[] = [];

    for (const f of Array.from(lista)) {
      const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
      if (EXT_OK.includes(ext)) {
        nuevos.push({ id: crypto.randomUUID(), file: f, estado: "pendiente", mensaje: "" });
      } else {
        rechazados.push(f.name);
      }
    }

    if (nuevos.length) setItems((prev) => [...prev, ...nuevos]);
    setError(
      rechazados.length
        ? `Formato no admitido: ${rechazados.join(", ")}. Solo PDF, imagen, XML o CSV.`
        : null,
    );
  }

  function actualizar(id: string, patch: Partial<ItemCarga>) {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  }

  function quitar(id: string) {
    setItems((prev) => prev.filter((i) => i.id !== id));
  }

  function alSoltar(e: React.DragEvent) {
    e.preventDefault();
    setArrastrando(false);
    agregar(e.dataTransfer.files);
  }

  /** Sube y procesa cada documento en secuencia; un fallo no detiene al resto. */
  async function procesarTodo() {
    setOcupado(true);
    setError(null);

    // Se congela la lista de objetivos al inicio: lo pendiente o lo que quedó
    // en error de una tanda anterior.
    const objetivos = items.filter((i) => i.estado === "pendiente" || i.estado === "error");

    for (const item of objetivos) {
      try {
        actualizar(item.id, { estado: "subiendo", mensaje: "" });

        const form = new FormData();
        form.append("archivo", item.file);
        form.append("tipo", tipo);
        if (cuentaId) form.append("cuenta_id", cuentaId);

        const subida = await fetch("/api/documentos", { method: "POST", body: form });
        const jsonSubida = await subida.json();
        if (!jsonSubida.ok) throw new Error(jsonSubida.error);

        // El mismo archivo ya se subió antes: no se procesa de nuevo.
        if (jsonSubida.datos.duplicado) {
          actualizar(item.id, { estado: "duplicado", mensaje: jsonSubida.datos.mensaje });
          continue;
        }

        actualizar(item.id, { estado: "procesando" });

        const docId = jsonSubida.datos.id as string;
        const proceso = await fetch(`/api/documentos/${docId}/procesar`, { method: "POST" });
        const jsonProceso = await proceso.json();
        if (!jsonProceso.ok) throw new Error(jsonProceso.error);

        const fin = await esperarProceso(docId, (resumen) =>
          actualizar(item.id, { mensaje: resumen }),
        );
        if (fin.estado === "ERROR") throw new Error(fin.error ?? "Error al procesar");

        // Archivo distinto pero con movimientos ya cargados.
        actualizar(item.id, {
          estado: fin.duplicado ? "duplicado" : "listo",
          mensaje: fin.resumen ?? "",
          observaciones: fin.observaciones ?? [],
        });
      } catch (e) {
        actualizar(item.id, {
          estado: "error",
          mensaje: e instanceof Error ? e.message : "Error inesperado",
        });
      }
    }

    setOcupado(false);
  }

  const hayResueltos = items.some((i) => i.estado === "listo" || i.estado === "duplicado");

  return (
    <Tarjeta
      id="documento"
      titulo="Por documento"
      descripcion="PDF, imagen, XML o CSV. Puedes soltar varios estados de cuenta a la vez: se procesan uno tras otro y cada uno se clasifica en el momento."
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="tipo-doc" className={etiqueta}>
              Tipo de documento
            </label>
            <select
              id="tipo-doc"
              value={tipo}
              onChange={(e) => setTipo(e.target.value)}
              disabled={ocupado}
              className={campo}
            >
              {TIPOS_DOC.map((t) => (
                <option key={t.valor} value={t.valor}>
                  {t.texto}
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-xs text-slate-400">
              Se aplica a todos los documentos de la tanda.
            </p>
          </div>

          {esExtracto && (
            <div>
              <label htmlFor="cuenta-doc" className={etiqueta}>
                Cuenta financiera
              </label>
              <select
                id="cuenta-doc"
                value={cuentaId}
                onChange={(e) => setCuentaId(e.target.value)}
                disabled={ocupado}
                className={campo}
              >
                <option value="">Detectar automáticamente (IA)</option>
                {cuentas.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nombre} · {c.tipo}
                  </option>
                ))}
              </select>
              <p className="mt-1.5 text-xs text-slate-400">
                Con detección automática, cada estado de cuenta se asigna a su
                cuenta por separado según lo que lea la IA.
              </p>
            </div>
          )}
        </div>

        {/* Zona de arrastrar y soltar (varios archivos), también clicable */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            if (!ocupado) setArrastrando(true);
          }}
          onDragLeave={() => setArrastrando(false)}
          onDrop={(e) => !ocupado && alSoltar(e)}
          onClick={() => !ocupado && inputRef.current?.click()}
          role="button"
          tabIndex={0}
          aria-disabled={ocupado}
          onKeyDown={(e) =>
            !ocupado && (e.key === "Enter" || e.key === " ") && inputRef.current?.click()
          }
          className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-10 text-center transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 ${
            ocupado ? "cursor-not-allowed opacity-60" : "cursor-pointer"
          } ${
            arrastrando
              ? "border-emerald-500 bg-emerald-50"
              : "border-slate-300 bg-slate-50/60 hover:border-emerald-400 hover:bg-emerald-50/40"
          }`}
        >
          <span
            className={`mb-3 rounded-full p-3 ${
              arrastrando
                ? "bg-emerald-100 text-emerald-700"
                : "bg-white text-emerald-600 shadow-sm ring-1 ring-slate-200"
            }`}
          >
            <CloudUpload size={24} />
          </span>
          <span className="text-sm font-medium text-slate-700">
            {arrastrando ? (
              "Suelta los documentos aquí"
            ) : (
              <>
                Arrastra uno o varios documentos aquí o{" "}
                <span className="text-emerald-700 underline underline-offset-2">
                  haz clic para elegirlos
                </span>
              </>
            )}
          </span>
          <span className="mt-1 text-xs text-slate-400">PDF, imagen, XML o CSV</span>
        </div>

        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.xml,.csv,.txt"
          onChange={(e) => {
            agregar(e.target.files);
            e.target.value = ""; // permite volver a elegir el mismo archivo
          }}
          className="hidden"
        />

        {error && <Aviso tono="peligro">{error}</Aviso>}

        {items.length > 0 && (
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200">
            {items.map((it) => (
              <li key={it.id} className="flex items-start gap-3 px-4 py-3 text-sm">
                <span className="mt-0.5 shrink-0 rounded-md bg-slate-100 p-1.5 text-slate-500">
                  <FileText size={16} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium text-slate-900">{it.file.name}</span>
                    <span className="shrink-0 text-xs tabular-nums text-slate-400">
                      {(it.file.size / 1024).toFixed(0)} KB
                    </span>
                  </div>
                  {it.mensaje && (
                    <div
                      className={`mt-0.5 text-xs ${
                        it.estado === "error" ? "text-rose-700" : "text-slate-500"
                      }`}
                    >
                      {it.mensaje}
                    </div>
                  )}
                  {it.observaciones && it.observaciones.length > 0 && (
                    <ul className="mt-1.5 space-y-0.5 border-l-2 border-amber-300 pl-2 text-xs text-amber-800">
                      {it.observaciones.map((o, i) => (
                        <li key={i}>{o}</li>
                      ))}
                    </ul>
                  )}
                </div>
                <EstadoBadge estado={it.estado} />
                {!ocupado && it.estado !== "procesando" && it.estado !== "subiendo" && (
                  <button
                    onClick={() => quitar(it.id)}
                    className="-mr-1 shrink-0 rounded-md p-1 text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600"
                    aria-label="Quitar"
                    title="Quitar"
                  >
                    <X size={14} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={procesarTodo}
            disabled={ocupado || pendientes === 0}
            className={boton("primario")}
          >
            {ocupado && <LoaderCircle size={16} className="animate-spin" />}
            {ocupado
              ? "Procesando…"
              : pendientes > 1
                ? `Subir y procesar ${pendientes} documentos`
                : "Subir y procesar"}
          </button>

          {hayResueltos && !ocupado && (
            <button
              onClick={() =>
                setItems((prev) =>
                  prev.filter((i) => i.estado !== "listo" && i.estado !== "duplicado"),
                )
              }
              className={boton("fantasma")}
            >
              Quitar los ya procesados
            </button>
          )}
          {items.length > 0 && !ocupado && (
            <button onClick={() => setItems([])} className={boton("fantasma")}>
              Limpiar todo
            </button>
          )}
        </div>
      </div>
    </Tarjeta>
  );
}

interface EstadoDocumento {
  estado: string;
  resumen: string | null;
  error: string | null;
  observaciones?: string[];
  duplicado: boolean;
  huerfano: boolean;
}

/**
 * La IA corre en local y un documento escaneado tarda minutos, así que el
 * servidor lo procesa en segundo plano y aquí se consulta su estado hasta que
 * termina. Si el servidor se reinició a mitad, se vuelve a encolar.
 */
async function esperarProceso(
  id: string,
  avance: (resumen: string) => void,
): Promise<EstadoDocumento> {
  for (;;) {
    await new Promise((r) => setTimeout(r, 5000));
    const r = await fetch(`/api/documentos/${id}`).then((x) => x.json());
    if (!r.ok) throw new Error(r.error);
    const doc = r.datos as EstadoDocumento;
    if (doc.estado !== "PROCESANDO") return doc;
    if (doc.huerfano) {
      await fetch(`/api/documentos/${id}/procesar`, { method: "POST" });
    }
    if (doc.resumen) avance(doc.resumen);
  }
}

function EstadoBadge({ estado }: { estado: EstadoItem }) {
  const enCurso = estado === "subiendo" || estado === "procesando";
  return (
    <span className="shrink-0">
      <Insignia tono={TONO_ESTADO[estado]}>
        {enCurso && <LoaderCircle size={12} className="animate-spin" />}
        {ETIQUETA_ESTADO[estado]}
      </Insignia>
    </span>
  );
}
