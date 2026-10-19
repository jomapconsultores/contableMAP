#!/bin/bash
# Biblioteca comun de avisos por Discord. No se ejecuta sola: se incluye con
#
#     . /opt/avisos/avisos.sh
#
# y luego se llama a  avisar NIVEL "titulo" "cuerpo".
#
# Si no hay webhook configurado NO falla: escribe el aviso por salida estandar y
# devuelve 0. Asi los scripts que la usan (respaldo, vigilante) siguen haciendo
# su trabajo aunque nadie haya puesto todavia la URL.

CONFIG_AVISOS="${CONFIG_AVISOS:-/opt/avisos/config.sh}"
[ -f "$CONFIG_AVISOS" ] && . "$CONFIG_AVISOS"

SERVIDOR_NOMBRE="${SERVIDOR_NOMBRE:-$(hostname)}"

# Escapa una cadena para meterla dentro de un valor JSON.
_escapar_json() {
    printf '%s' "$1" \
        | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/\r//g' \
        | sed -e ':a' -e 'N' -e '$!ba' -e 's/\n/\\n/g'
}

# avisar NIVEL "titulo" "cuerpo"
#   NIVEL: ok | aviso | error
# Devuelve 0 si se envio (o si no hay webhook), 1 si Discord rechazo el envio.
avisar() {
    local nivel="$1" titulo="$2" cuerpo="$3"

    if [ -z "${WEBHOOK_DISCORD:-}" ]; then
        echo "[aviso no enviado: falta WEBHOOK_DISCORD en $CONFIG_AVISOS] ($nivel) $titulo -- $cuerpo"
        return 0
    fi

    local color emoji
    case "$nivel" in
        ok)    color=3066993  ; emoji="OK" ;;      # verde
        aviso) color=16098851 ; emoji="AVISO" ;;   # ambar
        *)     color=15158332 ; emoji="ERROR" ;;   # rojo
    esac

    local t c cuerpo_json
    t=$(_escapar_json "[$emoji] $titulo")
    c=$(_escapar_json "$cuerpo")

    cuerpo_json=$(cat <<JSON
{"username":"Vigilante $SERVIDOR_NOMBRE","embeds":[{"title":"$t","description":"$c","color":$color,"footer":{"text":"$SERVIDOR_NOMBRE - $(date '+%Y-%m-%d %H:%M:%S %Z')"}}]}
JSON
)

    local codigo
    codigo=$(curl -s -o /dev/null -w '%{http_code}' -m 20 \
                  -H 'Content-Type: application/json' \
                  -X POST -d "$cuerpo_json" "$WEBHOOK_DISCORD" 2>/dev/null)

    # Discord responde 204 sin cuerpo cuando acepta el webhook.
    if [ "$codigo" = "204" ] || [ "$codigo" = "200" ]; then
        return 0
    fi
    echo "ERROR: Discord devolvio HTTP $codigo al enviar: $titulo" >&2
    return 1
}
