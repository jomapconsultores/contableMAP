"use client";

import { useCallback, useState } from "react";
import { Plus, Receipt, X } from "lucide-react";
import { usd, fecha } from "@/lib/formato";
import { useCarga } from "@/lib/carga";
import {
  Aviso,
  Encabezado,
  Esqueleto,
  Indicador,
  Insignia,
  Tarjeta,
  Vacio,
  boton,
  campo,
  etiqueta as claseEtiqueta,
  tabla,
} from "@/components/ui";

interface Retencion {
  id: string;
  clase: "RECIBIDA" | "EFECTUADA";
  fecha: string;
  numero: string | null;
  ruc_contraparte: string;
  nombre_contraparte: string;
  base_renta: number;
  porc_renta: number;
  ret_renta: number;
  base_iva: number;
  porc_iva: number;
  ret_iva: number;
  ret_isd: number;
  total_retenido: number;
  asiento_id: string | null;
}

const HOY = () => new Date().toISOString().slice(0, 10);

export default function Retenciones() {
  const [filas, setFilas] = useState<Retencion[]>([]);
  const [abierto, setAbierto] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const pedir = useCallback(async (): Promise<Retencion[]> => {
    const j = await fetch("/api/retenciones").then((r) => r.json());
    if (!j.ok) throw new Error(j.error);
    return j.datos;
  }, []);

  const aplicar = useCallback((r: Retencion[] | Error) => {
    if (r instanceof Error) setError(r.message);
    else setFilas(r);
    setCargando(false);
  }, []);

  const recargar = useCarga(pedir, aplicar);

  // Tras guardar una retención: indicador de nuevo y vuelta a pedir.
  const cargar = useCallback(async () => {
    setCargando(true);
    await recargar();
  }, [recargar]);

  const recibidas = filas.filter((f) => f.clase === "RECIBIDA");
  const totalIva = recibidas.reduce((s, f) => s + Number(f.ret_iva), 0);
  const totalRenta = recibidas.reduce((s, f) => s + Number(f.ret_renta), 0);

  return (
    <div className="space-y-6">
      <Encabezado
        titulo="Retenciones"
        descripcion="Las que nos efectúan alimentan el crédito tributario de IVA y de renta; las que efectuamos como agente crean la obligación con el SRI."
        acciones={
          <button
            onClick={() => setAbierto(!abierto)}
            className={boton(abierto ? "secundario" : "primario")}
          >
            {abierto ? <X size={16} /> : <Plus size={16} />}
            {abierto ? "Cancelar" : "Registrar comprobante"}
          </button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Indicador
          etiqueta="IVA retenido a nuestro favor"
          valor={usd(totalIva)}
          tono="exito"
          icono={Receipt}
        />
        <Indicador
          etiqueta="Renta retenida a nuestro favor"
          valor={usd(totalRenta)}
          tono="exito"
          icono={Receipt}
        />
      </div>

      {aviso && <Aviso tono="exito">{aviso}</Aviso>}
      {error && <Aviso tono="peligro">{error}</Aviso>}

      {abierto && (
        <Formulario
          alGuardar={async (m) => {
            setAbierto(false);
            setAviso(m);
            await cargar();
          }}
          alFallar={setError}
        />
      )}

      <Tarjeta titulo="Comprobantes de retención" sinRelleno>
        <div className={`${tabla.contenedor} max-h-[70vh]`}>
          <table className={tabla.tabla}>
            <thead className={tabla.cabecera}>
              <tr>
                <th className={tabla.th}>Fecha</th>
                <th className={tabla.th}>Clase</th>
                <th className={tabla.th}>Contraparte</th>
                <th className={tabla.th}>Nº</th>
                <th className={`${tabla.th} text-right`}>Renta</th>
                <th className={`${tabla.th} text-right`}>IVA</th>
                <th className={`${tabla.th} text-right`}>ISD</th>
                <th className={`${tabla.th} text-right`}>Total</th>
              </tr>
            </thead>
            <tbody className={tabla.cuerpo}>
              {cargando &&
                filas.length === 0 &&
                Array.from({ length: 5 }, (_, i) => (
                  <tr key={i}>
                    <td colSpan={8} className="px-4 py-3">
                      <Esqueleto />
                    </td>
                  </tr>
                ))}
              {!cargando && filas.length === 0 && (
                <tr>
                  <td colSpan={8}>
                    <Vacio
                      icono={Receipt}
                      titulo="No hay retenciones registradas"
                      accion={
                        !abierto && (
                          <button onClick={() => setAbierto(true)} className={boton("secundario", "sm")}>
                            <Plus size={14} /> Registrar comprobante
                          </button>
                        )
                      }
                    />
                  </td>
                </tr>
              )}
              {filas.map((f) => (
                <tr key={f.id} className={tabla.fila}>
                  <td className={`${tabla.td} whitespace-nowrap text-slate-500`}>{fecha(f.fecha)}</td>
                  <td className={tabla.td}>
                    <Insignia tono={f.clase === "RECIBIDA" ? "exito" : "aviso"}>
                      {f.clase === "RECIBIDA" ? "Recibida" : "Efectuada"}
                    </Insignia>
                  </td>
                  <td className={`${tabla.td} min-w-56`}>
                    <div className="font-medium text-slate-900">{f.nombre_contraparte}</div>
                    <div className="text-xs tabular-nums text-slate-400">{f.ruc_contraparte}</div>
                  </td>
                  <td className={`${tabla.td} whitespace-nowrap font-mono text-xs text-slate-500`}>
                    {f.numero ?? "—"}
                  </td>
                  <td className={`${tabla.td} ${tabla.numero} text-slate-700`}>{usd(f.ret_renta)}</td>
                  <td className={`${tabla.td} ${tabla.numero} text-slate-700`}>{usd(f.ret_iva)}</td>
                  <td className={`${tabla.td} ${tabla.numero} text-slate-700`}>{usd(f.ret_isd)}</td>
                  <td className={`${tabla.td} ${tabla.numero} font-medium text-slate-900`}>
                    {usd(f.total_retenido)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Tarjeta>
    </div>
  );
}

function Formulario({
  alGuardar,
  alFallar,
}: {
  alGuardar: (m: string) => Promise<void>;
  alFallar: (e: string) => void;
}) {
  const [ocupado, setOcupado] = useState(false);
  const [baseRenta, setBaseRenta] = useState("");
  const [porcRenta, setPorcRenta] = useState("");
  const [baseIva, setBaseIva] = useState("");
  const [porcIva, setPorcIva] = useState("");

  // El comprobante trae base y porcentaje; el valor retenido se deriva.
  const calc = (b: string, p: string) =>
    ((Number(b || 0) * Number(p || 0)) / 100).toFixed(2);

  const retRenta = calc(baseRenta, porcRenta);
  const retIva = calc(baseIva, porcIva);

  async function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setOcupado(true);
    const f = new FormData(e.currentTarget);

    const res = await fetch("/api/retenciones", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...Object.fromEntries(f.entries()),
        ret_renta: retRenta,
        ret_iva: retIva,
      }),
    });
    const json = await res.json();
    setOcupado(false);

    if (!json.ok) {
      alFallar(json.error);
      return;
    }
    await alGuardar(
      json.datos.aviso
        ? `Retención registrada, pero no se contabilizó: ${json.datos.aviso}`
        : `Retención registrada y contabilizada por ${usd(json.datos.total_retenido)}.`,
    );
  }

  return (
    <Tarjeta
      titulo="Registrar comprobante de retención"
      descripcion="El valor retenido se calcula a partir de la base y el porcentaje."
    >
      <form onSubmit={enviar} className="space-y-6">
        <fieldset className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <legend className="sr-only">Datos del comprobante</legend>
          <label className="block">
            <span className={claseEtiqueta}>Clase</span>
            <select name="clase" className={campo}>
              <option value="RECIBIDA">Recibida (nos retuvieron)</option>
              <option value="EFECTUADA">Efectuada (retuvimos)</option>
            </select>
          </label>

          <Campo etiqueta="Fecha" nombre="fecha" tipo="date" valor={HOY()} requerido />
          <Campo etiqueta="Nº comprobante" nombre="numero" />
          <Campo etiqueta="RUC contraparte" nombre="ruc_contraparte" requerido />
          <div className="sm:col-span-2 lg:col-span-4">
            <Campo etiqueta="Nombre contraparte" nombre="nombre_contraparte" requerido />
          </div>
        </fieldset>

        <fieldset className="grid gap-4 border-t border-slate-100 pt-5 sm:grid-cols-3">
          <legend className="sr-only">Retención en la fuente de renta</legend>
          <label className="block">
            <span className={claseEtiqueta}>Base renta</span>
            <input
              name="base_renta"
              type="number"
              step="0.01"
              value={baseRenta}
              onChange={(e) => setBaseRenta(e.target.value)}
              className={`${campo} text-right tabular-nums`}
            />
          </label>
          <label className="block">
            <span className={claseEtiqueta}>% renta</span>
            <input
              name="porc_renta"
              type="number"
              step="0.01"
              value={porcRenta}
              onChange={(e) => setPorcRenta(e.target.value)}
              className={`${campo} text-right tabular-nums`}
            />
          </label>
          <Calculado etiqueta="Retenido renta" valor={retRenta} />

          <label className="block">
            <span className={claseEtiqueta}>Base IVA</span>
            <input
              name="base_iva"
              type="number"
              step="0.01"
              value={baseIva}
              onChange={(e) => setBaseIva(e.target.value)}
              className={`${campo} text-right tabular-nums`}
            />
          </label>
          <label className="block">
            <span className={claseEtiqueta}>% IVA</span>
            <input
              name="porc_iva"
              type="number"
              step="0.01"
              value={porcIva}
              onChange={(e) => setPorcIva(e.target.value)}
              className={`${campo} text-right tabular-nums`}
            />
          </label>
          <Calculado etiqueta="Retenido IVA" valor={retIva} />

          <Campo etiqueta="ISD" nombre="ret_isd" tipo="number" paso="0.01" valor="0" numerico />
        </fieldset>

        <div className="flex justify-end border-t border-slate-100 pt-5">
          <button type="submit" disabled={ocupado} className={boton("primario")}>
            {ocupado ? "Guardando…" : "Registrar y contabilizar"}
          </button>
        </div>
      </form>
    </Tarjeta>
  );
}

/** Valor derivado, de solo lectura, alineado como los montos. */
function Calculado({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div>
      <span className={claseEtiqueta}>{etiqueta}</span>
      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-right text-sm font-medium tabular-nums text-slate-900">
        {valor}
      </div>
    </div>
  );
}

function Campo({
  etiqueta,
  nombre,
  tipo = "text",
  paso,
  valor,
  requerido,
  numerico,
}: {
  etiqueta: string;
  nombre: string;
  tipo?: string;
  paso?: string;
  valor?: string;
  requerido?: boolean;
  numerico?: boolean;
}) {
  return (
    <label className="block">
      <span className={claseEtiqueta}>{etiqueta}</span>
      <input
        name={nombre}
        type={tipo}
        step={paso}
        defaultValue={valor}
        required={requerido}
        className={numerico ? `${campo} text-right tabular-nums` : campo}
      />
    </label>
  );
}
