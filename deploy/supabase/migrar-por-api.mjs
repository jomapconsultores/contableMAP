/**
 * Migración sin tocar el proyecto de origen.
 *
 *     node deploy/supabase/migrar-por-api.mjs
 *
 * Lee `deploy/supabase/.env.origen` (ORIGEN_URL y ORIGEN_SERVICE_KEY) y vuelca
 * la contabilidad al servidor propio. El origen solo se consulta por su API con
 * la clave de servicio que ya existe: no hace falta la contraseña de Postgres,
 * no se restablece nada y ninguna conexión se rompe.
 *
 * Cómo funciona, y por qué así:
 *
 *   1. El esquema lo crean las once migraciones del repositorio, que ya están
 *      verificadas contra PostgreSQL real (`npm run test:db`, 48 comprobaciones).
 *      La API no expone el DDL, pero el DDL ya lo tenemos en git.
 *
 *   2. Los datos se leen tabla por tabla con PostgREST y se escriben con
 *      `json_populate_recordset`, que convierte cada fila JSON al tipo exacto
 *      de la tabla destino. Así no hay que construir INSERT columna a columna
 *      ni adivinar conversiones de fechas, numéricos o enumerados.
 *
 *   3. Durante la carga, el destino trabaja con `session_replication_role =
 *      replica`: sin triggers ni comprobación de claves foráneas. Las
 *      validaciones de cuadre ya se aplicaron cuando el asiento se creó, y el
 *      orden de las tablas deja de importar.
 *
 *   4. Al final se recolocan las secuencias y se comparan los recuentos de
 *      filas contra el origen, tabla por tabla.
 *
 * Lo que esta vía NO puede traer: los hashes de las contraseñas. La API de
 * usuarios no los expone. Los usuarios se recrean con su mismo correo y su
 * mismo identificador —que es lo que las políticas RLS necesitan—, pero
 * tendrán que establecer contraseña de nuevo.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const RAIZ = "deploy/supabase";
const SERVIDOR = "root@178.104.101.84";
const CLAVE_SSH = `${process.env.HOME || process.env.USERPROFILE}/.ssh/atlas_deploy`;
const CONTENEDOR = "contable-supabase-db-1";

// --- utilidades ------------------------------------------------------------

function leerEnv(ruta) {
  const texto = readFileSync(ruta, "utf8");
  const pares = {};
  for (const linea of texto.split(/\r?\n/)) {
    const limpia = linea.trim();
    if (!limpia || limpia.startsWith("#")) continue;
    const corte = limpia.indexOf("=");
    if (corte < 1) continue;
    pares[limpia.slice(0, corte)] = limpia.slice(corte + 1).trim();
  }
  return pares;
}

/** Ejecuta SQL en el destino a través de SSH. El Postgres nuevo no expone
 *  puerto al exterior a propósito: se le habla por el contenedor. */
function sql(consulta, { silencioso = false } = {}) {
  const salida = execFileSync(
    "ssh",
    ["-i", CLAVE_SSH, "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=no",
     "-o", "LogLevel=ERROR", SERVIDOR,
     `docker exec -i ${CONTENEDOR} psql -U postgres -v ON_ERROR_STOP=1 -tA${silencioso ? " -q" : ""}`],
    { input: consulta, encoding: "utf8", maxBuffer: 1024 * 1024 * 512 },
  );
  return salida.trim();
}

/** Sube un archivo al servidor. */
function subir(rutaLocal, rutaRemota) {
  execFileSync("scp", ["-i", CLAVE_SSH, "-o", "BatchMode=yes",
    "-o", "StrictHostKeyChecking=no", "-o", "LogLevel=ERROR",
    rutaLocal, `${SERVIDOR}:${rutaRemota}`], { stdio: "inherit" });
}

const origen = leerEnv(`${RAIZ}/.env.origen`);
const URL_ORIGEN = origen.ORIGEN_URL?.replace(/\/$/, "");
const CLAVE_ORIGEN = origen.ORIGEN_SERVICE_KEY;

if (!URL_ORIGEN || !CLAVE_ORIGEN) {
  console.error(`Faltan ORIGEN_URL u ORIGEN_SERVICE_KEY en ${RAIZ}/.env.origen`);
  process.exit(1);
}

const cabeceras = {
  apikey: CLAVE_ORIGEN,
  Authorization: `Bearer ${CLAVE_ORIGEN}`,
};

// --- 0 · comprobar el origen ----------------------------------------------

console.log("=== 0/5 · Comprobando el acceso al origen ===");
const sonda = await fetch(`${URL_ORIGEN}/rest/v1/`, { headers: cabeceras });
if (!sonda.ok) {
  console.error(`  El origen respondió ${sonda.status}. La clave de servicio no es válida.`);
  process.exit(1);
}
const swagger = await sonda.json();
const TABLAS = Object.keys(swagger.definitions ?? {}).sort();
console.log(`  Acceso correcto. ${TABLAS.length} tablas y vistas expuestas.`);

// --- 1 · esquema en el destino --------------------------------------------

console.log("\n=== 1/5 · Creando el esquema con las once migraciones ===");
const yaHayTablas = Number(sql("select count(*) from information_schema.tables where table_schema='public'"));
if (yaHayTablas > 0) {
  console.log(`  El destino ya tiene ${yaHayTablas} tablas: no se vuelve a crear.`);
} else {
  const migraciones = [
    "0001_core", "0002_contabilidad", "0003_documentos", "0004_tributario",
    "0005_cartera", "0006_declaraciones", "0007_rls", "0008_seed",
    "0009_estados_financieros", "0010_dedup_documentos", "0011_facturacion_electronica",
  ];
  for (const nombre of migraciones) {
    const cuerpo = readFileSync(`supabase/migrations/${nombre}.sql`, "utf8");
    sql(cuerpo, { silencioso: true });
    console.log(`  ✓ ${nombre}`);
  }
}

// Las tablas reales del destino: solo estas se pueden cargar.
const TABLAS_DESTINO = new Set(
  sql(`select table_name from information_schema.tables
       where table_schema='public' and table_type='BASE TABLE'`).split("\n").filter(Boolean),
);

// --- 2 · usuarios ----------------------------------------------------------

console.log("\n=== 2/5 · Trayendo los usuarios ===");
const respUsuarios = await fetch(`${URL_ORIGEN}/auth/v1/admin/users?per_page=200`, { headers: cabeceras });
const { users = [] } = await respUsuarios.json();
console.log(`  ${users.length} usuarios en el origen.`);

// Se insertan directamente en auth.users conservando el id: las políticas RLS
// cuelgan de entidades.user_id, así que el identificador debe ser el mismo.
// La contraseña queda vacía y cada usuario la establecerá con «he olvidado mi
// contraseña»: el hash no viaja por la API.
for (const u of users) {
  const correo = u.email.replace(/'/g, "''");
  // Los campos de token van a cadena vacía, nunca a NULL: GoTrue los lee como
  // texto plano y un NULL le hace responder «Database error loading user» —
  // el usuario existe, pero no puede autenticarse.
  sql(`
    insert into auth.users (
      instance_id, id, aud, role, email, email_confirmed_at,
      created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
      is_super_admin, is_sso_user, is_anonymous,
      confirmation_token, recovery_token, email_change,
      email_change_token_new, email_change_token_current,
      phone_change, phone_change_token, reauthentication_token
    ) values (
      '00000000-0000-0000-0000-000000000000', '${u.id}', 'authenticated', 'authenticated',
      '${correo}', now(), '${u.created_at}', now(),
      '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
      false, false, false,
      '', '', '', '', '', '', '', ''
    ) on conflict (id) do nothing;`, { silencioso: true });
  console.log(`  ✓ ${u.email}`);
}

// --- 3 · datos -------------------------------------------------------------

console.log("\n=== 3/5 · Copiando la contabilidad ===");
const PAGINA = 500;
const resumen = [];

for (const tabla of TABLAS) {
  if (!TABLAS_DESTINO.has(tabla)) continue;  // vistas y demás: se derivan solas

  let desplazamiento = 0;
  let total = 0;

  for (;;) {
    const resp = await fetch(
      `${URL_ORIGEN}/rest/v1/${tabla}?select=*&limit=${PAGINA}&offset=${desplazamiento}`,
      { headers: cabeceras },
    );
    if (!resp.ok) {
      console.log(`  · ${tabla}: ${resp.status}, se omite`);
      break;
    }
    const filas = await resp.json();
    if (filas.length === 0) break;

    // El JSON va entre delimitadores $json$ para no tener que escapar comillas.
    const carga = JSON.stringify(filas).replace(/\$json\$/g, "");
    sql(`
      set session_replication_role = replica;
      insert into public.${tabla}
      select * from json_populate_recordset(null::public.${tabla}, $json$${carga}$json$)
      on conflict do nothing;`, { silencioso: true });

    total += filas.length;
    desplazamiento += PAGINA;
    if (filas.length < PAGINA) break;
  }

  if (total > 0) {
    console.log(`  ✓ ${tabla.padEnd(34)} ${String(total).padStart(6)} filas`);
    resumen.push([tabla, total]);
  }
}

// --- 4 · secuencias --------------------------------------------------------

console.log("\n=== 4/5 · Recolocando las secuencias ===");
// Sin esto, el primer alta después de la migración chocaría con un
// identificador ya usado: la secuencia seguiría en 1.
const secuencias = sql(`
  select 'select setval(' || quote_literal(quote_ident(s.schemaname) || '.' || quote_ident(s.sequencename)) ||
         ', coalesce((select max(' || quote_ident(a.attname) || ') from ' ||
         quote_ident(s.schemaname) || '.' || quote_ident(c.relname) || '), 1), true);'
  from pg_sequences s
  join pg_class sc on sc.relname = s.sequencename
  join pg_depend d on d.objid = sc.oid and d.deptype = 'a'
  join pg_class c on c.oid = d.refobjid
  join pg_attribute a on a.attrelid = c.oid and a.attnum = d.refobjsubid
  where s.schemaname = 'public'`);

if (secuencias) {
  sql(secuencias, { silencioso: true });
  console.log(`  ${secuencias.split("\n").length} secuencias recolocadas.`);
} else {
  console.log("  No hay secuencias que recolocar.");
}

// --- 5 · comprobación ------------------------------------------------------

console.log("\n=== 5/5 · Comparando origen y destino, tabla por tabla ===");
let discrepancias = 0;

for (const [tabla] of resumen) {
  const resp = await fetch(`${URL_ORIGEN}/rest/v1/${tabla}?select=*&limit=1`, {
    headers: { ...cabeceras, Prefer: "count=exact", Range: "0-0" },
  });
  const rango = resp.headers.get("content-range") ?? "";
  const enOrigen = Number(rango.split("/")[1] ?? -1);
  const enDestino = Number(sql(`select count(*) from public.${tabla}`));

  if (enOrigen !== enDestino) {
    console.log(`  ✗ ${tabla.padEnd(34)} origen ${enOrigen}  destino ${enDestino}`);
    discrepancias++;
  }
}

if (discrepancias === 0) {
  console.log(`  Coinciden las ${resumen.length} tablas con datos.`);
  console.log("\nDATOS MIGRADOS. Falta copiar los archivos:");
  console.log("  node deploy/supabase/copiar-buckets.mjs");
} else {
  console.log(`\n${discrepancias} tablas no cuadran. NO cambies las variables de la aplicación.`);
  process.exit(1);
}
