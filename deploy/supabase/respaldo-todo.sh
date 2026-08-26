#!/usr/bin/env bash
#
# Respaldo diario de todas las bases migradas.
#
# Sustituye a `respaldo.sh`, que solo cubría ContableMAP. Tras las migraciones
# hay doce bases repartidas en siete instancias de PostgreSQL:
#
#   contable-supabase-db-1   postgres (ContableMAP) · marketing · proyectos ·
#                            atlas · calendario · pensamiento_libre
#   tributos-supabase-db-1   postgres (tributos)
#   gestion-supabase-db-1    postgres (Gestión contable)
#   conecta-supabase-db-1    postgres (conecta)
#   contratacion-supabase-db-1  postgres (contratación · CSC)
#   postgres:16-alpine       kardex (inventario y tesorería)
#   postgres:15-alpine       coolify (la configuración del propio panel)
#
# De cada una se guarda el volcado, y aparte los archivos de Storage y los
# `.env` de cada stack —sin ellos, un volcado no se puede poner en marcha:
# `JWT_SECRET` firma las claves de la aplicación y `SRI_CERT_SECRET` descifra
# la contraseña del certificado de facturación.
#
# Instalado en /opt/respaldo-todo.sh, lo dispara cron a las 03:15.

set -uo pipefail

DESTINO=/mnt/HC_Volume_106171631/contable/respaldos
REMOTO="dropbox:09_RESPALDOS/contable-map"
RETENCION_DIAS=30
DIAS_EN_REMOTO=7

FECHA=$(date +%Y%m%d-%H%M)
CARPETA="$DESTINO/$FECHA"
REGISTRO="$DESTINO/registro.log"

anotar() { echo "$(date '+%Y-%m-%d %H:%M:%S') · $*" | tee -a "$REGISTRO"; }
fallo() { anotar "FALLO: $1"; echo "$(date '+%Y-%m-%d %H:%M:%S') FALLO: $1" > "$DESTINO/ultimo-estado.txt"; exit 1; }

mkdir -p "$CARPETA"
anotar "--- inicio $FECHA ---"

# --- las bases -------------------------------------------------------------
# Formato `custom` comprimido: permite restaurar tablas sueltas y detectar un
# volcado truncado con `pg_restore --list`.
total_tablas=0
for par in "contable-supabase-db-1:postgres" "contable-supabase-db-1:marketing" \
           "contable-supabase-db-1:proyectos" "contable-supabase-db-1:atlas" \
           "contable-supabase-db-1:calendario" "contable-supabase-db-1:pensamiento_libre" \
           "tributos-supabase-db-1:postgres" \
           "gestion-supabase-db-1:postgres" \
           "conecta-supabase-db-1:postgres" \
           "contratacion-supabase-db-1:postgres"; do
  contenedor="${par%%:*}"; base="${par##*:}"
  etiqueta="${contenedor%%-supabase-db-1}-$base"

  docker ps --format '{{.Names}}' | grep -q "^${contenedor}$" || { anotar "AVISO: $contenedor no está en marcha"; continue; }

  docker exec "$contenedor" pg_dump -U postgres --format=custom --compress=9 "$base" \
    > "$CARPETA/$etiqueta.dump" 2>>"$REGISTRO" || fallo "pg_dump de $etiqueta"

  n=$(docker exec -i "$contenedor" pg_restore --list < "$CARPETA/$etiqueta.dump" 2>/dev/null | grep -c "TABLE DATA" || true)
  [ "$n" -gt 0 ] || fallo "el volcado de $etiqueta no contiene datos legibles"
  anotar "  $etiqueta: $(du -h "$CARPETA/$etiqueta.dump" | cut -f1), $n tablas"
  total_tablas=$((total_tablas + n))
done

# --- las otras dos bases del servidor -------------------------------------
# Kardex tiene PostgreSQL propio, creado desde Coolify, con el inventario y la
# tesorería. Tiene su volcado diario en /opt/respaldos/kardex, pero solo local:
# sin esto, un fallo del disco se lo lleva.
#
# coolify-db guarda la configuración entera de Coolify —proyectos, aplicaciones,
# variables de entorno, claves—. Sin ella hay que reconstruir todo a mano.
#
# Los contenedores se localizan por imagen y no por nombre: Coolify los nombra
# con un uuid que cambia si se recrea el recurso.
for par in "postgres:16-alpine:kardex" "postgres:15-alpine:coolify"; do
  imagen="${par%:*}"; etiqueta="${par##*:}"
  contenedor=$(docker ps --filter "ancestor=$imagen" --format '{{.Names}}' | head -1)
  [ -n "$contenedor" ] || { anotar "AVISO: no encuentro el contenedor de $etiqueta ($imagen)"; continue; }

  # El usuario y la base salen del entorno del propio contenedor: coolify-db no
  # tiene rol `postgres` —su superusuario se llama `coolify`— y dar por hecho
  # el nombre habitual hace fallar el volcado con «role does not exist».
  usuario=$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$contenedor" | grep '^POSTGRES_USER=' | cut -d= -f2-)
  base=$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$contenedor" | grep '^POSTGRES_DB=' | cut -d= -f2-)
  usuario=${usuario:-postgres}
  base=${base:-postgres}

  docker exec "$contenedor" pg_dump -U "$usuario" --format=custom --compress=9 "$base" \
    > "$CARPETA/otros-$etiqueta.dump" 2>>"$REGISTRO" || { anotar "AVISO: fallo el pg_dump de $etiqueta"; continue; }

  n=$(docker exec -i "$contenedor" pg_restore --list < "$CARPETA/otros-$etiqueta.dump" 2>/dev/null | grep -c "TABLE DATA" || true)
  anotar "  $etiqueta: $(du -h "$CARPETA/otros-$etiqueta.dump" | cut -f1), $n tablas"
  total_tablas=$((total_tablas + n))
done

# --- los archivos ----------------------------------------------------------
for dir in /mnt/HC_Volume_106171631/contable/storage \
           /mnt/HC_Volume_106171631/tributos/storage \
           /mnt/HC_Volume_106171631/gestion/storage \
           /mnt/HC_Volume_106171631/conecta/storage \
           /mnt/HC_Volume_106171631/contratacion/storage; do
  [ -d "$dir" ] || continue
  # -f4 y no -f5: con /mnt/HC_Volume_.../contable/storage, el campo 5 es
  # «storage» para los tres, así que los tres tar se sobrescribían y solo
  # quedaba el último. El campo 4 es el que distingue contable/tributos/gestion.
  nombre=$(echo "$dir" | cut -d/ -f4)
  tar -czf "$CARPETA/archivos-$nombre.tar.gz" -C "$dir" . 2>>"$REGISTRO" || fallo "tar de $nombre"
  n=$(tar -tzvf "$CARPETA/archivos-$nombre.tar.gz" | grep -vc "^d" || true)
  anotar "  archivos de $nombre: $(du -h "$CARPETA/archivos-$nombre.tar.gz" | cut -f1), $n ficheros"
done

# --- las credenciales ------------------------------------------------------
for stack in contable marketing proyectos tributos gestion atlas calendario pensamiento-libre conecta contratacion; do
  [ -f "/opt/$stack-supabase/.env" ] && cp "/opt/$stack-supabase/.env" "$CARPETA/env-$stack.txt"
done
chmod 600 "$CARPETA"/env-*.txt 2>/dev/null || true

# --- rotación y copia fuera ------------------------------------------------
find "$DESTINO" -mindepth 1 -maxdepth 1 -type d -mtime +$RETENCION_DIAS -exec rm -rf {} + 2>/dev/null || true
copias=$(find "$DESTINO" -mindepth 1 -maxdepth 1 -type d | wc -l)
anotar "local: $copias copias · $(du -sh "$DESTINO" | cut -f1)"

if rclone about dropbox: >/dev/null 2>&1; then
  rclone copy "$CARPETA" "$REMOTO/$FECHA" --transfers 4 2>>"$REGISTRO" \
    && anotar "subido a Dropbox" || anotar "AVISO: fallo al subir (la copia local sí está)"

  # En remoto se conservan los últimos días y el primero de cada mes.
  LIMITE=$(date -d "-$DIAS_EN_REMOTO days" +%Y%m%d)
  rclone lsf "$REMOTO" --dirs-only 2>/dev/null | tr -d '/' | while read -r copia; do
    dia="${copia%%-*}"
    [ ${#dia} -eq 8 ] || continue
    if [ "$dia" -lt "$LIMITE" ] && [ "${dia:6:2}" != "01" ]; then
      rclone purge "$REMOTO/$copia" 2>/dev/null && anotar "  purgada en remoto: $copia"
    fi
  done
else
  anotar "AVISO: Dropbox no responde; solo hay copia local"
fi

echo "$(date '+%Y-%m-%d %H:%M:%S') CORRECTO · 12 bases · $total_tablas tablas · $copias copias" > "$DESTINO/ultimo-estado.txt"
anotar "--- fin ---"
