#!/usr/bin/env bash
#
# Respaldo diario de ContableMAP.
#
# Instalado en /opt/contable-supabase/respaldo.sh y disparado por cron a las
# 03:15. Se puede ejecutar a mano en cualquier momento.
#
# Guarda tres cosas, porque restaurar solo la base no devuelve el sistema:
#
#   1. La base entera (`-Fc`, formato comprimido de PostgreSQL). Incluye la
#      contabilidad, los usuarios de `auth` y el inventario de `storage`.
#   2. Los archivos: PDF de los estados de cuenta, XML del SRI y el
#      certificado `.p12`. Sin ellos, las facturas emitidas pierden su
#      respaldo documental y no se puede volver a firmar.
#   3. El `.env` del stack. Sin `JWT_SECRET` las claves de la aplicación dejan
#      de validar, y sin `SRI_CERT_SECRET` la contraseña del certificado —que
#      viaja cifrada dentro de la base— no se puede descifrar. Un volcado sin
#      este archivo es un volcado que no se puede poner en marcha.
#
# El respaldo va al Volume y la base vive en el disco de sistema: si uno de los
# dos discos falla, el otro conserva su parte.
#
# ATENCIÓN: esto NO protege de perder el servidor. Para eso hace falta que las
# copias salgan de la máquina — ver el bloque del final.

set -euo pipefail

DESTINO=/mnt/HC_Volume_106171631/contable/respaldos
CONTENEDOR=contable-supabase-db-1
ARCHIVOS=/mnt/HC_Volume_106171631/contable/storage
ENV_STACK=/opt/contable-supabase/.env
RETENCION_DIAS=30

FECHA=$(date +%Y%m%d-%H%M)
CARPETA="$DESTINO/$FECHA"
REGISTRO="$DESTINO/registro.log"

anotar() { echo "$(date '+%Y-%m-%d %H:%M:%S') · $*" | tee -a "$REGISTRO"; }

fallo() {
  anotar "FALLO: $1"
  echo "$(date '+%Y-%m-%d %H:%M:%S') FALLO: $1" > "$DESTINO/ultimo-estado.txt"
  exit 1
}

mkdir -p "$CARPETA"
anotar "--- inicio del respaldo $FECHA ---"

# --- 1. La base ------------------------------------------------------------
docker exec "$CONTENEDOR" pg_dump -U postgres --format=custom --compress=9 postgres \
  > "$CARPETA/base.dump" 2>>"$REGISTRO" || fallo "pg_dump"

# Un archivo que existe no es un archivo restaurable. `pg_restore --list` lee
# la tabla de contenidos: si el volcado se truncó a medias, aquí se ve.
TABLAS=$(docker exec -i "$CONTENEDOR" pg_restore --list < "$CARPETA/base.dump" 2>/dev/null | grep -c "TABLE DATA" || true)
[ "$TABLAS" -gt 0 ] || fallo "el volcado no contiene datos legibles"
anotar "base: $(du -h "$CARPETA/base.dump" | cut -f1), $TABLAS tablas con datos"

# --- 2. Los archivos -------------------------------------------------------
tar -czf "$CARPETA/archivos.tar.gz" -C "$ARCHIVOS" . 2>>"$REGISTRO" || fallo "tar de archivos"
CUANTOS=$(tar -tzf "$CARPETA/archivos.tar.gz" | grep -c "" || true)
anotar "archivos: $(du -h "$CARPETA/archivos.tar.gz" | cut -f1), $CUANTOS entradas"

# --- 3. Las credenciales del stack -----------------------------------------
cp "$ENV_STACK" "$CARPETA/env-stack.txt" || fallo "copia del .env"
chmod 600 "$CARPETA/env-stack.txt"

# --- Rotación --------------------------------------------------------------
# Se borran las carpetas más viejas que la retención. `-mindepth 1` evita que
# un fallo de variable acabe borrando el propio directorio de respaldos.
find "$DESTINO" -mindepth 1 -maxdepth 1 -type d -mtime +$RETENCION_DIAS -exec rm -rf {} + 2>/dev/null || true
COPIAS=$(find "$DESTINO" -mindepth 1 -maxdepth 1 -type d | wc -l)

anotar "correcto · $COPIAS copias guardadas · ocupan $(du -sh "$DESTINO" | cut -f1)"
echo "$(date '+%Y-%m-%d %H:%M:%S') CORRECTO · $TABLAS tablas · $CUANTOS archivos · $COPIAS copias" \
  > "$DESTINO/ultimo-estado.txt"

# --- Copia fuera del servidor ---------------------------------------------
#
# Lo anterior protege de un borrado accidental o de que falle un disco. Esto
# protege de perder el servidor entero, que es el riesgo que de verdad se
# lleva una contabilidad por delante.
#
# Va a Dropbox por rclone. La cuenta tiene poco espacio libre, así que en
# remoto se guarda menos que en local: los últimos 7 días y el primero de cada
# mes. Con copias de ~3 MB eso son unos 60 MB en total.
#
# AVISO: el paquete incluye `env-stack.txt`, con JWT_SECRET y SRI_CERT_SECRET.
# Quien tenga acceso a este Dropbox tiene esas claves. Va así a propósito —un
# respaldo sin ellas no se puede poner en marcha—, pero si prefieres cifrarlo,
# el camino es un remoto `crypt` de rclone por encima de este.

REMOTO="dropbox:09_RESPALDOS/contable-map"
DIAS_EN_REMOTO=7

if rclone about dropbox: >/dev/null 2>&1; then
  rclone copy "$CARPETA" "$REMOTO/$FECHA" --transfers 4 2>>"$REGISTRO"     && anotar "subido a Dropbox: $REMOTO/$FECHA"     || anotar "AVISO: fallo al subir a Dropbox (la copia local sí está)"

  # Retención en remoto: se conservan los últimos $DIAS_EN_REMOTO y, de los
  # más antiguos, solo los que caen en día 1 —un punto de retorno por mes—.
  LIMITE=$(date -d "-$DIAS_EN_REMOTO days" +%Y%m%d)
  rclone lsf "$REMOTO" --dirs-only 2>/dev/null | tr -d '/' | while read -r copia; do
    dia="${copia%%-*}"
    [ ${#dia} -eq 8 ] || continue
    if [ "$dia" -lt "$LIMITE" ] && [ "${dia:6:2}" != "01" ]; then
      rclone purge "$REMOTO/$copia" 2>/dev/null && anotar "  purgada en remoto: $copia"
    fi
  done

  EN_REMOTO=$(rclone lsf "$REMOTO" --dirs-only 2>/dev/null | wc -l)
  anotar "copias en Dropbox: $EN_REMOTO"
else
  anotar "AVISO: Dropbox no responde; solo hay copia local"
fi

anotar "--- fin ---"
