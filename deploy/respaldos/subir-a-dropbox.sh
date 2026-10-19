#!/bin/bash
# Copia los respaldos a Dropbox, cifrados. Cron a las 4:00, media hora despues de
# que termine el respaldo de las 3:30.
#
# Por que existe: hasta el 28-ago-2026 los respaldos vivian SOLO en /opt/respaldos,
# en el mismo disco que las bases. Protegian contra un borrado accidental, no contra
# perder el servidor: si ese disco falla, se van las diez bases y sus copias a la vez.
#
# Va cifrado (rclone crypt) porque los volcados llevan datos de personas atendidas en
# la Consola Violeta y datos tributarios de contribuyentes. En Dropbox no se leen ni
# los nombres de los ficheros.
#
# LIMITE QUE CONVIENE TENER CLARO: la contraseña del cifrado vive en la configuracion
# de rclone de este servidor, porque el cron tiene que poder ejecutarse solo. Esto
# protege si alguien entra a la cuenta de Dropbox; NO protege si alguien entra al
# servidor. Las claves en claro estan en /opt/respaldos/CLAVES-CIFRADO-LEEME.txt y hay
# que guardarlas FUERA: sin ellas, lo que hay en Dropbox no se puede descifrar.

set -uo pipefail

ORIGEN_BASES="/opt/respaldos/bases"
ORIGEN_KARDEX="/opt/respaldos/kardex"
REMOTO="respaldos-cifrados:"
REGISTRO="/var/log/subir-a-dropbox.log"

registrar() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" | tee -a "$REGISTRO"; }

fallar() {
    registrar "ERROR $*"
    if [ -r /opt/avisos/avisos.sh ]; then
        . /opt/avisos/avisos.sh
        avisar error "La copia a Dropbox fallo" "$*

Los respaldos locales de /opt/respaldos siguen en su sitio; lo que no hay es copia
fuera del servidor. Registro: $REGISTRO"
    fi
    exit 1
}

registrar "=== inicio ==="

command -v rclone >/dev/null 2>&1 || fallar "rclone no esta instalado"
rclone listremotes 2>/dev/null | grep -qx "$REMOTO" || fallar "no existe el remoto $REMOTO"

# Nunca sincronizar un origen vacio: `sync` refleja el origen en el destino, asi que
# un respaldo que fallara y dejara la carpeta vacia BORRARIA la copia de Dropbox.
# Es el modo mas facil de convertir un fallo de una noche en la perdida de todo.
dias=$(find "$ORIGEN_BASES" -maxdepth 1 -type d -name '20*' 2>/dev/null | wc -l)
[ "$dias" -ge 1 ] || fallar "no hay ni una carpeta de respaldo en $ORIGEN_BASES; no se toca Dropbox"

total_local=$(find "$ORIGEN_BASES" -type f | wc -l)
registrar "origen: $dias dias, $total_local archivos, $(du -sh "$ORIGEN_BASES" | cut -f1)"

# --max-delete: un tope de borrados por ejecucion. En regimen normal se borra una
# carpeta de dia (la que cae por retencion), nunca decenas. Si el numero se dispara,
# algo va mal y es mejor que rclone se pare a que vacie el destino.
comun="--transfers 2 --checkers 4 --retries 3 --max-delete 60 --log-level NOTICE"

registrar "subiendo bases..."
# shellcheck disable=SC2086
salida=$(rclone sync "$ORIGEN_BASES" "${REMOTO}bases" $comun 2>&1)
[ $? -eq 0 ] || fallar "rclone fallo subiendo las bases: $(echo "$salida" | tail -3)"

if [ -d "$ORIGEN_KARDEX" ]; then
    registrar "subiendo kardex..."
    # shellcheck disable=SC2086
    salida=$(rclone sync "$ORIGEN_KARDEX" "${REMOTO}kardex" $comun 2>&1)
    [ $? -eq 0 ] || fallar "rclone fallo subiendo kardex: $(echo "$salida" | tail -3)"
fi

# Comprobar contra el destino, no contra el codigo de salida: es la misma leccion que
# dejo el guardado mudo de la Consola Violeta --que una operacion no devuelva error no
# significa que haya escrito algo--.
total_remoto=$(rclone size "${REMOTO}bases" --json 2>/dev/null | grep -oE '"count":[0-9]+' | cut -d: -f2)
[ -n "$total_remoto" ] || fallar "no se pudo leer el destino despues de subir"
[ "$total_remoto" -ge "$total_local" ] || fallar "en Dropbox hay $total_remoto archivos y en el servidor $total_local"

tam=$(rclone size "$REMOTO" 2>/dev/null | tail -1)
registrar "=== fin: $total_remoto archivos en Dropbox | $tam ==="
exit 0
