import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Navegacion from "./navegacion";
import BarraSuperior from "./barra-superior";

// La fuente se descarga al compilar y se sirve desde el propio servidor: el
// navegador no le pide nada a Google.
const inter = Inter({ subsets: ["latin"], display: "swap", variable: "--fuente-inter" });

export const metadata: Metadata = {
  title: { default: "ContableMAP", template: "%s · ContableMAP" },
  description:
    "Contabilidad y tributación para Marco Antonio Posligua: ingesta por voz y documentos, clasificación asistida, estados financieros y declaraciones.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es" className={inter.variable}>
      <body className="min-h-screen bg-slate-50 font-sans text-slate-900 antialiased">
        {/* La barra lateral se coloca sola: en pantalla estrecha se despliega
            sobre el contenido y aquí no ocupa sitio; en escritorio es una
            columna fija que acompaña al desplazamiento. */}
        <div className="flex min-h-screen flex-col lg:flex-row">
          <Navegacion />
          <div className="flex min-w-0 flex-1 flex-col">
            <BarraSuperior />
            <main className="w-full min-w-0 flex-1 px-4 py-6 lg:px-8 lg:py-8">
              <div className="mx-auto w-full max-w-7xl">{children}</div>
            </main>
          </div>
        </div>
      </body>
    </html>
  );
}
