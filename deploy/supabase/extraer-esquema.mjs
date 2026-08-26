/**
 * Extrae el esquema completo de un proyecto de Supabase usando su API de
 * gestión, y escribe un archivo .sql listo para aplicar en el servidor propio.
 *
 *     SBP=sbp_… REF=pamplfrwwawfgvbzbndk \
 *     node deploy/supabase/extraer-esquema.mjs > esquema-marketing.sql
 *
 * Por qué hace falta: la API de datos (PostgREST) sirve filas, no estructura.
 * No expone claves foráneas completas, ni índices, ni triggers, ni políticas
 * de seguridad. Migrar solo los datos y deducir el resto produciría una base
 * parecida pero no equivalente —y en particular, sin RLS, lo que significa
 * abrir a cualquiera lo que antes estaba restringido—.
 *
 * La API de gestión sí permite consultar el catálogo de PostgreSQL, que es
 * donde vive la verdad. PostgreSQL además sabe describirse a sí mismo:
 * `pg_get_constraintdef`, `pg_get_indexdef`, `pg_get_functiondef` y
 * `pg_get_triggerdef` devuelven la definición exacta. Para las tablas no hay
 * equivalente, así que se reconstruyen columna a columna.
 *
 * El orden importa y es el que sigue el archivo: extensiones, tipos, tablas,
 * claves primarias, claves foráneas, índices, funciones, triggers, RLS y
 * permisos. Al revés fallaría.
 */

const SBP = process.env.SBP;
const REF = process.env.REF;
if (!SBP || !REF) {
  console.error("Faltan SBP (token de gestión) o REF (id del proyecto)");
  process.exit(1);
}

async function sql(consulta) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${SBP}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: consulta }),
  });
  if (!r.ok) throw new Error(`${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

const lineas = (filas) => filas.map((f) => Object.values(f)[0]).filter(Boolean);
const bloque = (titulo, sentencias) => {
  if (!sentencias.length) return;
  console.log(`\n-- ${"=".repeat(70)}\n-- ${titulo}\n-- ${"=".repeat(70)}\n`);
  sentencias.forEach((s) => console.log(s.endsWith(";") ? s : `${s};`));
};

console.log(`-- Esquema de ${REF}, extraído el ${new Date().toISOString().slice(0, 10)}`);
console.log(`-- Generado por extraer-esquema.mjs desde la API de gestión de Supabase.`);

// --- extensiones -----------------------------------------------------------
bloque("Extensiones", lineas(await sql(`
  select 'create extension if not exists ' || quote_ident(e.extname) ||
         ' with schema ' || quote_ident(n.nspname) as ddl
  from pg_extension e join pg_namespace n on n.oid = e.extnamespace
  where e.extname not in ('plpgsql')
  order by 1`)));

// --- tipos enumerados ------------------------------------------------------
// Van antes que las tablas: alguna columna los usa como tipo.
bloque("Tipos enumerados", lineas(await sql(`
  select 'create type public.' || quote_ident(t.typname) || ' as enum (' ||
         string_agg(quote_literal(e.enumlabel), ', ' order by e.enumsortorder) || ')' as ddl
  from pg_type t
  join pg_enum e on e.enumtypid = t.oid
  join pg_namespace n on n.oid = t.typnamespace
  where n.nspname = 'public'
  group by t.typname order by t.typname`)));

// --- secuencias ------------------------------------------------------------
// Antes que las tablas: una columna `bigserial` lleva un
// `default nextval('tabla_id_seq')`, y crear la tabla sin la secuencia falla
// con «relation … does not exist».
bloque("Secuencias", lineas(await sql(`
  select 'create sequence if not exists public.' || quote_ident(sequencename) ||
         ' as ' || data_type ||
         ' increment by ' || increment_by ||
         ' minvalue ' || min_value || ' maxvalue ' || max_value ||
         ' start with ' || coalesce(last_value, start_value) ||
         case when cycle then ' cycle' else ' no cycle' end as ddl
  from pg_sequences where schemaname = 'public'
  order by sequencename`)));

// --- tablas ----------------------------------------------------------------
// Sin constraints: se añaden después, para que el orden de creación de las
// tablas no importe cuando hay referencias cruzadas.
// Tres formas de que una columna tenga valor, y las tres se escriben distinto:
//   · generada:  GENERATED ALWAYS AS (expresión) STORED  — se calcula de otras
//                columnas, y ponerla como DEFAULT falla con «cannot use column
//                reference in DEFAULT expression»
//   · identidad: GENERATED ... AS IDENTITY
//   · normal:    DEFAULT expresión
bloque("Tablas", lineas(await sql(`
  select 'create table if not exists public.' || quote_ident(c.relname) || ' (' ||
         string_agg(
           quote_ident(a.attname) || ' ' || format_type(a.atttypid, a.atttypmod) ||
           case
             when a.attgenerated = 's'
               then ' generated always as (' || pg_get_expr(d.adbin, d.adrelid) || ') stored'
             when a.attidentity in ('a','d')
               then ' generated ' || case a.attidentity when 'a' then 'always' else 'by default' end || ' as identity'
             else coalesce(' default ' || pg_get_expr(d.adbin, d.adrelid), '')
           end ||
           case when a.attnotnull then ' not null' else '' end,
           ', ' order by a.attnum
         ) || ')' as ddl
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
  left join pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
  where n.nspname = 'public' and c.relkind = 'r'
  group by c.relname order by c.relname`)));

// --- claves y comprobaciones ----------------------------------------------
// Primarias y únicas antes que las foráneas, porque estas las referencian.
bloque("Claves primarias y únicas", lineas(await sql(`
  select 'alter table public.' || quote_ident(rel.relname) ||
         ' add constraint ' || quote_ident(con.conname) || ' ' || pg_get_constraintdef(con.oid) as ddl
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace n on n.oid = rel.relnamespace
  where n.nspname = 'public' and con.contype in ('p','u')
  order by rel.relname, con.conname`)));

bloque("Comprobaciones", lineas(await sql(`
  select 'alter table public.' || quote_ident(rel.relname) ||
         ' add constraint ' || quote_ident(con.conname) || ' ' || pg_get_constraintdef(con.oid) as ddl
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace n on n.oid = rel.relnamespace
  where n.nspname = 'public' and con.contype = 'c'
  order by rel.relname, con.conname`)));

bloque("Claves foráneas", lineas(await sql(`
  select 'alter table public.' || quote_ident(rel.relname) ||
         ' add constraint ' || quote_ident(con.conname) || ' ' || pg_get_constraintdef(con.oid) as ddl
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace n on n.oid = rel.relnamespace
  where n.nspname = 'public' and con.contype = 'f'
  order by rel.relname, con.conname`)));

// --- pertenencia de las secuencias ----------------------------------------
// Va después de las tablas: ata cada secuencia a su columna, para que se borre
// con la tabla y para que `setval` la reconozca al recolocar los contadores.
bloque("Pertenencia de las secuencias", lineas(await sql(`
  select 'alter sequence public.' || quote_ident(s.relname) ||
         ' owned by public.' || quote_ident(t.relname) || '.' || quote_ident(a.attname) as ddl
  from pg_class s
  join pg_namespace n on n.oid = s.relnamespace
  join pg_depend d on d.objid = s.oid and d.deptype = 'a'
  join pg_class t on t.oid = d.refobjid
  join pg_attribute a on a.attrelid = t.oid and a.attnum = d.refobjsubid
  where s.relkind = 'S' and n.nspname = 'public'
  order by s.relname`)));

// --- índices ---------------------------------------------------------------
// Solo los que no respaldan una constraint: esos ya se crearon arriba.
bloque("Índices", lineas(await sql(`
  select indexdef
  from pg_indexes i
  where i.schemaname = 'public'
    and not exists (
      select 1 from pg_constraint c
      join pg_class ic on ic.oid = c.conindid
      where ic.relname = i.indexname
    )
  order by i.tablename, i.indexname`)));

// --- funciones y triggers --------------------------------------------------
// Solo las funciones propias. Las extensiones instaladas en `public` —pg_trgm,
// pg_net— traen las suyas, y copiarlas sería duplicar lo que la propia
// extensión crea al instalarse. `pg_depend` con deptype 'e' marca justamente
// lo que pertenece a una extensión.
bloque("Funciones", lineas(await sql(`
  select pg_get_functiondef(p.oid)
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f'
    and not exists (
      select 1 from pg_depend d
      where d.objid = p.oid and d.deptype = 'e'
    )
  order by p.proname`)));

bloque("Triggers", lineas(await sql(`
  select pg_get_triggerdef(t.oid)
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and not t.tgisinternal
  order by c.relname, t.tgname`)));

// --- seguridad -------------------------------------------------------------
// Se replica tal cual esté en origen. Si una tabla tiene RLS activo sin
// políticas, nadie puede leerla salvo service_role: eso también hay que
// conservarlo, o la copia quedaría más abierta que el original.
bloque("Row Level Security", lineas(await sql(`
  select 'alter table public.' || quote_ident(tablename) || ' enable row level security'
  from pg_tables where schemaname = 'public' and rowsecurity
  order by tablename`)));

bloque("Políticas", lineas(await sql(`
  select 'create policy ' || quote_ident(policyname) || ' on public.' || quote_ident(tablename) ||
         ' as ' || permissive || ' for ' || cmd ||
         ' to ' || array_to_string(roles, ', ') ||
         coalesce(' using (' || qual || ')', '') ||
         coalesce(' with check (' || with_check || ')', '') as ddl
  from pg_policies where schemaname = 'public'
  order by tablename, policyname`)));

bloque("Permisos", lineas(await sql(`
  select 'grant ' || string_agg(distinct privilege_type, ', ') ||
         ' on public.' || quote_ident(table_name) || ' to ' || quote_ident(grantee) as ddl
  from information_schema.role_table_grants
  where table_schema = 'public' and grantee in ('anon','authenticated','service_role')
  group by table_name, grantee
  order by table_name, grantee`)));

console.error(`Esquema de ${REF} extraído.`);
