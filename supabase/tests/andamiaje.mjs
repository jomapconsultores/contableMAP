import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Levanta un PostgreSQL real en proceso y aplica las migraciones.
 *
 * Supabase aporta piezas que PGlite no trae —el rol `authenticated`, el
 * esquema `auth` y el de `storage`—, así que se replican aquí lo justo para
 * que las migraciones se apliquen tal cual se aplicarán en producción, sin
 * modificar ni una línea del SQL que se despliega.
 */

export const UID = "00000000-0000-0000-0000-000000000001";

const AQUI = dirname(fileURLToPath(import.meta.url));
export const DIR_MIGRACIONES = join(AQUI, "..", "migrations");

export async function baseDePruebas() {
  const db = await new PGlite();

  await db.exec(`
    create role authenticated;
    create role anon;
    create role service_role;

    create schema auth;
    create table auth.users (id uuid primary key);
    create or replace function auth.uid() returns uuid
      language sql stable as $fn$ select '${UID}'::uuid $fn$;

    create schema storage;
    create table storage.buckets (
      id text primary key, name text not null, public boolean not null default false);
    create table storage.objects (
      id uuid primary key default gen_random_uuid(),
      bucket_id text references storage.buckets(id),
      name text not null, owner uuid);
    alter table storage.objects enable row level security;
    create or replace function storage.foldername(name text) returns text[]
      language sql immutable as $fn$ select string_to_array(name, '/') $fn$;

    insert into auth.users values ('${UID}');
  `);

  const archivos = readdirSync(DIR_MIGRACIONES)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const archivo of archivos) {
    // pgcrypto y unaccent no vienen empaquetados en PGlite; gen_random_uuid()
    // es nativo desde PostgreSQL 13, que es lo único que se usa de pgcrypto.
    const sql = readFileSync(join(DIR_MIGRACIONES, archivo), "utf8").replace(
      /create extension[^;]+;/gi,
      "",
    );
    try {
      await db.exec(sql);
    } catch (e) {
      throw new Error(`Migración ${archivo}: ${e.message}`);
    }
  }

  return { db, archivos };
}

/** Pequeño marcador de comprobaciones, sin dependencias externas. */
export function verificador() {
  let ok = 0;
  let fallo = 0;

  return {
    comprobar(nombre, condicion, detalle = "") {
      if (condicion) {
        ok += 1;
        console.log(`  ok    ${nombre}`);
      } else {
        fallo += 1;
        console.log(`  FALLA ${nombre} ${detalle}`);
      }
    },

    /** Para invariantes que la base de datos debe rechazar. */
    async debeFallar(db, nombre, sql) {
      try {
        await db.exec(sql);
        fallo += 1;
        console.log(`  FALLA ${nombre} — se esperaba un rechazo y pasó`);
      } catch (e) {
        ok += 1;
        console.log(`  ok    ${nombre} → ${e.message.split("\n")[0]}`);
      }
    },

    resumen() {
      console.log(`\n=== ${ok} comprobaciones correctas, ${fallo} fallidas ===`);
      return fallo;
    },
  };
}
