#!/usr/bin/env bash
#
# Migración ejecutada DENTRO del servidor, usando el contenedor de Postgres
# como herramienta: trae pg_dump 17.6, la misma versión que el origen, así que
# no hay desajuste de versiones ni hay que instalar nada en el host.
#
# Uso, ya en el servidor:
#     cd /opt/contable-supabase
#     ORIGEN_DB_URL='postgresql://…' bash migrar-en-servidor.sh
#
# El origen solo se lee. Si algo sale mal, el proyecto de supabase.com sigue
# intacto y la aplicación —que aún apunta allí— nunca se entera.

set -euo pipefail

: "${ORIGEN_DB_URL:?Falta ORIGEN_DB_URL}"

DB=contable-supabase-db-1
DESTINO_LOCAL="postgresql://postgres@localhost:5432/postgres"
VOLCADO=/mnt/HC_Volume_106171631/contable/respaldos/migracion-$(date +%Y%m%d-%H%M%S)

# El volcado va al Volume, no al disco de sistema: es el que tiene sitio de
# sobra y donde ya viven los respaldos.
mkdir -p "$VOLCADO"
echo "Volcado en $VOLCADO"

en_db() { docker exec -i "$DB" "$@"; }

echo
echo "=== 0/5 · Comprobando el origen ==="
en_db psql "$ORIGEN_DB_URL" -tAc "select 'conectado a ' || current_database() || ' · ' || version()" | cut -c1-60

FILAS_ORIGEN=$(en_db psql "$ORIGEN_DB_URL" -tAc "
  select coalesce(sum((xpath('/row/c/text()',
    query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name),
                 false, true, '')))[1]::text::int), 0)
  from information_schema.tables
  where table_schema='public' and table_type='BASE TABLE'")
echo "Filas en el origen (esquema public): $FILAS_ORIGEN"

echo
echo "=== 1/5 · Volcando usuarios ==="
en_db pg_dump "$ORIGEN_DB_URL" --data-only --no-owner \
  --table=auth.users --table=auth.identities > "$VOLCADO/01-auth.sql"
wc -l < "$VOLCADO/01-auth.sql" | xargs echo "  líneas:"

echo "=== 2/5 · Volcando la contabilidad ==="
en_db pg_dump "$ORIGEN_DB_URL" --schema=public --no-owner > "$VOLCADO/02-public.sql"
wc -l < "$VOLCADO/02-public.sql" | xargs echo "  líneas:"

echo
echo "=== 3/5 · Restaurando usuarios ==="
en_db psql "$DESTINO_LOCAL" -v ON_ERROR_STOP=1 -q < "$VOLCADO/01-auth.sql"
en_db psql "$DESTINO_LOCAL" -tAc "select count(*) || ' usuarios' from auth.users"

echo
echo "=== 4/5 · Restaurando la contabilidad ==="
# session_replication_role=replica desactiva los triggers durante la carga: las
# validaciones de cuadre y los recálculos de saldo ya se aplicaron cuando el
# dato se creó, y volver a dispararlos alteraría asientos ya contabilizados.
{ echo "set session_replication_role = replica;"; cat "$VOLCADO/02-public.sql"; } \
  | en_db psql "$DESTINO_LOCAL" -v ON_ERROR_STOP=1 -q

echo
echo "=== 5/5 · Comprobación: filas tabla por tabla ==="
CONTEO="
select table_name || ' ' || (xpath('/row/c/text()',
    query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name),
                 false, true, '')))[1]::text
from information_schema.tables
where table_schema='public' and table_type='BASE TABLE'
order by table_name"

en_db psql "$ORIGEN_DB_URL"   -tAc "$CONTEO" | sed 's/[[:space:]]*$//' | sort > "$VOLCADO/conteo-origen.txt"
en_db psql "$DESTINO_LOCAL"   -tAc "$CONTEO" | sed 's/[[:space:]]*$//' | sort > "$VOLCADO/conteo-destino.txt"

if diff -u "$VOLCADO/conteo-origen.txt" "$VOLCADO/conteo-destino.txt" > "$VOLCADO/diferencias.txt"; then
  echo "  Todas las tablas coinciden:"
  paste -d' ' /dev/null "$VOLCADO/conteo-destino.txt" | head -60
  echo
  echo "MIGRACIÓN DE DATOS CORRECTA."
  echo "Falta copiar los archivos de los buckets (copiar-buckets.mjs)."
else
  echo "  HAY DIFERENCIAS:"
  cat "$VOLCADO/diferencias.txt"
  echo
  echo "No cambies las variables de la aplicación. Revisa antes de seguir."
  exit 1
fi
