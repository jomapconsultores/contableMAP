"use client";

import { useCallback, useState } from "react";
import { HandCoins, Plus, Wallet, X } from "lucide-react";
import { usd, fecha } from "@/lib/formato";
import { useCarga } from "@/lib/carga";
import {
  Aviso,
  Encabezado,
  Esqueleto,
  Insignia,
  Tarjeta,
  Vacio,
  boton,
  campo,
  etiqueta,
  tabla,
} from "@/components/ui";

interface Documento {
  id: string;
  clase: "CXC" | "CXP" | "DOC_COBRAR" | "DOC_PAGAR";
  nombre_tercero: string;
  descripcion: string;
  referencia: string | null;
  fecha_emision: string;
  fecha_vencimiento: string;
  monto_original: number;
  saldo: number;
  estado: string;
  dias_vencido: number;
  rango: string;
}

interface CuentaFinanciera {
  id: string;
  nombre: string;
  tipo: string;
}

const NOMBRE_CLASE: Record<string, string> = {
  CXC: "Cuenta por cobrar",
  DOC_COBRAR: "Documento por cobrar",
  CXP: "Cuenta por pagar",
  DOC_PAGAR: "Documento por pagar",
};

const NOMBRE_RANGO: Record<string, string> = {
  POR_VENCER: "Por vencer",
  "1_30": "1 a 30 días",
  "31_60": "31 a 60 días",
  "61_90": "61 a 90 días",
  MAS_90: "Más de 90 días",
};

const HOY = () => new Date().toISOString().slice(0, 10);

export default function Cartera() {
  const [docs, setDocs] = useState<Documento[]>([]);
  const [cuentas, setCuentas] = useState<CuentaFinanciera[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [nuevoAbierto, setNuevoAbierto] = useState(false);
  const [abonando, setAbonando] = useState<Documento | null>(null);

  const pedir = useCallback(async () => {
    const [c, f] = await Promise.all([
      fetch("/api/cartera").then((r) => r.json()),
      fetch("/api/cuentas").then((r) => r.json()),
    ]);
    if (!c.ok) throw new Error(c.error);
    return {
      docs: c.datos as Documento[],
      cuentas: f.ok ? (f.datos as CuentaFinanciera[]) : null,
    };
  }, []);

  const aplicar = useCallback(
    (r: { docs: Documento[]; cuentas: CuentaFinanciera[] | null } | Error) => {
      if (r instanceof Error) {
        setError(r.message);
      } else {
        setDocs(r.docs);
        if (r.cuentas) setCuentas(r.cuentas);
      }
      setCargando(false);
    },
    [],
  );

  const recargar = useCarga(pedir, aplicar);

  // Tras guardar un documento o un abono: indicador de nuevo y vuelta a pedir.
  const cargar = useCallback(async () => {
    setCargando(true);
    await recargar();
  }, [recargar]);

  const cobrar = docs.filter((d) => d.clase === "CXC" || d.clase === "DOC_COBRAR");
  const pagar = docs.filter((d) => d.clase === "CXP" || d.clase === "DOC_PAGAR");

  return (
    <div className="space-y-6">
      <Encabezado
        titulo="Cartera"
        descripcion="Cuentas y documentos por cobrar y por pagar. Los de facturas aparecen solos; aquí se añaden préstamos, letras y pagarés."
        acciones={
          <button
            onClick={() => setNuevoAbierto(!nuevoAbierto)}
            className={boton(nuevoAbierto ? "secundario" : "primario")}
          >
            {nuevoAbierto ? (
              <>
                <X size={16} /> Cancelar
              </>
            ) : (
              <>
                <Plus size={16} /> Nuevo documento
              </>
            )}
          </button>
        }
      />

      {aviso && <Aviso tono="exito">{aviso}</Aviso>}
      {error && <Aviso tono="peligro">{error}</Aviso>}

      {nuevoAbierto && (
        <FormularioDocumento
          cuentas={cuentas}
          alGuardar={async (mensaje) => {
            setNuevoAbierto(false);
            setAviso(mensaje);
            await cargar();
          }}
          alFallar={setError}
        />
      )}

      {abonando && (
        <FormularioAbono
          documento={abonando}
          cuentas={cuentas}
          alCerrar={() => setAbonando(null)}
          alGuardar={async (mensaje) => {
            setAbonando(null);
            setAviso(mensaje);
            await cargar();
          }}
          alFallar={setError}
        />
      )}

      <Grupo
        id="cobrar"
        titulo="Por cobrar"
        docs={cobrar}
        tono="verde"
        cargando={cargando}
        alAbonar={setAbonando}
      />
      <Grupo
        id="pagar"
        titulo="Por pagar"
        docs={pagar}
        tono="rojo"
        cargando={cargando}
        alAbonar={setAbonando}
      />
    </div>
  );
}

function Grupo({
  id,
  titulo,
  docs,
  tono,
  cargando,
  alAbonar,
}: {
  id: string;
  titulo: string;
  docs: Documento[];
  tono: "verde" | "rojo";
  cargando: boolean;
  alAbonar: (d: Documento) => void;
}) {
  const total = docs.reduce((s, d) => s + Number(d.saldo), 0);
  const vencido = docs.filter((d) => d.dias_vencido > 0).reduce((s, d) => s + Number(d.saldo), 0);

  return (
    <Tarjeta
      id={id}
      titulo={titulo}
      descripcion={
        docs.length > 0
          ? `${docs.length} documento${docs.length === 1 ? "" : "s"} con saldo`
          : undefined
      }
      acciones={
        <div className="flex flex-wrap items-center gap-3">
          {vencido > 0 && <Insignia tono="peligro">Vencido {usd(vencido)}</Insignia>}
          <span
            className={`text-lg font-semibold tabular-nums tracking-tight ${
              tono === "verde" ? "text-emerald-700" : "text-rose-700"
            }`}
          >
            {usd(total)}
          </span>
        </div>
      }
      sinRelleno
    >
      {cargando && docs.length === 0 ? (
        <div className="space-y-3 p-5">
          <Esqueleto />
          <Esqueleto />
          <Esqueleto className="h-4 w-2/3" />
        </div>
      ) : docs.length === 0 ? (
        <Vacio
          icono={tono === "verde" ? HandCoins : Wallet}
          titulo="Nada pendiente"
          descripcion={
            tono === "verde" ? "Nadie te debe nada ahora mismo." : "No hay nada por pagar ahora mismo."
          }
        />
      ) : (
        <div className={`${tabla.contenedor} max-h-[70vh]`}>
          <table className={tabla.tabla}>
            <thead className={tabla.cabecera}>
              <tr>
                <th className={tabla.th}>Tercero</th>
                <th className={tabla.th}>Documento</th>
                <th className={tabla.th}>Vence</th>
                <th className={tabla.th}>Antigüedad</th>
                <th className={`${tabla.th} text-right`}>Original</th>
                <th className={`${tabla.th} text-right`}>Saldo</th>
                <th className={tabla.th}>
                  <span className="sr-only">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody className={tabla.cuerpo}>
              {docs.map((d) => (
                <tr key={d.id} className={tabla.fila}>
                  <td className={tabla.td}>
                    <div className="font-medium text-slate-900">{d.nombre_tercero}</div>
                    <div className="text-xs text-slate-400">{NOMBRE_CLASE[d.clase]}</div>
                  </td>
                  <td className={`${tabla.td} min-w-48`}>
                    <div className="text-slate-700">{d.descripcion}</div>
                    {d.referencia && <div className="text-xs text-slate-400">{d.referencia}</div>}
                  </td>
                  <td className={`${tabla.td} whitespace-nowrap text-slate-500`}>
                    {fecha(d.fecha_vencimiento)}
                  </td>
                  <td className={tabla.td}>
                    <Insignia tono={d.rango === "POR_VENCER" ? "neutro" : "peligro"}>
                      {NOMBRE_RANGO[d.rango] ?? d.rango}
                    </Insignia>
                  </td>
                  <td className={`${tabla.td} ${tabla.numero} text-slate-500`}>
                    {usd(d.monto_original)}
                  </td>
                  <td className={`${tabla.td} ${tabla.numero} font-medium text-slate-900`}>
                    {usd(d.saldo)}
                  </td>
                  <td className={`${tabla.td} text-right`}>
                    <button onClick={() => alAbonar(d)} className={boton("secundario", "sm")}>
                      {d.clase === "CXC" || d.clase === "DOC_COBRAR" ? "Cobrar" : "Pagar"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Tarjeta>
  );
}

function FormularioDocumento({
  cuentas,
  alGuardar,
  alFallar,
}: {
  cuentas: CuentaFinanciera[];
  alGuardar: (mensaje: string) => Promise<void>;
  alFallar: (e: string) => void;
}) {
  const [ocupado, setOcupado] = useState(false);

  async function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setOcupado(true);
    const f = new FormData(e.currentTarget);

    const res = await fetch("/api/cartera", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(f.entries())),
    });
    const json = await res.json();
    setOcupado(false);

    if (!json.ok) {
      alFallar(json.error);
      return;
    }
    await alGuardar(
      json.datos.aviso
        ? `Documento registrado, pero no se contabilizó: ${json.datos.aviso}`
        : "Documento registrado y contabilizado.",
    );
  }

  return (
    <Tarjeta
      titulo="Nuevo documento"
      descripcion="Préstamos, letras, pagarés u otras deudas que no vienen de una factura."
    >
      <form onSubmit={enviar} className="grid gap-4 sm:grid-cols-3">
        <label className="block">
          <span className={etiqueta}>Clase</span>
          <select name="clase" className={campo}>
            <option value="DOC_COBRAR">Documento por cobrar</option>
            <option value="CXC">Cuenta por cobrar</option>
            <option value="DOC_PAGAR">Documento por pagar</option>
            <option value="CXP">Cuenta por pagar</option>
          </select>
        </label>

        <Campo etiqueta="Tercero" nombre="nombre_tercero" requerido />
        <Campo etiqueta="Identificación" nombre="identificacion" />
        <Campo etiqueta="Descripción" nombre="descripcion" requerido />
        <Campo etiqueta="Referencia" nombre="referencia" />
        <Campo etiqueta="Monto" nombre="monto_original" tipo="number" paso="0.01" requerido />
        <Campo etiqueta="Fecha de emisión" nombre="fecha_emision" tipo="date" valor={HOY()} requerido />
        <Campo etiqueta="Fecha de vencimiento" nombre="fecha_vencimiento" tipo="date" requerido />

        <label className="block">
          <span className={etiqueta}>Contrapartida</span>
          <select name="cuenta_financiera_id" className={campo}>
            <option value="">Bancos (por defecto)</option>
            {cuentas.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
        </label>

        <div className="flex justify-end border-t border-slate-100 pt-4 sm:col-span-3">
          <button type="submit" disabled={ocupado} className={boton("primario")}>
            {ocupado ? "Guardando…" : "Registrar y contabilizar"}
          </button>
        </div>
      </form>
    </Tarjeta>
  );
}

function FormularioAbono({
  documento,
  cuentas,
  alCerrar,
  alGuardar,
  alFallar,
}: {
  documento: Documento;
  cuentas: CuentaFinanciera[];
  alCerrar: () => void;
  alGuardar: (mensaje: string) => Promise<void>;
  alFallar: (e: string) => void;
}) {
  const [ocupado, setOcupado] = useState(false);
  const cobro = documento.clase === "CXC" || documento.clase === "DOC_COBRAR";

  async function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setOcupado(true);
    const f = new FormData(e.currentTarget);

    const res = await fetch("/api/cartera", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cartera_id: documento.id,
        ...Object.fromEntries(f.entries()),
      }),
    });
    const json = await res.json();
    setOcupado(false);

    if (!json.ok) {
      alFallar(json.error);
      return;
    }
    await alGuardar(
      `${cobro ? "Cobro" : "Pago"} registrado. Saldo pendiente: ${usd(json.datos.saldo)}.`,
    );
  }

  return (
    <Tarjeta
      titulo={`${cobro ? "Cobrar" : "Pagar"} · ${documento.nombre_tercero}`}
      descripcion={documento.descripcion}
      acciones={
        <span className="text-sm text-slate-500">
          Saldo{" "}
          <span className="font-semibold tabular-nums text-slate-900">{usd(documento.saldo)}</span>
        </span>
      }
      className="border-emerald-300 ring-2 ring-emerald-500/10"
    >
      <form onSubmit={enviar} className="grid gap-4 sm:grid-cols-4">
        <Campo
          etiqueta="Monto"
          nombre="monto"
          tipo="number"
          paso="0.01"
          valor={String(documento.saldo)}
          requerido
        />
        <Campo etiqueta="Interés" nombre="interes" tipo="number" paso="0.01" valor="0" />
        <Campo etiqueta="Fecha" nombre="fecha" tipo="date" valor={HOY()} requerido />

        <label className="block">
          <span className={etiqueta}>Cuenta</span>
          <select name="cuenta_financiera_id" className={campo}>
            <option value="">Bancos (por defecto)</option>
            {cuentas.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
        </label>

        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4 sm:col-span-4">
          <button type="button" onClick={alCerrar} className={boton("secundario")}>
            Cancelar
          </button>
          <button type="submit" disabled={ocupado} className={boton("primario")}>
            {ocupado ? "Guardando…" : `Registrar ${cobro ? "cobro" : "pago"}`}
          </button>
        </div>
      </form>
    </Tarjeta>
  );
}

function Campo({
  etiqueta: texto,
  nombre,
  tipo = "text",
  paso,
  valor,
  requerido,
}: {
  etiqueta: string;
  nombre: string;
  tipo?: string;
  paso?: string;
  valor?: string;
  requerido?: boolean;
}) {
  return (
    <label className="block">
      <span className={etiqueta}>{texto}</span>
      <input
        name={nombre}
        type={tipo}
        step={paso}
        defaultValue={valor}
        required={requerido}
        className={`${campo} ${tipo === "number" ? "text-right tabular-nums" : ""}`}
      />
    </label>
  );
}
