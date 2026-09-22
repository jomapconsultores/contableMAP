import Link from "next/link";
import type { LucideIcon } from "lucide-react";

/**
 * Piezas de interfaz comunes a todas las pantallas.
 *
 * Antes cada página dibujaba sus botones, tarjetas y avisos con sus propias
 * clases, y la misma cosa se veía distinta en cada sitio. Aquí vive la única
 * versión de cada pieza: si hay que cambiar cómo se ve un botón, se cambia una
 * vez. Son componentes de presentación, sin estado, así que sirven tanto en
 * componentes de servidor como de cliente.
 */

// ---------------------------------------------------------------------------
// Clases de controles nativos
// ---------------------------------------------------------------------------

type Variante = "primario" | "secundario" | "fantasma" | "peligro";
type Tamano = "sm" | "md";

const VARIANTES: Record<Variante, string> = {
  primario:
    "bg-emerald-600 text-white shadow-sm hover:bg-emerald-700 focus-visible:outline-emerald-600",
  secundario:
    "border border-slate-300 bg-white text-slate-700 shadow-sm hover:bg-slate-50 focus-visible:outline-slate-400",
  fantasma: "text-slate-600 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-slate-400",
  peligro: "bg-rose-600 text-white shadow-sm hover:bg-rose-700 focus-visible:outline-rose-600",
};

const TAMANOS: Record<Tamano, string> = {
  sm: "h-8 gap-1.5 px-3 text-xs",
  md: "h-9 gap-2 px-3.5 text-sm",
};

/** Clases de un botón, para `<button>` o `<Link>`. */
export function boton(variante: Variante = "secundario", tamano: Tamano = "md") {
  return `inline-flex shrink-0 items-center justify-center rounded-lg font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 disabled:pointer-events-none disabled:opacity-50 ${VARIANTES[variante]} ${TAMANOS[tamano]}`;
}

/**
 * Clases de `<input>`, `<select>` y `<textarea>`.
 *
 * Trae ancho, relleno, tamaño de letra, borde y fondo. Para cambiar cualquiera
 * de ellos en un campo concreto hay que marcar la clase con `!` (`w-48!`,
 * `py-1.5!`, `bg-amber-50!`): dos clases de la misma propiedad en un elemento
 * no se resuelven por el orden en que se escriben, y sin la marca puede ganar
 * la de aquí.
 */
export const campo =
  "block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 disabled:bg-slate-50 disabled:text-slate-500";

/** Etiqueta de un campo de formulario. */
export const etiqueta = "mb-1.5 block text-xs font-medium text-slate-600";

// ---------------------------------------------------------------------------
// Estructura de página
// ---------------------------------------------------------------------------

export function Encabezado({
  titulo,
  descripcion,
  acciones,
  antetitulo,
}: {
  titulo: React.ReactNode;
  descripcion?: React.ReactNode;
  acciones?: React.ReactNode;
  antetitulo?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {antetitulo && (
          <p className="mb-1 text-xs font-medium uppercase tracking-wider text-emerald-700">
            {antetitulo}
          </p>
        )}
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{titulo}</h1>
        {descripcion && <p className="mt-1 max-w-3xl text-sm text-slate-500">{descripcion}</p>}
      </div>
      {acciones && <div className="flex flex-wrap items-center gap-2">{acciones}</div>}
    </header>
  );
}

export function Tarjeta({
  titulo,
  descripcion,
  acciones,
  children,
  sinRelleno,
  id,
  className = "",
}: {
  titulo?: React.ReactNode;
  descripcion?: React.ReactNode;
  acciones?: React.ReactNode;
  children: React.ReactNode;
  /** Para tablas que deben llegar hasta el borde. */
  sinRelleno?: boolean;
  id?: string;
  className?: string;
}) {
  return (
    <section
      id={id}
      className={`scroll-mt-20 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}
    >
      {(titulo || acciones) && (
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div className="min-w-0">
            {titulo && <h2 className="text-sm font-semibold text-slate-900">{titulo}</h2>}
            {descripcion && <p className="mt-0.5 text-xs text-slate-500">{descripcion}</p>}
          </div>
          {acciones && <div className="flex flex-wrap items-center gap-2">{acciones}</div>}
        </div>
      )}
      <div className={sinRelleno ? "" : "p-5"}>{children}</div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Indicadores
// ---------------------------------------------------------------------------

export type Tono = "neutro" | "exito" | "aviso" | "peligro" | "info";

const TONO_TEXTO: Record<Tono, string> = {
  neutro: "text-slate-900",
  exito: "text-emerald-700",
  aviso: "text-amber-700",
  peligro: "text-rose-700",
  info: "text-sky-700",
};

const TONO_ICONO: Record<Tono, string> = {
  neutro: "bg-slate-100 text-slate-600",
  exito: "bg-emerald-50 text-emerald-700",
  aviso: "bg-amber-50 text-amber-700",
  peligro: "bg-rose-50 text-rose-700",
  info: "bg-sky-50 text-sky-700",
};

/** Cifra destacada: un total, un saldo, un impuesto. */
export function Indicador({
  etiqueta: texto,
  valor,
  detalle,
  tono = "neutro",
  icono: Icono,
  href,
}: {
  etiqueta: string;
  valor: React.ReactNode;
  detalle?: React.ReactNode;
  tono?: Tono;
  icono?: LucideIcon;
  href?: string;
}) {
  const cuerpo = (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-xs font-medium text-slate-500">{texto}</p>
        <p className={`mt-1.5 text-xl font-semibold tabular-nums tracking-tight ${TONO_TEXTO[tono]}`}>
          {valor}
        </p>
        {detalle && <p className="mt-1 text-xs text-slate-400">{detalle}</p>}
      </div>
      {Icono && (
        <span className={`rounded-lg p-2 ${TONO_ICONO[tono]}`}>
          <Icono size={18} />
        </span>
      )}
    </div>
  );
  const clase =
    "block rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-colors";
  return href ? (
    <Link href={href} className={`${clase} hover:border-emerald-300 hover:bg-emerald-50/30`}>
      {cuerpo}
    </Link>
  ) : (
    <div className={clase}>{cuerpo}</div>
  );
}

const TONO_INSIGNIA: Record<Tono, string> = {
  neutro: "bg-slate-100 text-slate-700 ring-slate-500/10",
  exito: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  aviso: "bg-amber-50 text-amber-800 ring-amber-600/20",
  peligro: "bg-rose-50 text-rose-700 ring-rose-600/20",
  info: "bg-sky-50 text-sky-700 ring-sky-600/20",
};

export function Insignia({ tono = "neutro", children }: { tono?: Tono; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TONO_INSIGNIA[tono]}`}
    >
      {children}
    </span>
  );
}

const TONO_AVISO: Record<Exclude<Tono, "neutro">, string> = {
  exito: "border-emerald-200 bg-emerald-50 text-emerald-900",
  aviso: "border-amber-200 bg-amber-50 text-amber-900",
  peligro: "border-rose-200 bg-rose-50 text-rose-900",
  info: "border-sky-200 bg-sky-50 text-sky-900",
};

export function Aviso({
  tono = "info",
  titulo,
  children,
  acciones,
}: {
  tono?: Exclude<Tono, "neutro">;
  titulo?: React.ReactNode;
  children?: React.ReactNode;
  acciones?: React.ReactNode;
}) {
  return (
    <div
      role={tono === "peligro" ? "alert" : "status"}
      className={`flex flex-wrap items-start justify-between gap-3 rounded-lg border px-4 py-3 text-sm ${TONO_AVISO[tono]}`}
    >
      <div className="min-w-0">
        {titulo && <p className="font-medium">{titulo}</p>}
        {children && <div className={titulo ? "mt-0.5 opacity-90" : ""}>{children}</div>}
      </div>
      {acciones && <div className="flex shrink-0 gap-2">{acciones}</div>}
    </div>
  );
}

/** Lo que se muestra cuando una lista no tiene nada. */
export function Vacio({
  icono: Icono,
  titulo,
  descripcion,
  accion,
}: {
  icono?: LucideIcon;
  titulo: string;
  descripcion?: React.ReactNode;
  accion?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      {Icono && (
        <span className="mb-3 rounded-full bg-slate-100 p-3 text-slate-400">
          <Icono size={22} />
        </span>
      )}
      <p className="text-sm font-medium text-slate-900">{titulo}</p>
      {descripcion && <p className="mt-1 max-w-sm text-sm text-slate-500">{descripcion}</p>}
      {accion && <div className="mt-4">{accion}</div>}
    </div>
  );
}

/** Marcador gris mientras llega el dato. */
export function Esqueleto({ className = "h-4 w-full" }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-slate-200/70 ${className}`} />;
}

// ---------------------------------------------------------------------------
// Tablas
// ---------------------------------------------------------------------------

export const tabla = {
  contenedor: "overflow-x-auto",
  tabla: "w-full text-sm",
  cabecera:
    "sticky top-0 z-10 bg-slate-50/95 text-left text-xs font-medium text-slate-500 backdrop-blur",
  th: "whitespace-nowrap px-4 py-2.5 font-medium",
  cuerpo: "divide-y divide-slate-100",
  fila: "transition-colors hover:bg-slate-50/80",
  td: "px-4 py-2.5 align-middle",
  numero: "whitespace-nowrap text-right tabular-nums",
};
