#!/usr/bin/env bash
#
# Comprueba que el último respaldo se puede restaurar de verdad.
#
#     /opt/contable-supabase/probar-restauracion.sh
#
# Un respaldo que nunca se ha restaurado no es un respaldo: es un archivo que
# se supone que sirve. Esto lo restaura en una base temporal, cuenta lo que
# recupera y la borra. No toca la base en producción en ningún momento.
#
# Conviene ejecutarlo de vez en cuando —una vez al mes basta— y siempre antes
# de confiar en una copia para algo importante.

set -euo pipefail

DESTINO=/mnt/HC_Volume_106171631/contable/respaldos
CONTENEDOR=contable-supabase-db-1
BASE_PRUEBA=prueba_restauracion

ULTIMO=$(find "$DESTINO" -mindepth 1 -maxdepth 1 -type d -name '20*' | sort | tail -1)
[ -n "$ULTIMO" ] || { echo "No hay ningún respaldo en $DESTINO"; exit 1; }

echo "Respaldo:  $(basename "$ULTIMO")"
echo "Tamaño:    $(du -h "$ULTIMO/base.dump" | cut -f1) (base) + $(du -h "$ULTIMO/archivos.tar.gz" | cut -f1) (archivos)"
echo

limpiar() {
  docker exec "$CONTENEDOR" psql -U postgres -q -c "drop database if exists $BASE_PRUEBA" >/dev/null 2>&1 || true
}
trap limpiar EXIT

limpiar
docker exec "$CONTENEDOR" psql -U postgres -q -c "create database $BASE_PRUEBA" >/dev/null

echo "Restaurando..."
docker exec -i "$CONTENEDOR" pg_restore -U postgres -d "$BASE_PRUEBA" \
  --no-owner --no-privileges < "$ULTIMO/base.dump" 2>/dev/null || true

# Las cuentas se piden por separado para que un error en una no oculte el resto.
for consulta in \
  "select count(*) from public.movimientos_extracto:movimientos de extracto" \
  "select count(*) from public.plan_cuentas:cuentas del plan" \
  "select count(*) from public.documentos:documentos" \
  "select count(*) from public.categorias_gasto:categorías de gasto" \
  "select count(*) from public.entidades:entidades" \
  "select count(*) from auth.users:usuarios" \
  "select count(*) from storage.objects:archivos en el inventario"
do
  sql="${consulta%%:*}"
  etiqueta="${consulta##*:}"
  valor=$(docker exec "$CONTENEDOR" psql -U postgres -d "$BASE_PRUEBA" -tAc "$sql" 2>/dev/null || echo "?")
  printf "  %-28s %s\n" "$etiqueta" "$valor"
done

echo
echo "Contenido del paquete de archivos:"
# storage-api guarda cada objeto como una carpeta con el nombre real y, dentro,
# un fichero cuyo nombre es el identificador de versión. Por eso se cuentan los
# ficheros —las líneas que no empiezan por «d»— y no las extensiones: buscar
# «.pdf» al final del nombre daría cero con los archivos perfectamente ahí.
tar -tzvf "$ULTIMO/archivos.tar.gz" | grep -vc "^d" | xargs echo "  ficheros:"
tar -tzvf "$ULTIMO/archivos.tar.gz" | grep -v "^d" | awk '{s+=$3} END {printf "  suman:    %.2f MB\n", s/1048576}'

echo
echo "Base de prueba eliminada. La de producción no se tocó."
