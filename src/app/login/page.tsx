"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Eye, EyeOff } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";

function Formulario() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [clave, setClave] = useState("");
  const [verClave, setVerClave] = useState(false);
  const [modo, setModo] = useState<"entrar" | "registrar">("entrar");
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMensaje(null);
    setCargando(true);

    const sb = supabaseBrowser();
    const { error } =
      modo === "entrar"
        ? await sb.auth.signInWithPassword({ email, password: clave })
        : await sb.auth.signUp({ email, password: clave });

    setCargando(false);

    if (error) {
      setError(error.message);
      return;
    }

    if (modo === "registrar") {
      setMensaje(
        "Cuenta creada. Si tu proyecto exige confirmar el correo, revisa la bandeja antes de entrar.",
      );
      return;
    }

    router.replace(params.get("redirect") ?? "/");
    router.refresh();
  }

  return (
    <div className="mx-auto mt-16 max-w-sm rounded-lg border border-slate-200 bg-white p-6">
      <h1 className="text-xl font-semibold">
        Contable<span className="text-emerald-600">MAP</span>
      </h1>
      <p className="mt-1 text-sm text-slate-500">
        {modo === "entrar" ? "Entra con tu correo" : "Crea tu cuenta"}
      </p>

      <form onSubmit={enviar} className="mt-5 space-y-3">
        <label className="block">
          <span className="text-sm text-slate-700">Correo</span>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500"
          />
        </label>

        <label className="block">
          <span className="text-sm text-slate-700">Contraseña</span>
          <div className="relative mt-1">
            <input
              type={verClave ? "text" : "password"}
              required
              minLength={8}
              autoComplete={modo === "entrar" ? "current-password" : "new-password"}
              value={clave}
              onChange={(e) => setClave(e.target.value)}
              className="w-full rounded-md border border-slate-300 py-2 pl-3 pr-10 text-sm outline-none focus:border-emerald-500"
            />
            <button
              type="button"
              onClick={() => setVerClave(!verClave)}
              // Sin `type="button"` este control enviaría el formulario.
              aria-label={verClave ? "Ocultar contraseña" : "Mostrar contraseña"}
              aria-pressed={verClave}
              title={verClave ? "Ocultar contraseña" : "Mostrar contraseña"}
              className="absolute inset-y-0 right-0 flex items-center rounded-r-md px-3 text-slate-400 transition-colors hover:text-slate-700 focus:outline-none focus-visible:text-emerald-600"
            >
              {verClave ? <EyeOff size={18} aria-hidden /> : <Eye size={18} aria-hidden />}
            </button>
          </div>
        </label>

        {error && (
          <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>
        )}
        {mensaje && (
          <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {mensaje}
          </p>
        )}

        <button
          type="submit"
          disabled={cargando}
          className="w-full rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
        >
          {cargando ? "Un momento…" : modo === "entrar" ? "Entrar" : "Registrarme"}
        </button>
      </form>

      <button
        onClick={() => {
          setModo(modo === "entrar" ? "registrar" : "entrar");
          setError(null);
          setMensaje(null);
        }}
        className="mt-4 text-sm text-slate-500 underline hover:text-slate-700"
      >
        {modo === "entrar" ? "No tengo cuenta" : "Ya tengo cuenta"}
      </button>
    </div>
  );
}

export default function Login() {
  return (
    <Suspense>
      <Formulario />
    </Suspense>
  );
}
