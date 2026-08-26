#!/bin/bash
# Respaldo diario de todas las bases PostgreSQL del servidor.
#
# Lo dispara cron cada madrugada. Recorre las cinco instancias, y dentro de cada
# una respalda TODAS sus bases -- la de ContableMAP aloja ocho, no una--, mas los
# roles de la instancia, que sin ellos un volcado no se puede restaurar: las
# politicas RLS dependen de anon, authenticated y service_role.
#
# Cada volcado se verifica leyendo su indice antes de darlo por bueno, y se
# escribe primero como .parcial para no dejar nunca un archivo a medias.
#
# Restauracion de una base -- IMPORTANTE, usar supabase_admin y no postgres:
#
#   docker exec -i INSTANCIA psql -U postgres -c 'CREATE DATABASE destino;'
#   docker exec -i INSTANCIA pg_restore -U supabase_admin -d destino < INSTANCIA--BASE.dump
#
# Con -U postgres la restauracion tambien deja los datos bien, pero suelta 141
# avisos y 21 "permission denied" sobre objetos internos de Supabase (vault.secrets,
# funciones de extensiones): postgres no es superusuario en la imagen de Supabase.
# Con supabase_admin son cero avisos. Comprobado el 24-ago-2026 restaurando
# contratacion: 690 filas, 23 politicas, 45 funciones, 13 usuarios y los dos
# disparadores sobre auth.users, identicos al origen.
#
# Devolver los archivos de un bucket (la lista ya viene en el volcado de la base):
#   tar xzf INSTANCIA-archivos.tar.gz -C /mnt/HC_Volume_106171631/INSTANCIA/storage
#
# Los roles son aparte y van primero si la instancia es nueva:
#   gunzip -c INSTANCIA-roles.sql.gz | docker exec -i INSTANCIA psql -U postgres
set -uo pipefail

DESTINO="/opt/respaldos/bases"
DIAS_RETENCION=30
REGISTRO="/var/log/respaldo-bases.log"
INSTANCIAS="contable gestion tributos conecta contratacion"
RAIZ_STORAGE="/mnt/HC_Volume_106171631"

FECHA="$(date +%F)"
CARPETA="$DESTINO/$FECHA"
correctos=0
fallidos=0

registrar() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" | tee -a "$REGISTRO"; }

mkdir -p "$CARPETA"
registrar "=== inicio del respaldo $FECHA ==="

for instancia in $INSTANCIAS; do
    contenedor="${instancia}-supabase-db-1"

    if ! docker ps --format '{{.Names}}' | grep -qx "$contenedor"; then
        registrar "ERROR $contenedor no esta en marcha; se omite"
        fallidos=$((fallidos + 1))
        continue
    fi

    # Los roles son de la instancia, no de cada base. Sin ellos no hay restauracion.
    archivo_roles="$CARPETA/${instancia}-roles.sql.gz"
    if docker exec "$contenedor" pg_dumpall -U postgres --globals-only 2>>"$REGISTRO" | gzip > "$archivo_roles.parcial"; then
        mv "$archivo_roles.parcial" "$archivo_roles"
        registrar "OK   ${instancia}/roles ($(du -h "$archivo_roles" | cut -f1))"
        correctos=$((correctos + 1))
    else
        rm -f "$archivo_roles.parcial"
        registrar "ERROR no se pudieron volcar los roles de $instancia"
        fallidos=$((fallidos + 1))
    fi

    bases=$(docker exec "$contenedor" psql -U postgres -d postgres -t -A \
            -c "SELECT datname FROM pg_database WHERE datistemplate = false AND datallowconn;" 2>>"$REGISTRO")

    if [ -z "$bases" ]; then
        registrar "ERROR no se pudo listar las bases de $instancia"
        fallidos=$((fallidos + 1))
        continue
    fi

    for base in $bases; do
        archivo="$CARPETA/${instancia}--${base}.dump"
        if ! docker exec "$contenedor" pg_dump -U postgres -d "$base" -Fc -Z6 2>>"$REGISTRO" > "$archivo.parcial"; then
            rm -f "$archivo.parcial"
            registrar "ERROR fallo el volcado de ${instancia}/${base}"
            fallidos=$((fallidos + 1))
            continue
        fi
        # Un volcado que no se puede leer no es un respaldo. Se comprueba antes de aceptarlo.
        if ! docker exec -i "$contenedor" pg_restore -l < "$archivo.parcial" > /dev/null 2>>"$REGISTRO"; then
            rm -f "$archivo.parcial"
            registrar "ERROR el volcado de ${instancia}/${base} no es legible; descartado"
            fallidos=$((fallidos + 1))
            continue
        fi
        mv "$archivo.parcial" "$archivo"
        registrar "OK   ${instancia}/${base} ($(du -h "$archivo" | cut -f1))"
        correctos=$((correctos + 1))
    done
done

# --- Archivos de los buckets de Storage ---
# La metadata (que archivo es cada cual, de que bucket y de quien) ya viaja dentro
# del volcado de cada base, en el esquema storage. Lo que pg_dump no toca son los
# binarios: viven en un volumen Hetzner aparte, montado en /mnt/HC_Volume_106171631.
# Sin esta parte, una restauracion devolveria la lista de archivos y ni un archivo.
for instancia in $INSTANCIAS; do
    origen="$RAIZ_STORAGE/$instancia/storage"

    if [ ! -d "$origen" ]; then
        registrar "AVISO $instancia no tiene carpeta de archivos; se omite"
        continue
    fi

    n=$(find "$origen" -type f 2>/dev/null | wc -l)
    if [ "$n" -eq 0 ]; then
        registrar "OK   ${instancia}/archivos (ninguno que guardar)"
        continue
    fi

    archivo="$CARPETA/${instancia}-archivos.tar.gz"
    if tar czf "$archivo.parcial" -C "$origen" . 2>>"$REGISTRO"        && tar tzf "$archivo.parcial" > /dev/null 2>>"$REGISTRO"; then
        mv "$archivo.parcial" "$archivo"
        registrar "OK   ${instancia}/archivos ($n archivos, $(du -h "$archivo" | cut -f1))"
        correctos=$((correctos + 1))
    else
        rm -f "$archivo.parcial"
        registrar "ERROR fallo el respaldo de los archivos de $instancia"
        fallidos=$((fallidos + 1))
    fi
done

# Se borra por carpeta de dia, no por archivo suelto.
find "$DESTINO" -maxdepth 1 -type d -name '20*' -mtime +$DIAS_RETENCION -exec rm -rf {} + 2>/dev/null

registrar "=== fin: $correctos correctos, $fallidos fallidos, $(du -sh "$CARPETA" | cut -f1) en $CARPETA ==="
registrar "dias conservados: $(find "$DESTINO" -maxdepth 1 -type d -name '20*' | wc -l) | disco libre: $(df -h /opt | awk 'NR==2{print $4}')"

[ "$fallidos" -gt 0 ] && exit 1
exit 0
