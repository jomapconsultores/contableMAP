"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { useCarga } from "@/lib/carga";
import FacturacionElectronica from "./facturacion-electronica";
import MiCuenta from "./mi-cuenta";
import { Building2, Plus, X } from "lucide-react";
import {
  Aviso,
  Encabezado,
  Esqueleto,
  Insignia,
  Tarjeta,
  boton,
  campo,
  etiqueta,
} from "@/components/ui";

/** Botón de cabecera que abre o cierra el formulario de alta. */
function BotonAlta({ abierto, alternar }: { abierto: boolean; alternar: () => void }) {
  return (
    <button onClick={alternar} className={boton(abierto ? "fantasma" : "secundario", "sm")}>
      {abierto ? <X size={14} /> : <Plus size={14} />}
      {abierto ? "Cancelar" : "Añadir"}
    </button>
  );
}

interface Entidad {
  id: string;
  ruc: string;
  razon_social: string;
  regimen: string;
  periodicidad_iva: string;
  obligado_contabilidad: boolean;
}

interface Cuenta {
  id: string;
  nombre: string;
  tipo: string;
  institucion: string | null;
}

export default function Ajustes() {
  const [entidades, setEntidades] = useState<Entidad[]>([]);
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [cargando, setCargando] = useState(true);

  const pedir = useCallback(async () => {
    const e = await fetch("/api/entidades").then((r) => r.json());
    const hayEntidades = e.ok && e.datos.length > 0;
    const c = hayEntidades
      ? await fetch("/api/cuentas").then((r) => r.json())
      : { ok: false };
    return {
      entidades: e.ok ? (e.datos as Entidad[]) : null,
      cuentas: c.ok ? (c.datos as Cuenta[]) : null,
    };
  }, []);

  const aplicar = useCallback(
    (r: { entidades: Entidad[] | null; cuentas: Cuenta[] | null } | Error) => {
      if (!(r instanceof Error)) {
        if (r.entidades) setEntidades(r.entidades);
        if (r.cuentas) setCuentas(r.cuentas);
      }
      setCargando(false);
    },
    [],
  );

  const recargar = useCarga(pedir, aplicar);

  return (
    <div className="space-y-6">
      <Encabezado
        titulo="Ajustes"
        descripcion="Tu cuenta de acceso, la entidad contable, sus cuentas financieras y la facturación electrónica."
      />

      {/* Va primero y fuera de la carga de entidades: cambiar la propia clave
          no puede depender de tener una contabilidad ya configurada. */}
      <div id="cuenta" className="scroll-mt-20">
        <MiCuenta />
      </div>

      {cargando ? (
        <div className="space-y-6" aria-busy="true" aria-label="Cargando">
          {[0, 1].map((i) => (
            <div key={i} className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <Esqueleto className="h-4 w-40" />
              <Esqueleto className="h-3 w-72 max-w-full" />
              <Esqueleto className="h-10 w-full" />
            </div>
          ))}
        </div>
      ) : (
        <>
          <div id="general" className="scroll-mt-20 space-y-6">
            <SeccionEntidades entidades={entidades} alCrear={recargar} />
            {entidades.length > 0 && (
              <SeccionCuentas cuentas={cuentas} alCrear={recargar} />
            )}
          </div>
          {entidades.length > 0 && (
            <div id="facturacion" className="scroll-mt-20">
              <FacturacionElectronica />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SeccionEntidades({
  entidades,
  alCrear,
}: {
  entidades: Entidad[];
  alCrear: () => Promise<void>;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(entidades.length === 0);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function crear(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setOcupado(true);
    setError(null);
    const f = new FormData(e.currentTarget);

    const res = await fetch("/api/entidades", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ruc: f.get("ruc"),
        razon_social: f.get("razon_social"),
        regimen: f.get("regimen"),
        periodicidad_iva: f.get("periodicidad_iva"),
        obligado_contabilidad: f.get("obligado_contabilidad") === "on",
      }),
    });
    const json = await res.json();
    setOcupado(false);

    if (!json.ok) {
      setError(json.error);
      return;
    }
    setAbierto(false);
    await alCrear();
    router.refresh();
  }

  return (
    <Tarjeta
      titulo="Entidad contable"
      descripcion="La persona o empresa cuya contabilidad se lleva: RUC, régimen tributario y periodicidad del IVA."
      acciones={<BotonAlta abierto={abierto} alternar={() => setAbierto(!abierto)} />}
    >
      {entidades.length > 0 && (
        <ul className="-my-2 divide-y divide-slate-100 text-sm">
          {entidades.map((e) => (
            <li key={e.id} className="flex items-start gap-3 py-3">
              <span className="shrink-0 rounded-lg bg-emerald-50 p-2 text-emerald-700">
                <Building2 size={18} />
              </span>
              <div className="min-w-0">
                <div className="font-medium text-slate-900">{e.razon_social}</div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                  <span className="tabular-nums">RUC {e.ruc}</span>
                  <Insignia>{e.regimen.replace(/_/g, " ").toLowerCase()}</Insignia>
                  <Insignia>IVA {e.periodicidad_iva.toLowerCase()}</Insignia>
                  {e.obligado_contabilidad && (
                    <Insignia tono="info">obligado a llevar contabilidad</Insignia>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {abierto && (
        <form
          onSubmit={crear}
          className={`grid gap-4 sm:grid-cols-2 ${
            entidades.length > 0 ? "mt-5 border-t border-slate-100 pt-5" : ""
          }`}
        >
          <Campo etiqueta="RUC o cédula" nombre="ruc" requerido pattern="\d{10,13}" />
          <Campo etiqueta="Razón social" nombre="razon_social" requerido />

          <div>
            <label htmlFor="regimen" className={etiqueta}>
              Régimen
            </label>
            <select id="regimen" name="regimen" className={campo}>
              <option value="GENERAL">General</option>
              <option value="RIMPE_EMPRENDEDOR">RIMPE emprendedor</option>
              <option value="RIMPE_NEGOCIO_POPULAR">RIMPE negocio popular</option>
            </select>
          </div>

          <div>
            <label htmlFor="periodicidad_iva" className={etiqueta}>
              Periodicidad del IVA
            </label>
            <select id="periodicidad_iva" name="periodicidad_iva" className={campo}>
              <option value="MENSUAL">Mensual</option>
              <option value="SEMESTRAL">Semestral</option>
            </select>
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-700 sm:col-span-2">
            <input
              type="checkbox"
              name="obligado_contabilidad"
              className="h-4 w-4 rounded border-slate-300 accent-emerald-600"
            />
            <span>Obligado a llevar contabilidad</span>
          </label>

          {error && (
            <div className="sm:col-span-2">
              <Aviso tono="peligro">{error}</Aviso>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
            <button type="submit" disabled={ocupado} className={boton("primario")}>
              {ocupado ? "Creando…" : "Crear entidad"}
            </button>
            <p className="text-xs text-slate-500">
              Al crearla se genera automáticamente su plan de cuentas y el
              catálogo de categorías de gasto.
            </p>
          </div>
        </form>
      )}

      {entidades.length === 0 && !abierto && (
        <p className="text-sm text-slate-500">Aún no hay ninguna entidad.</p>
      )}
    </Tarjeta>
  );
}

function SeccionCuentas({
  cuentas,
  alCrear,
}: {
  cuentas: Cuenta[];
  alCrear: () => Promise<void>;
}) {
  const [abierto, setAbierto] = useState(cuentas.length === 0);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function crear(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setOcupado(true);
    setError(null);
    const f = new FormData(e.currentTarget);

    const res = await fetch("/api/cuentas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nombre: f.get("nombre"),
        tipo: f.get("tipo"),
        institucion: f.get("institucion"),
        numero: f.get("numero"),
      }),
    });
    const json = await res.json();
    setOcupado(false);

    if (!json.ok) {
      setError(json.error);
      return;
    }
    setAbierto(false);
    await alCrear();
  }

  return (
    <Tarjeta
      titulo="Cuentas financieras"
      descripcion="Bancos, tarjetas de crédito y cooperativas. Cada estado de cuenta que cargues se asocia a una de ellas."
      acciones={<BotonAlta abierto={abierto} alternar={() => setAbierto(!abierto)} />}
      sinRelleno={cuentas.length > 0 && !abierto}
    >
      {cuentas.length > 0 && (
        <ul
          className={`divide-y divide-slate-100 text-sm ${
            abierto ? "-mx-5 -mt-5 border-b border-slate-100" : ""
          }`}
        >
          {cuentas.map((c) => (
            <li
              key={c.id}
              className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 transition-colors hover:bg-slate-50/80"
            >
              <span className="font-medium text-slate-900">{c.nombre}</span>
              <span className="flex items-center gap-2 text-xs text-slate-500">
                {c.institucion && <span>{c.institucion}</span>}
                <Insignia>{c.tipo.replace(/_/g, " ").toLowerCase()}</Insignia>
              </span>
            </li>
          ))}
        </ul>
      )}

      {abierto && (
        <form
          onSubmit={crear}
          className={`grid gap-4 sm:grid-cols-2 ${cuentas.length > 0 ? "mt-5" : ""}`}
        >
          <Campo etiqueta="Nombre" nombre="nombre" requerido />
          <div>
            <label htmlFor="tipo-cuenta" className={etiqueta}>
              Tipo
            </label>
            <select id="tipo-cuenta" name="tipo" className={campo}>
              <option value="BANCO">Banco</option>
              <option value="TARJETA_CREDITO">Tarjeta de crédito</option>
              <option value="COOPERATIVA">Cooperativa</option>
              <option value="CAJA">Caja</option>
              <option value="INVERSION">Inversión</option>
            </select>
          </div>
          <Campo etiqueta="Institución" nombre="institucion" />
          <Campo etiqueta="Número (últimos dígitos)" nombre="numero" />

          {error && (
            <div className="sm:col-span-2">
              <Aviso tono="peligro">{error}</Aviso>
            </div>
          )}

          <div className="sm:col-span-2">
            <button type="submit" disabled={ocupado} className={boton("primario")}>
              {ocupado ? "Creando…" : "Crear cuenta"}
            </button>
          </div>
        </form>
      )}

      {cuentas.length === 0 && !abierto && (
        <p className="text-sm text-slate-500">Aún no hay cuentas financieras.</p>
      )}
    </Tarjeta>
  );
}

function Campo({
  etiqueta: texto,
  nombre,
  requerido,
  pattern,
}: {
  etiqueta: string;
  nombre: string;
  requerido?: boolean;
  pattern?: string;
}) {
  return (
    <div>
      <label htmlFor={nombre} className={etiqueta}>
        {texto}
      </label>
      <input
        id={nombre}
        name={nombre}
        required={requerido}
        pattern={pattern}
        className={campo}
      />
    </div>
  );
}
