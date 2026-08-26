/**
 * Genera las credenciales del stack de Supabase self-hosted.
 *
 *     node deploy/supabase/generar-claves.mjs
 *
 * Imprime las cuatro líneas que hay que pegar en el .env. No escribe ningún
 * archivo a propósito: así no queda una copia olvidada en el disco de trabajo
 * ni entra por descuido en un commit.
 *
 * ANON_KEY y SERVICE_ROLE_KEY no son claves aleatorias: son JWT firmados con
 * JWT_SECRET. Por eso los tres valores viajan juntos —si cambia el secreto,
 * las dos claves dejan de validar— y por eso el secreto nunca debe llegar al
 * navegador: quien lo tenga puede firmarse un token de service_role y leer la
 * contabilidad entera saltándose las políticas RLS.
 */

import { createHmac, randomBytes } from "node:crypto";

const base64url = (entrada) =>
  Buffer.from(entrada)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

function firmar(carga, secreto) {
  const cabecera = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const cuerpo = base64url(JSON.stringify(carga));
  const firma = createHmac("sha256", secreto)
    .update(`${cabecera}.${cuerpo}`)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `${cabecera}.${cuerpo}.${firma}`;
}

const AHORA = Math.floor(Date.now() / 1000);
const DIEZ_ANIOS = 60 * 60 * 24 * 365 * 10;

const jwtSecret = randomBytes(32).toString("hex");
// La contraseña va dentro de cadenas de conexión (postgres://usuario:clave@…),
// así que se limita a caracteres que no hay que escapar en una URL.
const postgresPassword = randomBytes(24).toString("base64url");

const clave = (rol) =>
  firmar({ role: rol, iss: "supabase", iat: AHORA, exp: AHORA + DIEZ_ANIOS }, jwtSecret);

console.log(`
Pega estas líneas en deploy/supabase/.env

POSTGRES_PASSWORD=${postgresPassword}
JWT_SECRET=${jwtSecret}
ANON_KEY=${clave("anon")}
SERVICE_ROLE_KEY=${clave("service_role")}

En la aplicación (variables de Coolify, y como build args del Dockerfile):

  NEXT_PUBLIC_SUPABASE_ANON_KEY  ->  el ANON_KEY de arriba
  SUPABASE_SERVICE_ROLE_KEY      ->  el SERVICE_ROLE_KEY de arriba

Las claves caducan el ${new Date((AHORA + DIEZ_ANIOS) * 1000).toISOString().slice(0, 10)}.
`);
