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

function PorDocumento() {
  const [tipo, setTipo] = useState(TIPOS_DOC[0].valor);
  const [cuentaId, setCuentaId] = useState(""); // "" = que la IA la detecte
  const [cuentas, setCuentas] = useState<CuentaFinanciera[]>([]);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [arrastrando, setArrastrando] = useState(false);
  const [estado, setEstado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const esExtracto = tipo.startsWith("ESTADO_");

  useEffect(() => {
    fetch("/api/cuentas")
      .then((r) => r.json())
      .then((j) => j.ok && setCuentas(j.datos))
      .catch(() => undefined);
  }, []);

  function aceptar(f: File | null | undefined) {
    if (!f) return;
    const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
    if (!EXT_OK.includes(ext)) {
      setError(`Formato no admitido: .${ext}. Usa PDF, imagen, XML o CSV.`);
      return;
    }
    setError(null);
    setArchivo(f);
  }

  function alSoltar(e: React.DragEvent) {
    e.preventDefault();
    setArrastrando(false);
    aceptar(e.dataTransfer.files?.[0]);
  }

  async function subir() {
    if (!archivo) return;

    setOcupado(true);
    setError(null);
    setEstado("Subiendo…");

    try {
      const form = new FormData();
      form.append("archivo", archivo);
      form.append("tipo", tipo);
      if (cuentaId) form.append("cuenta_id", cuentaId);

      const subida = await fetch("/api/documentos", { method: "POST", body: form });
      const jsonSubida = await subida.json();
      if (!jsonSubida.ok) throw new Error(jsonSubida.error);

      setEstado(
        esExtracto && !cuentaId
          ? "Leyendo el documento e identificando la cuenta con IA… puede tardar un minuto."
          : "Leyendo el documento con IA… puede tardar un minuto.",
      );

      const proceso = await fetch(`/api/documentos/${jsonSubida.datos.id}/procesar`, {
        method: "POST",
      });
      const jsonProceso = await proceso.json();
      if (!jsonProceso.ok) throw new Error(jsonProceso.error);

      setEstado(jsonProceso.datos.resumen);
      setArchivo(null);
    } catch (e) {
      setEstado(null);
      setError(e instanceof Error ? e.message : "Error inesperado");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5">
      <h2 className="font-medium">Por documento</h2>
      <p className="mt-1 text-sm text-slate-500">
        PDF, imagen, XML o CSV. Los estados de cuenta se cargan línea por línea
        y se clasifican en el momento.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-sm text-slate-700">Tipo de documento</span>
          <select
            value={tipo}
            onChange={(e) => setTipo(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            {TIPOS_DOC.map((t) => (
              <option key={t.valor} value={t.valor}>
                {t.texto}
              </option>
            ))}
          </select>
        </label>

        {esExtracto && (
          <label className="block">
            <span className="text-sm text-slate-700">Cuenta financiera</span>
            <select
              value={cuentaId}
              onChange={(e) => setCuentaId(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">Detectar automáticamente (IA)</option>
              {cuentas.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre} · {c.tipo}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-slate-400">
              Déjalo así y la IA reconoce la cuenta por la institución y el
              número del estado de cuenta. Si no existe, la crea.
            </span>
          </label>
        )}
      </div>

      {/* Zona de arrastrar y soltar, también clicable */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setArrastrando(true);
        }}
        onDragLeave={() => setArrastrando(false)}
        onDrop={alSoltar}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && inputRef.current?.click()}
        className={`mt-3 flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-4 py-8 text-center transition-colors ${
          arrastrando
            ? "border-emerald-500 bg-emerald-50"
            : "border-slate-300 bg-slate-50 hover:border-emerald-400 hover:bg-slate-100"
        }`}
      >
        {archivo ? (
          <>
            <span className="text-sm font-medium text-slate-700">{archivo.name}</span>
            <span className="mt-0.5 text-xs text-slate-400">
              {(archivo.size / 1024).toFixed(0)} KB · clic o suelta otro para cambiarlo
            </span>
          </>
        ) : (
          <>
            <span className="text-sm text-slate-600">
              Arrastra el documento aquí o haz clic para elegirlo
            </span>
            <span className="mt-0.5 text-xs text-slate-400">PDF, imagen, XML o CSV</span>
          </>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.xml,.csv,.txt"
        onChange={(e) => aceptar(e.target.files?.[0])}
        className="hidden"
      />

      <button
        onClick={subir}
        disabled={ocupado || !archivo}
        className="mt-3 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
      >
        {ocupado ? "Procesando…" : "Subir y procesar"}
      </button>

      {error && (
        <p className="mt-3 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>
      )}
      {estado && (
        <p className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {estado}
        </p>
      )}
    </section>
  );
}
