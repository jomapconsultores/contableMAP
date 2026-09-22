"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Eye, EyeOff, LoaderCircle } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Aviso, boton, campo, etiqueta } from "@/components/ui";

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
    // La navegación no se muestra aquí (sin sesión no hay a dónde ir), así
    // que la tarjeta se centra en todo el alto disponible.
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center py-8">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-600 text-lg font-bold text-white shadow-sm">
            M
          </span>
          <p className="mt-3 text-lg font-semibold tracking-tight text-slate-900">
            Contable<span className="text-emerald-600">MAP</span>
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">
            {modo === "entrar" ? "Inicia sesión" : "Crea tu cuenta"}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {modo === "entrar" ? "Entra con tu correo" : "Regístrate con tu correo"}
          </p>

          <form onSubmit={enviar} className="mt-6 space-y-4">
            <div>
              <label htmlFor="correo" className={etiqueta}>
                Correo
              </label>
              <input
                id="correo"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="tu@correo.com"
                className={campo}
              />
            </div>

            <div>
              <label htmlFor="clave" className={etiqueta}>
                Contraseña
              </label>
              <div className="relative">
                <input
                  id="clave"
                  type={verClave ? "text" : "password"}
                  required
                  minLength={8}
                  autoComplete={modo === "entrar" ? "current-password" : "new-password"}
                  value={clave}
                  onChange={(e) => setClave(e.target.value)}
                  className={`${campo} pr-10`}
                />
                <button
                  type="button"
                  onClick={() => setVerClave(!verClave)}
                  // Sin `type="button"` este control enviaría el formulario.
                  aria-label={verClave ? "Ocultar contraseña" : "Mostrar contraseña"}
                  aria-pressed={verClave}
                  title={verClave ? "Ocultar contraseña" : "Mostrar contraseña"}
                  className="absolute inset-y-0 right-0 flex items-center rounded-r-lg px-3 text-slate-400 transition-colors hover:text-slate-700 focus:outline-none focus-visible:text-emerald-600"
                >
                  {verClave ? <EyeOff size={18} aria-hidden /> : <Eye size={18} aria-hidden />}
                </button>
              </div>
              {modo === "registrar" && (
                <p className="mt-1.5 text-xs text-slate-400">Mínimo 8 caracteres.</p>
              )}
            </div>

            {error && <Aviso tono="peligro">{error}</Aviso>}
            {mensaje && <Aviso tono="exito">{mensaje}</Aviso>}

            <button
              type="submit"
              disabled={cargando}
              className={`${boton("primario")} h-10 w-full`}
            >
              {cargando && <LoaderCircle size={16} className="animate-spin" />}
              {cargando ? "Un momento…" : modo === "entrar" ? "Entrar" : "Registrarme"}
            </button>
          </form>
        </div>

        <p className="mt-5 text-center text-sm text-slate-500">
          {modo === "entrar" ? "¿Aún no tienes cuenta? " : "¿Ya tienes cuenta? "}
          <button
            onClick={() => {
              setModo(modo === "entrar" ? "registrar" : "entrar");
              setError(null);
              setMensaje(null);
            }}
            className="font-medium text-emerald-700 underline-offset-2 hover:underline"
          >
            {modo === "entrar" ? "Regístrate" : "Entra"}
          </button>
        </p>
      </div>
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
