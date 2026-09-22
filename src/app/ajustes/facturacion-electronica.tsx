"use client";

import { useCallback, useState } from "react";
import { useCarga } from "@/lib/carga";
import { FileKey2, Plus, Store, X } from "lucide-react";
import {
  Aviso,
  Esqueleto,
  Insignia,
  Tarjeta,
  Vacio,
  boton,
  campo,
  etiqueta,
  tabla,
} from "@/components/ui";

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

/** Texto de ayuda bajo un campo o un formulario. */
const AYUDA = "text-xs text-slate-500";

/** El `<input type="file">` con el botón nativo a juego con el resto. */
const CAMPO_ARCHIVO = `${campo} py-1.5! file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-2.5 file:py-1 file:text-xs file:font-medium file:text-slate-700 hover:file:bg-slate-200`;

function Cabecera() {
  return (
    <div>
      <h2 className="text-base font-semibold text-slate-900">Facturación electrónica</h2>
      <p className="mt-1 max-w-3xl text-sm text-slate-500">
        Con esto configurado, el sistema genera el XML, lo firma con tu
        certificado y lo envía a los servicios de recepción y autorización del
        SRI. La factura válida es el XML autorizado; el PDF es solo su
        representación impresa.
      </p>
    </div>
  );
}

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
      <div className="space-y-4">
        <Cabecera />
        <div
          className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
          aria-busy="true"
          aria-label="Cargando"
        >
          <Esqueleto className="h-4 w-40" />
          <Esqueleto className="h-3 w-72 max-w-full" />
          <Esqueleto className="h-10 w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Cabecera />
      <Certificado cert={config?.certificado ?? null} alCambiar={recargar} />
      <DatosEmisor config={config} alGuardar={recargar} />
      <PuntosEmision puntos={config?.puntos_emision ?? []} alCambiar={recargar} />
    </div>
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
    <Tarjeta
      titulo="Certificado de firma"
      descripcion="El archivo .p12 con el que se firma cada comprobante antes de enviarlo al SRI."
      acciones={
        cert ? (
          cert.caducado ? (
            <Insignia tono="peligro">Caducado</Insignia>
          ) : (
            <Insignia tono="exito">Vigente</Insignia>
          )
        ) : (
          <Insignia tono="aviso">Sin certificado</Insignia>
        )
      }
    >
      {cert ? (
        <div className="flex items-start gap-3">
          <span className="shrink-0 rounded-lg bg-emerald-50 p-2 text-emerald-700">
            <FileKey2 size={18} />
          </span>
          <div className="min-w-0 space-y-1 text-sm">
            <div className="font-medium text-slate-900">{cert.sujeto}</div>
            <div className="text-xs text-slate-500">
              Emitido por {cert.emisor} · serie <span className="tabular-nums">{cert.serie}</span>
            </div>
            {!cert.caducado && (
              <div className="text-xs text-slate-500">
                Válido del {dia(cert.desde)} al {dia(cert.hasta)}
              </div>
            )}
          </div>
        </div>
      ) : (
        <p className="text-sm text-slate-500">
          Todavía no hay ninguno. Sube el archivo <code>.p12</code> que te entregó
          la entidad certificadora (Security Data, ANF, Uanataca, Banco Central…).
        </p>
      )}

      {cert?.caducado && (
        <div className="mt-4">
          <Aviso tono="peligro">
            Caducado el {dia(cert.hasta)}. No se puede firmar hasta renovarlo.
          </Aviso>
        </div>
      )}

      <form
        onSubmit={subir}
        className="mt-5 grid gap-4 border-t border-slate-100 pt-5 sm:grid-cols-3"
      >
        <div className="sm:col-span-2">
          <label htmlFor="cert-archivo" className={etiqueta}>
            Archivo .p12 o .pfx
          </label>
          <input
            id="cert-archivo"
            type="file"
            name="archivo"
            accept=".p12,.pfx"
            required
            className={CAMPO_ARCHIVO}
          />
        </div>
        <div>
          <label htmlFor="cert-password" className={etiqueta}>
            Contraseña
          </label>
          <input
            id="cert-password"
            type="password"
            name="password"
            required
            className={campo}
          />
        </div>

        {error && (
          <div className="sm:col-span-3">
            <Aviso tono="peligro">{error}</Aviso>
          </div>
        )}
        {aviso && (
          <div className="sm:col-span-3">
            <Aviso tono="aviso">{aviso}</Aviso>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3 sm:col-span-3">
          <button type="submit" disabled={ocupado} className={boton("primario")}>
            {ocupado ? "Comprobando…" : cert ? "Reemplazar certificado" : "Cargar certificado"}
          </button>
          <p className={`${AYUDA} min-w-0 flex-1`}>
            La contraseña se guarda cifrada en el servidor y el archivo en
            almacenamiento privado. Se comprueba al subirlo: si la contraseña no
            abre el certificado, no se guarda nada.
          </p>
        </div>
      </form>
    </Tarjeta>
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

  // La insignia refleja lo guardado, no lo que está elegido en el selector
  // sin guardar: es el ambiente contra el que se está facturando ahora.
  const insignia = !config?.configurado ? (
    <Insignia tono="aviso">Sin configurar</Insignia>
  ) : config.ambiente === 2 ? (
    <Insignia tono="exito">Producción</Insignia>
  ) : (
    <Insignia tono="info">Pruebas</Insignia>
  );

  return (
    <Tarjeta
      titulo="Datos del emisor"
      descripcion="Lo que el SRI exige en la cabecera de cada comprobante y el ambiente al que se envía."
      acciones={insignia}
    >
      <form onSubmit={guardar} className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="sri-ambiente" className={etiqueta}>
            Ambiente
          </label>
          <select
            id="sri-ambiente"
            name="ambiente"
            value={ambiente}
            onChange={(e) => setAmbiente(e.target.value)}
            className={campo}
          >
            <option value="1">Pruebas (celcer)</option>
            <option value="2">Producción</option>
          </select>
        </div>

        <div>
          <label htmlFor="sri-dir-matriz" className={etiqueta}>
            Dirección de la matriz
          </label>
          <input
            id="sri-dir-matriz"
            name="dir_matriz"
            required
            defaultValue={config?.dir_matriz ?? ""}
            className={campo}
          />
        </div>

        <div>
          <label htmlFor="sri-resolucion-especial" className={etiqueta}>
            Nº de resolución de contribuyente especial
          </label>
          <input
            id="sri-resolucion-especial"
            name="num_resolucion_especial"
            defaultValue={config?.num_resolucion_especial ?? ""}
            className={campo}
          />
        </div>

        <div>
          <label htmlFor="sri-resolucion-retencion" className={etiqueta}>
            Nº de resolución de agente de retención
          </label>
          <input
            id="sri-resolucion-retencion"
            name="agente_retencion_resolucion"
            defaultValue={config?.agente_retencion_resolucion ?? ""}
            className={campo}
          />
        </div>

        <div>
          <label htmlFor="sri-email" className={etiqueta}>
            Correo del emisor
          </label>
          <input
            id="sri-email"
            name="email_emisor"
            type="email"
            defaultValue={config?.email_emisor ?? ""}
            className={campo}
          />
        </div>

        <div>
          <label htmlFor="sri-telefono" className={etiqueta}>
            Teléfono
          </label>
          <input
            id="sri-telefono"
            name="telefono_emisor"
            defaultValue={config?.telefono_emisor ?? ""}
            className={campo}
          />
        </div>

        {ambiente === "2" && (
          <div className="sm:col-span-2">
            <Aviso tono="aviso" titulo="Ambiente de producción">
              En producción cada factura autorizada es un documento tributario real:
              solo se anula con nota de crédito o con una solicitud de anulación en
              SRI en Línea. Prueba antes en el ambiente de certificación.
            </Aviso>
          </div>
        )}

        {error && (
          <div className="sm:col-span-2">
            <Aviso tono="peligro">{error}</Aviso>
          </div>
        )}
        {guardado && (
          <div className="sm:col-span-2">
            <Aviso tono="exito">Guardado.</Aviso>
          </div>
        )}

        <div className="sm:col-span-2">
          <button type="submit" disabled={ocupado} className={boton("primario")}>
            {ocupado ? "Guardando…" : "Guardar datos del emisor"}
          </button>
        </div>
      </form>
    </Tarjeta>
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
    <Tarjeta
      titulo="Puntos de emisión"
      descripcion="Los mismos que tengas registrados en SRI en Línea. La numeración debe continuar donde la dejaste: si ya emitiste hasta la 000000120, el próximo secuencial es 121."
      acciones={
        <button
          type="button"
          onClick={() => setAbierto(!abierto)}
          className={boton(abierto ? "fantasma" : "secundario", "sm")}
        >
          {abierto ? <X size={14} /> : <Plus size={14} />}
          {abierto ? "Cancelar" : "Añadir"}
        </button>
      }
      sinRelleno
    >
      {puntos.length > 0 && (
        <div className={tabla.contenedor}>
          <table className={tabla.tabla}>
            <thead className={tabla.cabecera}>
              <tr>
                <th className={tabla.th}>Código</th>
                <th className={tabla.th}>Nombre</th>
                <th className={`${tabla.th} text-right`}>Próxima factura</th>
                <th className={tabla.th}>Estado</th>
              </tr>
            </thead>
            <tbody className={tabla.cuerpo}>
              {puntos.map((p) => (
                <tr key={p.id} className={tabla.fila}>
                  <td className={`${tabla.td} whitespace-nowrap font-medium tabular-nums text-slate-900`}>
                    {p.establecimiento}-{p.punto_emision}
                  </td>
                  <td className={`${tabla.td} text-slate-600`}>
                    {p.nombre ?? <span className="text-slate-400">—</span>}
                  </td>
                  <td className={`${tabla.td} ${tabla.numero} text-slate-700`}>
                    nº {String(p.sec_factura).padStart(9, "0")}
                  </td>
                  <td className={tabla.td}>
                    {p.activo ? (
                      <Insignia tono="exito">Activo</Insignia>
                    ) : (
                      <Insignia>Inactivo</Insignia>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {abierto && (
        <form
          onSubmit={crear}
          className={`grid gap-4 p-5 sm:grid-cols-2 ${
            puntos.length > 0 ? "border-t border-slate-100" : ""
          }`}
        >
          <div>
            <label htmlFor="punto-establecimiento" className={etiqueta}>
              Establecimiento
            </label>
            <input
              id="punto-establecimiento"
              name="establecimiento"
              required
              placeholder="001"
              pattern="\d{1,3}"
              inputMode="numeric"
              className={campo}
            />
          </div>
          <div>
            <label htmlFor="punto-emision" className={etiqueta}>
              Punto de emisión
            </label>
            <input
              id="punto-emision"
              name="punto_emision"
              required
              placeholder="001"
              pattern="\d{1,3}"
              inputMode="numeric"
              className={campo}
            />
          </div>
          <div>
            <label htmlFor="punto-nombre" className={etiqueta}>
              Nombre (opcional)
            </label>
            <input id="punto-nombre" name="nombre" placeholder="Oficina" className={campo} />
          </div>
          <div>
            <label htmlFor="punto-secuencial" className={etiqueta}>
              Próximo secuencial
            </label>
            <input
              id="punto-secuencial"
              name="sec_factura"
              type="number"
              min={1}
              defaultValue={1}
              className={campo}
            />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="punto-direccion" className={etiqueta}>
              Dirección del establecimiento
            </label>
            <input id="punto-direccion" name="direccion" className={campo} />
          </div>

          {error && (
            <div className="sm:col-span-2">
              <Aviso tono="peligro">{error}</Aviso>
            </div>
          )}

          <div className="sm:col-span-2">
            <button type="submit" disabled={ocupado} className={boton("primario")}>
              {ocupado ? "Creando…" : "Crear punto de emisión"}
            </button>
          </div>
        </form>
      )}

      {puntos.length === 0 && !abierto && (
        <Vacio
          icono={Store}
          titulo="Aún no hay puntos de emisión"
          descripcion="Añade al menos uno para poder emitir facturas."
        />
      )}
    </Tarjeta>
  );
}
