/**
 * Copia los usuarios de `auth` conservando sus contraseñas.
 *
 *     SBP=sbp_… REF=iaxhryjsmapwpjbsnavy BASE=tributos \
 *     node deploy/supabase/migrar-usuarios-gestion.mjs
 *
 * Con la API de datos esto no se puede: `/auth/v1/admin/users` devuelve el
 * perfil pero nunca `encrypted_password`, así que en ContableMAP hubo que
 * establecer una contraseña nueva. La API de gestión ejecuta SQL, y ahí el
 * hash es una columna más: los usuarios entran con la contraseña de siempre.
 *
 * Solo se copian las columnas que existen en ambos lados: entre versiones de
 * GoTrue se añaden y quitan columnas, y una diferencia no debe abortar la
 * migración.
 *
 * También se copian las identidades (`auth.identities`), sin las cuales GoTrue
 * no reconoce el método de acceso del usuario.
 */

import { execFileSync } from "node:child_process";

const { SBP, REF, BASE } = process.env;
const SERVIDOR = "root@178.104.101.84";
const CLAVE = `${process.env.HOME || process.env.USERPROFILE}/.ssh/atlas_deploy`;
// Las bases con Storage viven en su propia instancia de PostgreSQL —storage-api
// solo arranca contra la base `postgres` que inicializa su imagen—, así que el
// contenedor deja de ser siempre el mismo.
const CONTENEDOR = process.env.CONTENEDOR || "contable-supabase-db-1";

if (!SBP || !REF || !BASE) {
  console.error("Faltan SBP, REF o BASE");
  process.exit(1);
}

async function origen(consulta) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${SBP}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: consulta }),
  });
  if (!r.ok) throw new Error(`origen ${r.status}: ${(await r.text()).slice(0, 160)}`);
  return r.json();
}

function destino(consulta) {
  return execFileSync(
    "ssh",
    ["-i", CLAVE, "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=no", "-o", "LogLevel=ERROR",
     SERVIDOR, `docker exec -i ${CONTENEDOR} psql -U postgres -d ${BASE} -v ON_ERROR_STOP=1 -tAq`],
    { input: consulta, encoding: "utf8", maxBuffer: 1024 * 1024 * 256 },
  ).trim();
}

const columnasDe = async (tabla) => {
  const enOrigen = (await origen(`
    select column_name from information_schema.columns
    where table_schema='auth' and table_name='${tabla}'`)).map((r) => r.column_name);

  // Se excluyen las columnas generadas: PostgreSQL las calcula solo y rechaza
  // la fila entera si se intenta escribirlas. En `auth.users`, `confirmed_at`
  // lo es —se deriva de email_confirmed_at y phone_confirmed_at—.
  const enDestino = destino(`
    select a.attname
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'auth' and c.relname = '${tabla}'
      and a.attnum > 0 and not a.attisdropped and a.attgenerated = ''`).split("\n").filter(Boolean);

  const comunes = enOrigen.filter((c) => enDestino.includes(c));
  const soloOrigen = enOrigen.filter((c) => !enDestino.includes(c));
  if (soloOrigen.length) {
    console.log(`  ${tabla}: ${soloOrigen.length} columnas del origen no existen aquí (${soloOrigen.slice(0, 4).join(", ")}${soloOrigen.length > 4 ? "…" : ""})`);
  }
  return comunes;
};

for (const tabla of ["users", "identities"]) {
  const cols = await columnasDe(tabla);
  if (!cols.length) { console.log(`  ${tabla}: sin columnas comunes, se omite`); continue; }

  const filas = await origen(`select ${cols.map((c) => `"${c}"`).join(", ")} from auth."${tabla}"`);
  if (!filas.length) { console.log(`  ${tabla}: vacía en origen`); continue; }

  const carga = JSON.stringify(filas).replace(/\$json\$/g, "");
  destino(`
    set session_replication_role = replica;
    insert into auth."${tabla}" (${cols.map((c) => `"${c}"`).join(", ")})
    select ${cols.map((c) => `"${c}"`).join(", ")}
    from json_populate_recordset(null::auth."${tabla}", $json$${carga}$json$)
    on conflict do nothing;`);

  const n = destino(`select count(*) from auth."${tabla}"`);
  console.log(`  ✓ ${tabla.padEnd(12)} ${String(filas.length).padStart(4)} → ${String(n).padStart(4)}`);
}

// Los campos de token no admiten NULL: GoTrue los lee como texto y responde
// «Database error loading user» aunque la fila sea correcta.
destino(`
  do $$
  declare columna text;
  begin
    foreach columna in array array['confirmation_token','recovery_token','email_change',
      'email_change_token_new','email_change_token_current','phone_change',
      'phone_change_token','reauthentication_token']
    loop
      if exists (select 1 from information_schema.columns
                 where table_schema='auth' and table_name='users' and column_name=columna) then
        execute format('update auth.users set %I = %L where %I is null', columna, '', columna);
      end if;
    end loop;
  end $$;`);

console.log("\nUsuarios migrados con su contraseña original.");
