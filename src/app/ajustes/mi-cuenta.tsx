"use client";

import { useCallback, useState } from "react";
import { useCarga } from "@/lib/carga";

interface Perfil {
  email: string;
  nombre: string;
  telefono: string;
  cargo: string;
}

const VACIO: Perfil = { email: "", nombre: "", telefono: "", cargo: "" };

const CAMPO =
  "mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500";

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
    <section className="rounded-lg border border-slate-200 bg-white p-5">
      <h2 className="font-medium">Mi cuenta</h2>
      <p className="mt-1 text-sm text-slate-500">
        Tus datos y tu contraseña. No afectan a la contabilidad de la entidad.
      </p>

      {cargando ? (
        <p className="mt-4 text-sm text-slate-500">Cargando…</p>
      ) : (
        <div className="mt-4 grid gap-6 lg:grid-cols-2">
          <DatosPersonales perfil={perfil} alGuardar={setPerfil} />
          <CambiarClave />
        </div>
      )}
    </section>
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
    <form onSubmit={guardar} className="grid gap-3 content-start">
      <h3 className="text-sm font-medium text-slate-700">Datos personales</h3>

      <label className="block text-sm">
        <span className="text-slate-700">Correo</span>
        <input value={perfil.email} disabled className={`${CAMPO} bg-slate-50 text-slate-500`} />
        <span className="mt-1 block text-xs text-slate-500">
          El correo de acceso no se cambia desde aquí.
        </span>
      </label>

      <label className="block text-sm">
        <span className="text-slate-700">Nombre completo</span>
        <input name="nombre" defaultValue={perfil.nombre} required maxLength={120} className={CAMPO} />
      </label>

      <label className="block text-sm">
        <span className="text-slate-700">Teléfono</span>
        <input
          name="telefono"
          type="tel"
          defaultValue={perfil.telefono}
          placeholder="09XXXXXXXX"
          className={CAMPO}
        />
      </label>

      <label className="block text-sm">
        <span className="text-slate-700">Cargo</span>
        <input name="cargo" defaultValue={perfil.cargo} maxLength={80} className={CAMPO} />
      </label>

      {error && (
        <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>
      )}
      {hecho && (
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Datos guardados.
        </p>
      )}

      <button
        type="submit"
        disabled={ocupado}
        className="justify-self-start rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
      >
        {ocupado ? "Guardando…" : "Guardar datos"}
      </button>
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
    <form onSubmit={cambiar} className="grid gap-3 content-start">
      <h3 className="text-sm font-medium text-slate-700">Cambiar contraseña</h3>

      <label className="block text-sm">
        <span className="text-slate-700">Contraseña actual</span>
        <input
          name="actual"
          type="password"
          required
          autoComplete="current-password"
          className={CAMPO}
        />
      </label>

      <label className="block text-sm">
        <span className="text-slate-700">Contraseña nueva</span>
        <input
          name="nueva"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          className={CAMPO}
        />
        <span className="mt-1 block text-xs text-slate-500">Mínimo 8 caracteres.</span>
      </label>

      <label className="block text-sm">
        <span className="text-slate-700">Repetir la nueva</span>
        <input
          name="repetir"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          className={CAMPO}
        />
      </label>

      {error && (
        <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>
      )}
      {hecho && (
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Contraseña cambiada. La próxima vez entra con la nueva.
        </p>
      )}

      <button
        type="submit"
        disabled={ocupado}
        className="justify-self-start rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
      >
        {ocupado ? "Cambiando…" : "Cambiar contraseña"}
      </button>
    </form>
  );
}
