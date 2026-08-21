import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "ContableMAP",
  description:
    "Contabilidad y tributación para Marco Antonio Posligua: ingesta por voz y documentos, clasificación asistida, estados financieros y declaraciones.",
};

const SECCIONES = [
  { href: "/", texto: "Panel" },
  { href: "/ingesta", texto: "Ingresar datos" },
  { href: "/movimientos", texto: "Movimientos" },
  { href: "/comprobantes", texto: "Comprobantes" },
  { href: "/facturar", texto: "Facturar" },
  { href: "/cartera", texto: "Cartera" },
  { href: "/retenciones", texto: "Retenciones" },
  { href: "/informes", texto: "Informes" },
  { href: "/impuestos", texto: "Impuestos" },
  { href: "/ajustes", texto: "Ajustes" },
];

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">
        <div className="flex min-h-screen flex-col">
          <header className="border-b border-slate-200 bg-white">
            <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
              <Link href="/" className="text-lg font-semibold tracking-tight">
                Contable<span className="text-emerald-600">MAP</span>
              </Link>
              <nav className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
                {SECCIONES.map((s) => (
                  <Link
                    key={s.href}
                    href={s.href}
                    className="text-slate-600 transition-colors hover:text-emerald-700"
                  >
                    {s.texto}
                  </Link>
                ))}
              </nav>
            </div>
          </header>

          <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">{children}</main>

          <footer className="border-t border-slate-200 bg-white px-4 py-3 text-center text-xs text-slate-500">
            Los cálculos tributarios son una ayuda de gestión. Contrástalos con
            la normativa vigente del SRI antes de presentar cualquier declaración.
          </footer>
        </div>
      </body>
    </html>
  );
}
