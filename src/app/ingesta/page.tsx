"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usd } from "@/lib/formato";

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
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Ingresar datos</h1>
        <p className="mt-1 text-sm text-slate-600">
          Dicta un movimiento o carga un documento. En ambos casos se te muestra
          lo que se entendió antes de registrar nada.
        </p>
      </div>
      <PorVoz />
      <PorDocumento />
    </div>
  );
}

/* ------------------------------- Voz ------------------------------------ */

function PorVoz() {
  const [texto, setTexto] = useState("");
  const [escuchando, setEscuchando] = useState(false);
  const [soportado, setSoportado] = useState(true);
  const [propuesta, setPropuesta] = useState<Propuesta | null>(null);
  const [estado, setEstado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const reconocedor = useRef<Reconocedor | null>(null);

  useEffect(() => {
    setSoportado(obtenerReconocedor() !== null);
    return () => reconocedor.current?.stop();
  }, []);

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

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5">
      <h2 className="font-medium">Por voz o texto</h2>
      <p className="mt-1 text-sm text-slate-500">
        Por ejemplo: «pagué ciento veinte dólares de gasolina en Primax con la
        tarjeta del Pichincha».
      </p>

      <textarea
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        rows={3}
        placeholder="Dicta o escribe aquí…"
        className="mt-3 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500"
      />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {soportado ? (
          <button
            onClick={alternarEscucha}
            className={`rounded-md px-4 py-2 text-sm font-medium ${
              escuchando
                ? "bg-rose-600 text-white hover:bg-rose-700"
                : "border border-slate-300 bg-white hover:bg-slate-100"
            }`}
          >
            {escuchando ? "■ Detener" : "● Dictar"}
          </button>
        ) : (
          <span className="text-xs text-slate-500">
            Este navegador no reconoce voz; escribe el texto.
          </span>
        )}

        <button
          onClick={() => enviar(false)}
          disabled={ocupado || texto.trim().length < 3}
          className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium hover:bg-slate-100 disabled:opacity-50"
        >
          Interpretar
        </button>

        <button
          onClick={() => enviar(true)}
          disabled={ocupado || texto.trim().length < 3}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          Registrar y contabilizar
        </button>

        {texto && (
          <button
            onClick={() => {
              setTexto("");
              setPropuesta(null);
              setEstado(null);
            }}
            className="text-sm text-slate-500 underline"
          >
            Limpiar
          </button>
        )}
      </div>

      {ocupado && <p className="mt-3 text-sm text-slate-500">Interpretando…</p>}
      {error && (
        <p className="mt-3 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>
      )}
      {estado && (
        <p className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {estado}
        </p>
      )}

      {propuesta && (
        <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-4 text-sm">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-medium">{propuesta.operacion}</span>
            <span className="text-xs text-slate-500">
              confianza {(propuesta.confianza * 100).toFixed(0)} %
            </span>
          </div>
          <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
            <Dato k="Descripción" v={propuesta.descripcion} />
            <Dato k="Contraparte" v={propuesta.contraparte} />
            <Dato k="Fecha" v={propuesta.fecha ?? "hoy"} />
            <Dato k="Total" v={propuesta.monto_total ? usd(propuesta.monto_total) : null} />
            <Dato k="Base" v={propuesta.base_imponible ? usd(propuesta.base_imponible) : null} />
            <Dato k="IVA" v={propuesta.iva ? usd(propuesta.iva) : null} />
            <Dato k="Categoría" v={propuesta.categoria} />
            <Dato k="Cuenta" v={propuesta.cuenta_financiera} />
          </dl>
          <p className="mt-3 text-xs text-slate-600">{propuesta.interpretacion}</p>
          {propuesta.faltantes.length > 0 && (
            <p className="mt-2 rounded bg-amber-50 px-2 py-1 text-xs text-amber-900">
              Falta: {propuesta.faltantes.join("; ")}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function Dato({ k, v }: { k: string; v: string | null }) {
  return (
    <div className="flex gap-2">
      <dt className="text-slate-500">{k}:</dt>
      <dd className="font-medium">{v ?? "—"}</dd>
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

type EstadoItem = "pendiente" | "subiendo" | "procesando" | "listo" | "error";

interface ItemCarga {
  id: string;
  file: File;
  estado: EstadoItem;
  mensaje: string;
}

const ETIQUETA_ESTADO: Record<EstadoItem, string> = {
  pendiente: "en cola",
  subiendo: "subiendo…",
  procesando: "procesando…",
  listo: "listo",
  error: "error",
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

        actualizar(item.id, { estado: "procesando" });

        const proceso = await fetch(`/api/documentos/${jsonSubida.datos.id}/procesar`, {
          method: "POST",
        });
        const jsonProceso = await proceso.json();
        if (!jsonProceso.ok) throw new Error(jsonProceso.error);

        actualizar(item.id, { estado: "listo", mensaje: jsonProceso.datos.resumen });
      } catch (e) {
        actualizar(item.id, {
          estado: "error",
          mensaje: e instanceof Error ? e.message : "Error inesperado",
        });
      }
    }

    setOcupado(false);
  }

  const hayListos = items.some((i) => i.estado === "listo");

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5">
      <h2 className="font-medium">Por documento</h2>
      <p className="mt-1 text-sm text-slate-500">
        PDF, imagen, XML o CSV. Puedes soltar varios estados de cuenta a la vez:
        se procesan uno tras otro y cada uno se clasifica en el momento.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-sm text-slate-700">Tipo de documento</span>
          <select
            value={tipo}
            onChange={(e) => setTipo(e.target.value)}
            disabled={ocupado}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-100"
          >
            {TIPOS_DOC.map((t) => (
              <option key={t.valor} value={t.valor}>
                {t.texto}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-xs text-slate-400">
            Se aplica a todos los documentos de la tanda.
          </span>
        </label>

        {esExtracto && (
          <label className="block">
            <span className="text-sm text-slate-700">Cuenta financiera</span>
            <select
              value={cuentaId}
              onChange={(e) => setCuentaId(e.target.value)}
              disabled={ocupado}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-100"
            >
              <option value="">Detectar automáticamente (IA)</option>
              {cuentas.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre} · {c.tipo}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-slate-400">
              Con detección automática, cada estado de cuenta se asigna a su
              cuenta por separado según lo que lea la IA.
            </span>
          </label>
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
        onKeyDown={(e) =>
          !ocupado && (e.key === "Enter" || e.key === " ") && inputRef.current?.click()
        }
        className={`mt-3 flex flex-col items-center justify-center rounded-lg border-2 border-dashed px-4 py-8 text-center transition-colors ${
          ocupado ? "cursor-not-allowed opacity-60" : "cursor-pointer"
        } ${
          arrastrando
            ? "border-emerald-500 bg-emerald-50"
            : "border-slate-300 bg-slate-50 hover:border-emerald-400 hover:bg-slate-100"
        }`}
      >
        <span className="text-sm text-slate-600">
          Arrastra uno o varios documentos aquí o haz clic para elegirlos
        </span>
        <span className="mt-0.5 text-xs text-slate-400">PDF, imagen, XML o CSV</span>
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

      {items.length > 0 && (
        <ul className="mt-3 divide-y divide-slate-100 rounded-md border border-slate-200">
          {items.map((it) => (
            <li key={it.id} className="flex items-start gap-3 px-3 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{it.file.name}</span>
                  <span className="shrink-0 text-xs text-slate-400">
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
              </div>
              <EstadoBadge estado={it.estado} />
              {!ocupado && it.estado !== "procesando" && it.estado !== "subiendo" && (
                <button
                  onClick={() => quitar(it.id)}
                  className="shrink-0 text-xs text-slate-400 hover:text-rose-600"
                  aria-label="Quitar"
                >
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          onClick={procesarTodo}
          disabled={ocupado || pendientes === 0}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {ocupado
            ? "Procesando…"
            : pendientes > 1
              ? `Subir y procesar ${pendientes} documentos`
              : "Subir y procesar"}
        </button>

        {hayListos && !ocupado && (
          <button
            onClick={() => setItems((prev) => prev.filter((i) => i.estado !== "listo"))}
            className="text-sm text-slate-500 underline hover:text-slate-700"
          >
            Quitar los ya procesados
          </button>
        )}
        {items.length > 0 && !ocupado && (
          <button
            onClick={() => setItems([])}
            className="text-sm text-slate-500 underline hover:text-slate-700"
          >
            Limpiar todo
          </button>
        )}
      </div>

      {error && (
        <p className="mt-3 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>
      )}
    </section>
  );
}

function EstadoBadge({ estado }: { estado: EstadoItem }) {
  const clase =
    estado === "listo"
      ? "bg-emerald-100 text-emerald-800"
      : estado === "error"
        ? "bg-rose-100 text-rose-800"
        : estado === "pendiente"
          ? "bg-slate-100 text-slate-600"
          : "bg-sky-100 text-sky-800";
  return (
    <span className={`shrink-0 rounded px-2 py-0.5 text-xs ${clase}`}>
      {ETIQUETA_ESTADO[estado]}
    </span>
  );
}
