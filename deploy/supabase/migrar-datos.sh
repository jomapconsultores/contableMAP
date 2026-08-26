#!/usr/bin/env bash
#
# Traslada la base de ContableMAP desde Supabase alojado al stack propio.
#
#     ORIGEN='postgresql://…' DESTINO='postgresql://…' ./migrar-datos.sh
#
# ORIGEN   cadena de conexión del proyecto en supabase.com
#          (panel → Project Settings → Database → Connection string, modo
#          «Session»; la del pooler funciona, la directa puede ser solo IPv6)
# DESTINO  cadena de conexión del Postgres nuevo, normalmente por un túnel:
#          ssh -L 5433:localhost:5432 root@servidor
#          DESTINO='postgresql://postgres:CLAVE@localhost:5433/postgres'
#
# El orden no es negociable:
#   1. auth.users   antes que nada, porque entidades.user_id apunta ahí
#   2. public       la contabilidad entera, con triggers desactivados
#
# El inventario de archivos (storage.objects) NO se vuelca por SQL: lo
# reconstruye copiar-buckets.mjs al subir cada archivo. Copiar la tabla y los
# archivos por separado abre la puerta a que el inventario liste ficheros que
# no llegaron, y un documento fantasma en la contabilidad es peor que uno que
# falta y se ve.
#
# Los triggers se desactivan durante la carga a propósito: las validaciones de
# cuadre de asientos y los recálculos de saldo ya se aplicaron cuando el dato
# se creó. Dejarlos activos no solo alargaría la carga, sino que reprocesaría
# movimientos ya contabilizados.
#
# No toca el origen en ningún momento: solo lee. El proyecto alojado queda
# intacto y sirve de vuelta atrás.

set -euo pipefail

: "${ORIGEN:?Falta ORIGEN}"
: "${DESTINO:?Falta DESTINO}"

VOLCADO="${VOLCADO:-./volcado-$(date +%Y%m%d-%H%M%S)}"
mkdir -p "$VOLCADO"

# pg_dump tiene que ser al menos tan nuevo como el servidor de origen (17.x).
# Uno más viejo falla con «server version mismatch» a mitad del volcado.
echo "· pg_dump: $(pg_dump --version)"

echo
echo "=== 1/4 · Volcando usuarios ==="
pg_dump "$ORIGEN" \
  --data-only --no-owner \
  --table=auth.users \
  --table=auth.identities \
  > "$VOLCADO/01-auth.sql"

echo "=== 2/4 · Volcando la contabilidad (esquema public) ==="
pg_dump "$ORIGEN" \
  --schema=public --no-owner \
  > "$VOLCADO/02-public.sql"

echo
echo "Volcado en $VOLCADO"
ls -la "$VOLCADO"

echo
echo "=== 3/4 · Restaurando usuarios ==="
psql "$DESTINO" -v ON_ERROR_STOP=1 -f "$VOLCADO/01-auth.sql"

echo "=== 4/4 · Restaurando la contabilidad ==="
psql "$DESTINO" -v ON_ERROR_STOP=1 \
  -c "SET session_replication_role = replica;" \
  -f "$VOLCADO/02-public.sql"

echo
echo "=== Comprobación: filas por tabla, origen contra destino ==="
CONTEO="
select table_name, (xpath('/row/c/text()',
    query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name),
                 false, true, '')))[1]::text::int as filas
from information_schema.tables
where table_schema = 'public' and table_type = 'BASE TABLE'
order by table_name;
"

psql "$ORIGEN"  -At -F' ' -c "$CONTEO" | sort > "$VOLCADO/conteo-origen.txt"
psql "$DESTINO" -At -F' ' -c "$CONTEO" | sort > "$VOLCADO/conteo-destino.txt"

if diff -u "$VOLCADO/conteo-origen.txt" "$VOLCADO/conteo-destino.txt"; then
  echo "Coinciden todas las tablas."
else
  echo
  echo "HAY DIFERENCIAS. No cambies las variables de la aplicación todavía."
  exit 1
fi

echo
echo "Falta copiar los archivos de los buckets:"
echo "  node deploy/supabase/copiar-buckets.mjs"
