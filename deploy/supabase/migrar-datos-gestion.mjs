/**
 * Copia los datos de un proyecto de Supabase a una base del servidor propio,
 * usando la API de gestión para leer.
 *
 *     SBP=sbp_… REF=pamplfrwwawfgvbzbndk BASE=marketing \
 *     node deploy/supabase/migrar-datos-gestion.mjs
 *
 * Se diferencia de `migrar-por-api.mjs` en cómo lee el origen: aquel usaba
 * PostgREST con la clave de servicio, y por tanto solo veía lo que PostgREST
 * expone. Este ejecuta SQL directamente, así que llega también a las tablas
 * con RLS activo sin políticas —que desde la API de datos son invisibles— y
 * a las que no están publicadas en la API.
 *
 * El esquema debe existir ya en el destino: lo crea `extraer-esquema.mjs`.
 * Aquí solo viajan las filas.
 *
 * Durante la carga el destino trabaja con `session_replication_role = replica`:
 * sin triggers ni comprobación de claves foráneas. Así el orden de las tablas
 * deja de importar y no se re-disparan efectos que ya ocurrieron en origen.
 */

import { execFileSync } from "node:child_process";

const SBP = process.env.SBP;
const REF = process.env.REF;
const BASE = process.env.BASE;
const SERVIDOR = "root@178.104.101.84";
const CLAVE = `${process.env.HOME || process.env.USERPROFILE}/.ssh/atlas_deploy`;
// Las bases con Storage viven en su propia instancia de PostgreSQL —storage-api
// solo arranca contra la base `postgres` que inicializa su imagen—, así que el
// contenedor deja de ser siempre el mismo.
const CONTENEDOR = process.env.CONTENEDOR || "contable-supabase-db-1";
const PAGINA = 500;

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
    { input: consulta, encoding: "utf8", maxBuffer: 1024 * 1024 * 512 },
  ).trim();
}

const tablas = destino(
  `select tablename from pg_tables where schemaname = 'public' order by tablename`,
).split("\n").filter(Boolean);

// Columnas escribibles de cada tabla: se excluyen las generadas, que
// PostgreSQL calcula por su cuenta y rechaza si se intenta rellenar.
const columnas = {};
for (const linea of destino(`
  select c.relname || '|' || a.attname
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
  where n.nspname = 'public' and c.relkind = 'r' and a.attgenerated = ''
  order by c.relname, a.attnum`).split("\n").filter(Boolean)) {
  const [tabla, columna] = linea.split("|");
  (columnas[tabla] ??= []).push(columna);
}

console.log(`${tablas.length} tablas en el destino\n`);

const resumen = [];

for (const tabla of tablas) {
  // El destino puede tener tablas que el origen no: los propios servicios
  // (GoTrue, storage-api) crean las suyas al arrancar. No es un error, solo
  // no hay nada que copiar.
  let n;
  try {
    [{ n }] = await origen(`select count(*)::int as n from public."${tabla}"`);
  } catch (e) {
    if (/does not exist/.test(e.message)) {
      console.log(`  · ${tabla.padEnd(30)} no existe en el origen, se omite`);
      continue;
    }
    throw e;
  }
  if (n === 0) continue;

  let copiadas = 0;
  for (let desde = 0; desde < n; desde += PAGINA) {
    const filas = await origen(
      `select * from public."${tabla}" order by 1 limit ${PAGINA} offset ${desde}`,
    );
    if (!filas.length) break;

    // El JSON va entre delimitadores $json$ para no escapar comillas una a una.
    const carga = JSON.stringify(filas).replace(/\$json\$/g, "");
    // Las columnas generadas (`GENERATED ALWAYS AS … STORED`) se calculan
    // solas: intentar escribirlas da «cannot insert a non-DEFAULT value into
    // column». Por eso se nombran las columnas en vez de usar `select *`.
    // `overriding system value` es necesario para las columnas declaradas
    // `generated always as identity`: PostgreSQL las genera él y rechaza el
    // valor que trae el origen, aunque migrar es justo conservarlo.
    destino(`
      set session_replication_role = replica;
      insert into public."${tabla}" (${columnas[tabla].map((c) => `"${c}"`).join(", ")})
      overriding system value
      select ${columnas[tabla].map((c) => `"${c}"`).join(", ")}
      from json_populate_recordset(null::public."${tabla}", $json$${carga}$json$)
      on conflict do nothing;`);
    copiadas += filas.length;
  }

  const enDestino = Number(destino(`select count(*) from public."${tabla}"`));
  const ok = enDestino === n;
  console.log(`  ${ok ? "✓" : "✗"} ${tabla.padEnd(30)} ${String(n).padStart(6)} → ${String(enDestino).padStart(6)}`);
  resumen.push({ tabla, origen: n, destino: enDestino, ok });
}

// --- secuencias ------------------------------------------------------------
// Sin esto, el primer alta después de migrar chocaría con un identificador ya
// usado: la secuencia seguiría en 1.
// `pg_get_serial_sequence` y no `pg_depend`: este último solo encuentra las
// secuencias declaradas OWNED BY su columna, y una creada aparte —o cuya
// pertenencia se perdió al reconstruir el esquema— se quedaba fuera con el
// contador en 1. El síntoma aparece mucho después: los conteos cuadran, y la
// primera escritura falla con «duplicate key value violates unique constraint».
const setvals = destino(`
  select 'select setval(' || quote_literal(seq) ||
         ', coalesce((select max(' || quote_ident(columna) || ') from public.' || quote_ident(tabla) || '), 1), true);'
  from (
    select c.relname as tabla, a.attname as columna,
           pg_get_serial_sequence('public.' || quote_ident(c.relname), a.attname) as seq
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    where n.nspname = 'public' and c.relkind = 'r'
  ) t
  where seq is not null`);

if (setvals) {
  destino(setvals);
  console.log(`\n  ${setvals.split("\n").length} secuencias recolocadas`);
}

const fallos = resumen.filter((r) => !r.ok);
const total = resumen.reduce((s, r) => s + r.destino, 0);

console.log(`\n${resumen.length} tablas con datos · ${total} filas`);
if (fallos.length) {
  console.log(`${fallos.length} NO cuadran: ${fallos.map((f) => f.tabla).join(", ")}`);
  process.exit(1);
}
console.log("Todas las tablas coinciden con el origen.");
