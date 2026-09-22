"use client";

import { useCallback, useState } from "react";
import { useCarga } from "@/lib/carga";
import { Aviso, Esqueleto, Tarjeta, boton, campo, etiqueta } from "@/components/ui";

interface Perfil {
  email: string;
  nombre: string;
  telefono: string;
  cargo: string;
}

const VACIO: Perfil = { email: "", nombre: "", telefono: "", cargo: "" };

/** Texto de ayuda bajo un campo. */
const AYUDA = "mt-1.5 text-xs text-slate-500";

/** Título de cada bloque dentro de la tarjeta. */
const SUBTITULO = "text-xs font-semibold uppercase tracking-wider text-slate-500 sm:col-span-2";

export default function MiCuenta() {
  const [perfil, setPerfil] = useState<Perfil>(VACIO);
  const [cargando, setCargando] = useState(true);

  const pedir = useCallback(
    () => fetch("/api/cuenta").then((r) => r.json()),
    [],
  );

  const aplicar = useCallback((r: { ok: boolean; datos?: Perfil } | Error) => {
    if (!(r instanceof Error) && r.ok && r.datos) setPerfil(r.datos);
    setCargando(false);
  }, []);

  useCarga(pedir, aplicar);

  return (
    <Tarjeta
      titulo="Mi cuenta"
      descripcion="Tus datos y tu contraseña. No afectan a la contabilidad de la entidad."
    >
      {cargando ? (
        <div className="grid gap-8 lg:grid-cols-2" aria-busy="true" aria-label="Cargando">
          {[0, 1].map((i) => (
            <div key={i} className="space-y-3">
              <Esqueleto className="h-3 w-32" />
              <Esqueleto className="h-9 w-full" />
              <Esqueleto className="h-9 w-full" />
              <Esqueleto className="h-9 w-2/3" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid gap-8 lg:grid-cols-2 lg:divide-x lg:divide-slate-100">
          <DatosPersonales perfil={perfil} alGuardar={setPerfil} />
          <div className="lg:pl-8">
            <CambiarClave />
          </div>
        </div>
      )}
    </Tarjeta>
  );
}

function DatosPersonales({
  perfil,
  alGuardar,
}: {
  perfil: Perfil;
  alGuardar: (p: Perfil) => void;
}) {
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hecho, setHecho] = useState(false);

  async function guardar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setOcupado(true);
    setError(null);
    setHecho(false);
    const f = new FormData(e.currentTarget);

    const res = await fetch("/api/cuenta", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nombre: f.get("nombre"),
        telefono: f.get("telefono"),
        cargo: f.get("cargo"),
      }),
    });
    const json = await res.json();
    setOcupado(false);

    if (!json.ok) {
      setError(json.error);
      return;
    }
    alGuardar(json.datos as Perfil);
    setHecho(true);
  }

  return (
    <form onSubmit={guardar} className="grid content-start gap-4 sm:grid-cols-2">
      <h3 className={SUBTITULO}>Datos personales</h3>

      <div className="sm:col-span-2">
        <label htmlFor="cuenta-email" className={etiqueta}>
          Correo
        </label>
        <input id="cuenta-email" value={perfil.email} disabled className={campo} />
        <p className={AYUDA}>El correo de acceso no se cambia desde aquí.</p>
      </div>

      <div className="sm:col-span-2">
        <label htmlFor="cuenta-nombre" className={etiqueta}>
          Nombre completo
        </label>
        <input
          id="cuenta-nombre"
          name="nombre"
          defaultValue={perfil.nombre}
          required
          maxLength={120}
          autoComplete="name"
          className={campo}
        />
      </div>

      <div>
        <label htmlFor="cuenta-telefono" className={etiqueta}>
          Teléfono
        </label>
        <input
          id="cuenta-telefono"
          name="telefono"
          type="tel"
          defaultValue={perfil.telefono}
          placeholder="09XXXXXXXX"
          autoComplete="tel"
          className={campo}
        />
      </div>

      <div>
        <label htmlFor="cuenta-cargo" className={etiqueta}>
          Cargo
        </label>
        <input
          id="cuenta-cargo"
          name="cargo"
          defaultValue={perfil.cargo}
          maxLength={80}
          className={campo}
        />
      </div>

      {error && (
        <div className="sm:col-span-2">
          <Aviso tono="peligro">{error}</Aviso>
        </div>
      )}
      {hecho && (
        <div className="sm:col-span-2">
          <Aviso tono="exito">Datos guardados.</Aviso>
        </div>
      )}

      <div className="sm:col-span-2">
        <button type="submit" disabled={ocupado} className={boton("primario")}>
          {ocupado ? "Guardando…" : "Guardar datos"}
        </button>
      </div>
    </form>
  );
}

function CambiarClave() {
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hecho, setHecho] = useState(false);

  async function cambiar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formulario = e.currentTarget;
    const f = new FormData(formulario);

    if (f.get("nueva") !== f.get("repetir")) {
      setError("La contraseña nueva y su repetición no coinciden.");
      setHecho(false);
      return;
    }

    setOcupado(true);
    setError(null);
    setHecho(false);

    const res = await fetch("/api/cuenta/clave", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actual: f.get("actual"), nueva: f.get("nueva") }),
    });
    const json = await res.json();
    setOcupado(false);

    if (!json.ok) {
      setError(json.error);
      return;
    }
    formulario.reset();
    setHecho(true);
  }

  return (
    <form onSubmit={cambiar} className="grid content-start gap-4 sm:grid-cols-2">
      <h3 className={SUBTITULO}>Cambiar contraseña</h3>

      <div className="sm:col-span-2">
        <label htmlFor="clave-actual" className={etiqueta}>
          Contraseña actual
        </label>
        <input
          id="clave-actual"
          name="actual"
          type="password"
          required
          autoComplete="current-password"
          className={campo}
        />
      </div>

      <div>
        <label htmlFor="clave-nueva" className={etiqueta}>
          Contraseña nueva
        </label>
        <input
          id="clave-nueva"
          name="nueva"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          aria-describedby="clave-nueva-ayuda"
          className={campo}
        />
        <p id="clave-nueva-ayuda" className={AYUDA}>
          Mínimo 8 caracteres.
        </p>
      </div>

      <div>
        <label htmlFor="clave-repetir" className={etiqueta}>
          Repetir la nueva
        </label>
        <input
          id="clave-repetir"
          name="repetir"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          className={campo}
        />
      </div>

      {error && (
        <div className="sm:col-span-2">
          <Aviso tono="peligro">{error}</Aviso>
        </div>
      )}
      {hecho && (
        <div className="sm:col-span-2">
          <Aviso tono="exito">Contraseña cambiada. La próxima vez entra con la nueva.</Aviso>
        </div>
      )}

      <div className="sm:col-span-2">
        <button type="submit" disabled={ocupado} className={boton("primario")}>
          {ocupado ? "Cambiando…" : "Cambiar contraseña"}
        </button>
      </div>
    </form>
  );
}
