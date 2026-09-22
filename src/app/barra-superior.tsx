import Link from "next/link";
import { LogOut, Plus } from "lucide-react";
import { supabaseServer, usuarioActual } from "@/lib/supabase/server";
import { boton } from "@/components/ui";

/**
 * Barra superior de escritorio: de quién es la contabilidad, con qué cuenta
 * se entró y cómo salir. Sin sesión (la pantalla de ingreso) no se muestra.
 * En móvil la sustituye la barra de la navegación, que ya lleva el menú.
 */
export default async function BarraSuperior() {
  const usuario = await usuarioActual();
  if (!usuario) return null;

  const sb = await supabaseServer();
  const { data: entidad } = await sb
    .from("entidades")
    .select("razon_social, ruc")
    .eq("activo", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  return (
    <div className="sticky top-0 z-20 hidden h-14 items-center justify-between gap-4 border-b border-slate-200 bg-white/90 px-8 backdrop-blur lg:flex">
      <div className="min-w-0 text-sm">
        {entidad ? (
          <>
            <span className="font-medium text-slate-900">{entidad.razon_social}</span>
            <span className="ml-2 text-slate-400">RUC {entidad.ruc}</span>
          </>
        ) : (
          <span className="text-slate-500">Sin entidad configurada</span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Link href="/ingesta" className={boton("primario", "sm")}>
          <Plus size={15} /> Ingresar datos
        </Link>
        <span className="mx-2 h-5 w-px bg-slate-200" />
        <span className="hidden text-xs text-slate-500 xl:inline">{usuario.email}</span>
        <form action="/auth/salir" method="post">
          <button type="submit" className={boton("fantasma", "sm")} title="Cerrar sesión">
            <LogOut size={15} /> Salir
          </button>
        </form>
      </div>
    </div>
  );
}
