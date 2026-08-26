#!/bin/bash
# Sincroniza los datos de contratación desde supabase.com al servidor propio.
#
# Uso:  CLAVE_NUBE='sb_secret_...' ./sincronizar-datos.sh
#
# Por qué recarga completa y no un delta: ninguna tabla de negocio tiene columna
# de fecha de creación o modificación, así que no hay forma de saber qué cambió.
# Da igual: el servidor nunca ha recibido escrituras (ninguna aplicación lo usa),
# así que la nube es la fuente de verdad y basta con volver a copiarla entera.
set -euo pipefail

NUBE="https://uvtxqbegulsxrtlmsmrd.supabase.co"
SSH="ssh -i $HOME/.ssh/atlas_deploy -o BatchMode=yes -o StrictHostKeyChecking=no root@178.104.101.84"
DB="contratacion-supabase-db-1"
TRABAJO="$(mktemp -d)"

# Orden irrelevante: la carga desactiva las claves ajenas y las revalida al final.
TABLAS="empresas roles_empresa perfiles membresias empresa_modulos cronograma cronograma_respaldo documentos aprobaciones autorizaciones solicitudes_cambio solicitudes_eliminacion perfiles_clave_log"

: "${CLAVE_NUBE:?Falta CLAVE_NUBE (la clave service_role del proyecto en supabase.com)}"

echo "== 1. Descargando de la nube =="
for t in $TABLAS; do
    # Paginado de 1000 en 1000 por si alguna tabla crece por encima del tope de PostgREST.
    desde=0; : > "$TRABAJO/$t.json"; total=0
    while :; do
        hasta=$((desde + 999))
        curl -sS -m 120 --fail-with-body \
             -H "apikey: $CLAVE_NUBE" -H "Authorization: Bearer $CLAVE_NUBE" \
             -H "Accept-Profile: public" -H "Range: $desde-$hasta" \
             "$NUBE/rest/v1/$t?select=*" > "$TRABAJO/pagina.json"
        n=$(python -c "import json,sys,io;print(len(json.load(io.open(sys.argv[1],encoding='utf-8'))))" "$TRABAJO/pagina.json")
        python - "$TRABAJO/$t.json" "$TRABAJO/pagina.json" <<'PY'
import json, sys
destino, pagina = sys.argv[1], sys.argv[2]
try:
    acumulado = json.load(open(destino, encoding='utf-8'))
except Exception:
    acumulado = []
acumulado.extend(json.load(open(pagina, encoding='utf-8')))
json.dump(acumulado, open(destino, 'w', encoding='utf-8'), ensure_ascii=False)
PY
        total=$((total + n))
        [ "$n" -lt 1000 ] && break
        desde=$((desde + 1000))
    done
    printf "   %-24s %s filas\n" "$t" "$total"
done

echo "== 2. Generando la carga =="
SQL="$TRABAJO/carga.sql"
{
    echo "begin;"
    echo "set session_replication_role = replica;   -- suspende claves ajenas y disparadores"
    for t in $TABLAS; do echo "truncate table public.$t cascade;"; done
    for t in $TABLAS; do
        echo "insert into public.$t select * from json_populate_recordset(null::public.$t, \$dat\$"
        cat "$TRABAJO/$t.json"
        echo "\$dat\$);"
    done
    echo "set session_replication_role = default;"
    # Realinea las secuencias de las tablas con id numérico.
    cat <<'FIN'
select setval(pg_get_serial_sequence('public.cronograma','id'),
              coalesce((select max(id) from public.cronograma),1), true)
 where pg_get_serial_sequence('public.cronograma','id') is not null;
select setval(pg_get_serial_sequence('public.cronograma_respaldo','respaldo_id'),
              coalesce((select max(respaldo_id) from public.cronograma_respaldo),1), true)
 where pg_get_serial_sequence('public.cronograma_respaldo','respaldo_id') is not null;
select setval(pg_get_serial_sequence('public.perfiles_clave_log','id'),
              coalesce((select max(id) from public.perfiles_clave_log),1), true)
 where pg_get_serial_sequence('public.perfiles_clave_log','id') is not null;
commit;
FIN
} > "$SQL"
echo "   $(wc -c < "$SQL") bytes"

echo "== 3. Respaldo previo del servidor =="
$SSH "docker exec $DB pg_dump -U postgres -d postgres -n public --data-only | gzip > /opt/respaldos/contratacion-antes-de-sincronizar-\$(date +%F-%H%M).sql.gz && ls -la /opt/respaldos/ | tail -3"

echo "== 4. Cargando en el servidor =="
$SSH "docker exec -i $DB psql -U postgres -d postgres -v ON_ERROR_STOP=1" < "$SQL"

echo "== 5. Comprobación =="
$SSH "docker exec $DB psql -U postgres -d postgres -t -A -F'|' -c \"SELECT relname, n_live_tup FROM pg_stat_user_tables WHERE schemaname='public' ORDER BY relname;\""
echo "Trabajo en: $TRABAJO"
