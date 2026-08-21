import type { Metadata } from "next";
import "./globals.css";
import Navegacion from "./navegacion";

export const metadata: Metadata = {
  title: "ContableMAP",
  description:
    "Contabilidad y tributación para Marco Antonio Posligua: ingesta por voz y documentos, clasificación asistida, estados financieros y declaraciones.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">
        {/* La barra lateral se coloca sola: en pantalla estrecha se despliega
            sobre el contenido y aquí no ocupa sitio; en escritorio es una
            columna fija que acompaña al desplazamiento. */}
        <div className="flex min-h-screen flex-col lg:flex-row">
          <Navegacion />
          <main className="w-full min-w-0 flex-1 px-4 py-6 lg:px-8">
            <div className="mx-auto w-full max-w-6xl">{children}</div>
          </main>
        </div>
      </body>
    </html>
  );
}
