"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowRightLeft,
  ChevronDown,
  FileSignature,
  LayoutDashboard,
  Menu,
  Percent,
  Receipt,
  ReceiptText,
  Scale,
  Settings,
  Upload,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";

/**
 * Navegación lateral.
 *
 * Los submenús solo apuntan a sitios que existen de verdad: o son secciones
 * con ancla dentro de la página, o un filtro que la página sabe leer de la
 * URL. Un submenú que no lleva a ninguna parte es peor que no tenerlo, porque
 * promete una pantalla que no está.
 *
 * En `/login` no se muestra: no hay a dónde navegar sin sesión.
 */

interface Entrada {
  href: string;
  texto: string;
  icono: LucideIcon;
  hijos?: { href: string; texto: string }[];
}

interface Grupo {
  titulo: string | null;
  entradas: Entrada[];
}

const GRUPOS: Grupo[] = [
  {
    titulo: null,
    entradas: [{ href: "/", texto: "Panel", icono: LayoutDashboard }],
  },
  {
    titulo: "Registrar",
    entradas: [
      {
        href: "/ingesta",
        texto: "Ingresar datos",
        icono: Upload,
        hijos: [
          { href: "/ingesta#voz", texto: "Por voz o texto" },
          { href: "/ingesta#documento", texto: "Por documento" },
        ],
      },
      { href: "/movimientos", texto: "Movimientos", icono: ArrowRightLeft },
    ],
  },
  {
    titulo: "Facturación",
    entradas: [
      {
        href: "/comprobantes",
        texto: "Comprobantes",
        icono: ReceiptText,
        hijos: [
          { href: "/comprobantes?clase=compras", texto: "Compras" },
          { href: "/comprobantes?clase=ventas", texto: "Ventas" },
        ],
      },
      { href: "/facturar", texto: "Facturar", icono: FileSignature },
      { href: "/retenciones", texto: "Retenciones", icono: Receipt },
      {
        href: "/cartera",
        texto: "Cartera",
        icono: Wallet,
        hijos: [
          { href: "/cartera#cobrar", texto: "Por cobrar" },
          { href: "/cartera#pagar", texto: "Por pagar" },
        ],
      },
    ],
  },
  {
    titulo: "Análisis",
    entradas: [
      {
        href: "/informes",
        texto: "Informes",
        icono: Scale,
        hijos: [
          { href: "/informes#resultados", texto: "Estado de resultados" },
          { href: "/informes#balance", texto: "Balance general" },
        ],
      },
      {
        href: "/impuestos",
        texto: "Impuestos",
        icono: Percent,
        hijos: [
          { href: "/impuestos#iva", texto: "IVA · formulario 104" },
          { href: "/impuestos#renta", texto: "Renta · formulario 102" },
        ],
      },
    ],
  },
  {
    titulo: "Configuración",
    entradas: [
      {
        href: "/ajustes",
        texto: "Ajustes",
        icono: Settings,
        hijos: [
          { href: "/ajustes#cuenta", texto: "Mi cuenta" },
          { href: "/ajustes#general", texto: "Entidad y cuentas" },
          { href: "/ajustes#facturacion", texto: "Facturación electrónica" },
        ],
      },
    ],
  },
];

/** La raíz solo está activa en la raíz; el resto, también en sus subrutas. */
const estaActiva = (href: string, ruta: string) =>
  href === "/" ? ruta === "/" : ruta === href || ruta.startsWith(`${href}/`);

export default function Navegacion() {
  const ruta = usePathname();
  const [abierto, setAbierto] = useState(false);
  // El panel móvil se cierra al pulsar un enlace, no observando la ruta: en
  // escritorio la barra es fija y este estado ni la toca.
  const cerrar = () => setAbierto(false);

  if (ruta.startsWith("/login")) return null;

  return (
    <>
      {/* Barra superior, solo en pantallas estrechas */}
      <div className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 lg:hidden">
        <button
          onClick={() => setAbierto(true)}
          aria-label="Abrir el menú"
          className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100"
        >
          <Menu size={20} />
        </button>
        <Link href="/" className="text-lg font-semibold tracking-tight">
          Contable<span className="text-emerald-600">MAP</span>
        </Link>
      </div>

      {abierto && (
        <button
          aria-label="Cerrar el menú"
          onClick={() => setAbierto(false)}
          className="fixed inset-0 z-30 bg-slate-900/40 lg:hidden"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col border-r border-slate-200 bg-white transition-transform lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 ${
          abierto ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-4">
          <Link href="/" onClick={cerrar} className="text-lg font-semibold tracking-tight">
            Contable<span className="text-emerald-600">MAP</span>
          </Link>
          <button
            onClick={cerrar}
            aria-label="Cerrar el menú"
            className="rounded-md p-1 text-slate-500 hover:bg-slate-100 lg:hidden"
          >
            <X size={18} />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4">
          {GRUPOS.map((grupo, i) => (
            <div key={grupo.titulo ?? i} className={i > 0 ? "mt-5" : undefined}>
              {grupo.titulo && (
                <h2 className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  {grupo.titulo}
                </h2>
              )}
              <ul className="space-y-0.5">
                {grupo.entradas.map((entrada) => {
                  const activa = estaActiva(entrada.href, ruta);
                  // La clave incluye si está activa: al cambiar de sección el
                  // ítem se vuelve a montar y su submenú recupera el estado
                  // que le corresponde sin sincronizarlo a mano.
                  return (
                    <Entradilla
                      key={`${entrada.href}:${activa}`}
                      entrada={entrada}
                      activa={activa}
                      alNavegar={cerrar}
                    />
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <p className="border-t border-slate-200 px-4 py-3 text-[11px] leading-relaxed text-slate-400">
          Los cálculos tributarios son una ayuda de gestión. Contrástalos con la
          normativa vigente del SRI.
        </p>
      </aside>
    </>
  );
}

function Entradilla({
  entrada,
  activa,
  alNavegar,
}: {
  entrada: Entrada;
  activa: boolean;
  alNavegar: () => void;
}) {
  // El submenú de la sección en la que estás aparece abierto; mientras no lo
  // toques, se deduce de dónde estás en vez de guardarse por duplicado.
  const [manual, setManual] = useState<boolean | null>(null);
  const desplegado = manual ?? activa;
  const Icono = entrada.icono;

  return (
    <li>
      <div className="flex items-center">
        <Link
          href={entrada.href}
          onClick={alNavegar}
          className={`flex flex-1 items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors ${
            activa
              ? "bg-emerald-50 font-medium text-emerald-800"
              : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
          }`}
        >
          <Icono size={17} className={activa ? "text-emerald-700" : "text-slate-400"} />
          {entrada.texto}
        </Link>

        {entrada.hijos && (
          <button
            onClick={() => setManual(!desplegado)}
            aria-label={`${desplegado ? "Contraer" : "Desplegar"} ${entrada.texto}`}
            aria-expanded={desplegado}
            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <ChevronDown
              size={15}
              className={`transition-transform ${desplegado ? "" : "-rotate-90"}`}
            />
          </button>
        )}
      </div>

      {entrada.hijos && desplegado && (
        <ul className="mt-0.5 ml-[26px] space-y-0.5 border-l border-slate-200 pl-3">
          {entrada.hijos.map((hijo) => (
            <li key={hijo.href}>
              <Link
                href={hijo.href}
                onClick={alNavegar}
                className="block rounded-md px-2.5 py-1.5 text-[13px] text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
              >
                {hijo.texto}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
