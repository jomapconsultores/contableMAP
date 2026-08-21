"use client";

import { useCallback, useState } from "react";
import { useCarga } from "@/lib/carga";

/**
 * Puesta a punto de la facturación electrónica: certificado de firma, datos
 * que el SRI exige en la cabecera del comprobante y puntos de emisión.
 *
 * Se separa del resto de ajustes porque es lo único que puede dejar al
 * contribuyente emitiendo mal: aquí se decide con qué firma y contra qué
 * ambiente se factura.
 */

interface Punto {
  id: string;
  establecimiento: string;
  punto_emision: string;
  nombre: string | null;
  direccion: string | null;
  sec_factura: number;
  activo: boolean;
}

interface Config {
  configurado: boolean;
  ambiente: number;
  dir_matriz: string | null;
  num_resolucion_especial: string | null;
  agente_retencion_resolucion: string | null;
  email_emisor: string | null;
  telefono_emisor: string | null;
  certificado: {
    sujeto: string;
    emisor: string;
    serie: string;
    desde: string;
    hasta: string;
    caducado: boolean;
  } | null;
  puntos_emision: Punto[];
}

const CAMPO =
  "mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500";

export default function FacturacionElectronica() {
  const [config, setConfig] = useState<Config | null>(null);
  const [cargando, setCargando] = useState(true);

  const pedir = useCallback(async () => {
    const r = await fetch("/api/sri/config").then((res) => res.json());
    return r.ok ? (r.datos as Config) : null;
  }, []);

  const aplicar = useCallback((r: Config | null | Error) => {
    if (!(r instanceof Error) && r) setConfig(r);
    setCargando(false);
  }, []);

  const recargar = useCarga(pedir, aplicar);

  if (cargando) {
    return (
      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="font-medium">Facturación electrónica</h2>
        <p className="mt-2 text-sm text-slate-500">Cargando…</p>
      </section>
    );
  }

  return (
    <section className="space-y-5 rounded-lg border border-slate-200 bg-white p-5">
      <div>
        <h2 className="font-medium">Facturación electrónica</h2>
        <p className="mt-1 text-sm text-slate-500">
          Con esto configurado, el sistema genera el XML, lo firma con tu
          certificado y lo envía a los servicios de recepción y autorización del
          SRI. La factura válida es el XML autorizado; el PDF es solo su
          representación impresa.
        </p>
      </div>

      <Certificado cert={config?.certificado ?? null} alCambiar={recargar} />
      <DatosEmisor config={config} alGuardar={recargar} />
      <PuntosEmision puntos={config?.puntos_emision ?? []} alCambiar={recargar} />
    </section>
  );
}

function Certificado({
  cert,
  alCambiar,
}: {
  cert: Config["certificado"];
  alCambiar: () => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function subir(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setOcupado(true);
    setError(null);
    setAviso(null);

    const res = await fetch("/api/sri/certificado", {
      method: "POST",
      body: new FormData(form),
    });
    const json = await res.json();
    setOcupado(false);

    if (!json.ok) {
      setError(json.error);
      return;
    }
    setAviso(json.datos.aviso ?? `Certificado cargado a nombre de ${json.datos.sujeto}.`);
    form.reset();
    await alCambiar();
  }

  const dia = (v: string) => new Date(v).toLocaleDateString("es-EC");

  return (
    <div className="rounded-md border border-slate-200 p-4">
      <h3 className="text-sm font-medium">Certificado de firma</h3>

      {cert ? (
        <div className="mt-2 space-y-1 text-sm">
          <div className="font-medium">{cert.sujeto}</div>
          <div className="text-xs text-slate-500">
            Emitido por {cert.emisor} · serie {cert.serie}
          </div>
          <div
            className={`text-xs ${cert.caducado ? "font-medium text-rose-700" : "text-slate-500"}`}
          >
            {cert.caducado
              ? `Caducado el ${dia(cert.hasta)}. No se puede firmar hasta renovarlo.`
              : `Válido del ${dia(cert.desde)} al ${dia(cert.hasta)}`}
          </div>
        </div>
      ) : (
        <p className="mt-2 text-sm text-slate-500">
          Todavía no hay ninguno. Sube el archivo <code>.p12</code> que te entregó
          la entidad certificadora (Security Data, ANF, Uanataca, Banco Central…).
        </p>
      )}

      <form onSubmit={subir} className="mt-3 grid gap-3 sm:grid-cols-3">
        <label className="block text-sm sm:col-span-2">
          <span className="text-slate-700">Archivo .p12 o .pfx</span>
          <input type="file" name="archivo" accept=".p12,.pfx" required className={CAMPO} />
        </label>
        <label className="block text-sm">
          <span className="text-slate-700">Contraseña</span>
          <input type="password" name="password" required className={CAMPO} />
        </label>

        {error && (
          <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800 sm:col-span-3">
            {error}
          </p>
        )}
        {aviso && (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 sm:col-span-3">
            {aviso}
          </p>
        )}

        <button
          type="submit"
          disabled={ocupado}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50 sm:col-span-3"
        >
          {ocupado ? "Comprobando…" : cert ? "Reemplazar certificado" : "Cargar certificado"}
        </button>
        <p className="text-xs text-slate-500 sm:col-span-3">
          La contraseña se guarda cifrada en el servidor y el archivo en
          almacenamiento privado. Se comprueba al subirlo: si la contraseña no
          abre el certificado, no se guarda nada.
        </p>
      </form>
    </div>
  );
}

function DatosEmisor({
  config,
  alGuardar,
}: {
  config: Config | null;
  alGuardar: () => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [guardado, setGuardado] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [ambiente, setAmbiente] = useState(String(config?.ambiente ?? 1));

  async function guardar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setOcupado(true);
    setError(null);
    setGuardado(false);
    const f = new FormData(e.currentTarget);

    const res = await fetch("/api/sri/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ambiente: Number(f.get("ambiente")),
        dir_matriz: f.get("dir_matriz"),
        num_resolucion_especial: f.get("num_resolucion_especial"),
        agente_retencion_resolucion: f.get("agente_retencion_resolucion"),
        email_emisor: f.get("email_emisor"),
        telefono_emisor: f.get("telefono_emisor"),
      }),
    });
    const json = await res.json();
    setOcupado(false);

    if (!json.ok) {
      setError(json.error);
      return;
    }
    setGuardado(true);
    await alGuardar();
  }

  return (
    <form onSubmit={guardar} className="grid gap-3 rounded-md border border-slate-200 p-4 sm:grid-cols-2">
      <h3 className="text-sm font-medium sm:col-span-2">Datos del emisor</h3>

      <label className="block text-sm">
        <span className="text-slate-700">Ambiente</span>
        <select
          name="ambiente"
          value={ambiente}
          onChange={(e) => setAmbiente(e.target.value)}
          className={CAMPO}
        >
          <option value="1">Pruebas (celcer)</option>
          <option value="2">Producción</option>
        </select>
      </label>

      <label className="block text-sm">
        <span className="text-slate-700">Dirección de la matriz</span>
        <input
          name="dir_matriz"
          required
          defaultValue={config?.dir_matriz ?? ""}
          className={CAMPO}
        />
      </label>

      <label className="block text-sm">
        <span className="text-slate-700">Nº de resolución de contribuyente especial</span>
        <input
          name="num_resolucion_especial"
          defaultValue={config?.num_resolucion_especial ?? ""}
          className={CAMPO}
        />
      </label>

      <label className="block text-sm">
        <span className="text-slate-700">Nº de resolución de agente de retención</span>
        <input
          name="agente_retencion_resolucion"
          defaultValue={config?.agente_retencion_resolucion ?? ""}
          className={CAMPO}
        />
      </label>

      <label className="block text-sm">
        <span className="text-slate-700">Correo del emisor</span>
        <input
          name="email_emisor"
          type="email"
          defaultValue={config?.email_emisor ?? ""}
          className={CAMPO}
        />
      </label>

      <label className="block text-sm">
        <span className="text-slate-700">Teléfono</span>
        <input name="telefono_emisor" defaultValue={config?.telefono_emisor ?? ""} className={CAMPO} />
      </label>

      {ambiente === "2" && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 sm:col-span-2">
          En producción cada factura autorizada es un documento tributario real:
          solo se anula con nota de crédito o con una solicitud de anulación en
          SRI en Línea. Prueba antes en el ambiente de certificación.
        </p>
      )}

      {error && (
        <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800 sm:col-span-2">{error}</p>
      )}
      {guardado && (
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800 sm:col-span-2">
          Guardado.
        </p>
      )}

      <button
        type="submit"
        disabled={ocupado}
        className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50 sm:col-span-2"
      >
        {ocupado ? "Guardando…" : "Guardar datos del emisor"}
      </button>
    </form>
  );
}

function PuntosEmision({
  puntos,
  alCambiar,
}: {
  puntos: Punto[];
  alCambiar: () => Promise<void>;
}) {
  const [abierto, setAbierto] = useState(puntos.length === 0);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function crear(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setOcupado(true);
    setError(null);
    const f = new FormData(form);

    const res = await fetch("/api/sri/puntos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        establecimiento: f.get("establecimiento"),
        punto_emision: f.get("punto_emision"),
        nombre: f.get("nombre"),
        direccion: f.get("direccion"),
        sec_factura: Number(f.get("sec_factura") || 1),
      }),
    });
    const json = await res.json();
    setOcupado(false);

    if (!json.ok) {
      setError(json.error);
      return;
    }
    form.reset();
    setAbierto(false);
    await alCambiar();
  }

  return (
    <div className="rounded-md border border-slate-200 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Puntos de emisión</h3>
        <button onClick={() => setAbierto(!abierto)} className="text-sm text-emerald-700 underline">
          {abierto ? "Cancelar" : "Añadir"}
        </button>
      </div>
      <p className="mt-1 text-sm text-slate-500">
        Los mismos que tengas registrados en SRI en Línea. La numeración debe
        continuar donde la dejaste: si ya emitiste hasta la 000000120, el
        próximo secuencial es 121.
      </p>

      {puntos.length > 0 && (
        <ul className="mt-3 divide-y divide-slate-100 text-sm">
          {puntos.map((p) => (
            <li key={p.id} className="flex items-center justify-between py-2">
              <span className="font-medium">
                {p.establecimiento}-{p.punto_emision}
                {p.nombre && <span className="ml-2 font-normal text-slate-500">{p.nombre}</span>}
              </span>
              <span className="text-xs text-slate-500">
                próxima factura nº {String(p.sec_factura).padStart(9, "0")}
                {!p.activo && " · inactivo"}
              </span>
            </li>
          ))}
        </ul>
      )}

      {abierto && (
        <form onSubmit={crear} className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="text-slate-700">Establecimiento</span>
            <input name="establecimiento" required placeholder="001" pattern="\d{1,3}" className={CAMPO} />
          </label>
          <label className="block text-sm">
            <span className="text-slate-700">Punto de emisión</span>
            <input name="punto_emision" required placeholder="001" pattern="\d{1,3}" className={CAMPO} />
          </label>
          <label className="block text-sm">
            <span className="text-slate-700">Nombre (opcional)</span>
            <input name="nombre" placeholder="Oficina" className={CAMPO} />
          </label>
          <label className="block text-sm">
            <span className="text-slate-700">Próximo secuencial</span>
            <input name="sec_factura" type="number" min={1} defaultValue={1} className={CAMPO} />
          </label>
          <label className="block text-sm sm:col-span-2">
            <span className="text-slate-700">Dirección del establecimiento</span>
            <input name="direccion" className={CAMPO} />
          </label>

          {error && (
            <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800 sm:col-span-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={ocupado}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50 sm:col-span-2"
          >
            {ocupado ? "Creando…" : "Crear punto de emisión"}
          </button>
        </form>
      )}
    </div>
  );
}
