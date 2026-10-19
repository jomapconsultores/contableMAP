#!/bin/bash
# Vigila swap, carga, RAM y disco, y avisa por Discord cuando algo cruza su
# limite. Lo dispara cron cada 10 minutos.
#
# Por que existe: Coolify solo sabe notificar por uso de DISCO, que es
# justamente el recurso que sobra en este servidor (18 %). Lo que aprieta es la
# RAM -- swap al 84 % y carga muy por encima de los 2 vCPU -- y de eso no avisa
# nadie.
#
# CLAVE DEL DISENO -- avisa en el CRUCE, no mientras dura:
# Si la swap lleva semanas al 84 %, un aviso "swap alta" cada 10 minutos seria
# ruido y acabarias silenciando el canal. Se guarda el estado de cada metrica en
# /var/lib/avisos/estado y solo se avisa cuando pasa de normal a alarma, o de
# alarma a normal. Ademas los umbrales de subida y bajada son distintos
# (histeresis): una metrica que oscila alrededor del limite no genera una ristra
# de avisos alternos.

set -uo pipefail

. /opt/avisos/avisos.sh

ESTADO_DIR="/var/lib/avisos"
ESTADO="$ESTADO_DIR/estado"
REGISTRO="/var/log/vigilar-recursos.log"

# metrica          alarma   recuperacion
UMBRAL_SWAP=90;    SALIDA_SWAP=80      # % de swap ocupada
UMBRAL_CARGA=4.0;  SALIDA_CARGA=2.5    # carga de 5 min por nucleo
UMBRAL_RAM=250;    SALIDA_RAM=400      # MB disponibles (al reves: alarma si es MENOR)
UMBRAL_DISCO=80;   SALIDA_DISCO=75     # % de disco usado

mkdir -p "$ESTADO_DIR"
touch "$ESTADO"

registrar() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$REGISTRO"; }

esta_en_alarma() { grep -qx "$1" "$ESTADO" 2>/dev/null; }
marcar()   { esta_en_alarma "$1" || echo "$1" >> "$ESTADO"; }
desmarcar() { grep -vx "$1" "$ESTADO" > "$ESTADO.tmp" 2>/dev/null; mv "$ESTADO.tmp" "$ESTADO"; }

# revisar CLAVE "nombre" VALOR UMBRAL SALIDA SENTIDO "detalle"
#   SENTIDO=mayor  -> alarma si valor >= umbral   (swap, carga, disco)
#   SENTIDO=menor  -> alarma si valor <= umbral   (RAM disponible)
revisar() {
    local clave="$1" nombre="$2" valor="$3" umbral="$4" salida="$5" sentido="$6" detalle="$7"
    local en_alarma=0 vuelve=0

    if [ "$sentido" = "mayor" ]; then
        en_alarma=$(awk -v v="$valor" -v u="$umbral" 'BEGIN{print (v>=u)?1:0}')
        vuelve=$(awk -v v="$valor" -v s="$salida" 'BEGIN{print (v<=s)?1:0}')
    else
        en_alarma=$(awk -v v="$valor" -v u="$umbral" 'BEGIN{print (v<=u)?1:0}')
        vuelve=$(awk -v v="$valor" -v s="$salida" 'BEGIN{print (v>=s)?1:0}')
    fi

    if [ "$en_alarma" = "1" ] && ! esta_en_alarma "$clave"; then
        marcar "$clave"
        registrar "ALARMA $nombre: $detalle"
        avisar error "$nombre ha cruzado el limite" "$detalle"
    elif [ "$vuelve" = "1" ] && esta_en_alarma "$clave"; then
        desmarcar "$clave"
        registrar "RECUPERADO $nombre: $detalle"
        avisar ok "$nombre ha vuelto a la normalidad" "$detalle"
    fi
}

# --- lecturas ---
leer_swap() {
    awk '/^SwapTotal:/{t=$2} /^SwapFree:/{f=$2}
         END{ if (t>0) printf "%.1f %d %d", (t-f)*100/t, (t-f)/1024, t/1024; else print "0 0 0" }' /proc/meminfo
}
leer_ram_disponible() { awk '/^MemAvailable:/{printf "%d", $2/1024}' /proc/meminfo; }
leer_carga5()  { awk '{print $2}' /proc/loadavg; }
leer_disco()   { df --output=pcent / | tail -1 | tr -dc '0-9'; }

NUCLEOS=$(nproc)

read -r SWAP_PCT SWAP_USADA_MB SWAP_TOTAL_MB <<< "$(leer_swap)"
RAM_MB=$(leer_ram_disponible)
CARGA5=$(leer_carga5)
CARGA_POR_NUCLEO=$(awk -v c="$CARGA5" -v n="$NUCLEOS" 'BEGIN{printf "%.2f", c/n}')
DISCO_PCT=$(leer_disco)

revisar swap "Swap" "$SWAP_PCT" "$UMBRAL_SWAP" "$SALIDA_SWAP" mayor \
    "Swap al ${SWAP_PCT} % (${SWAP_USADA_MB} de ${SWAP_TOTAL_MB} MB). Limite: ${UMBRAL_SWAP} %. Con la swap llena, el siguiente proceso que pida memoria lo mata el kernel."

revisar carga "Carga" "$CARGA_POR_NUCLEO" "$UMBRAL_CARGA" "$SALIDA_CARGA" mayor \
    "Carga de 5 min: ${CARGA5} sobre ${NUCLEOS} vCPU = ${CARGA_POR_NUCLEO} por nucleo. Limite: ${UMBRAL_CARGA}."

revisar ram "RAM disponible" "$RAM_MB" "$UMBRAL_RAM" "$SALIDA_RAM" menor \
    "Quedan ${RAM_MB} MB disponibles. Limite: ${UMBRAL_RAM} MB."

revisar disco "Disco" "$DISCO_PCT" "$UMBRAL_DISCO" "$SALIDA_DISCO" mayor \
    "Disco raiz al ${DISCO_PCT} %. Limite: ${UMBRAL_DISCO} %."

# Con --detalle imprime la foto actual sin avisar de nada. Para comprobar a mano.
if [ "${1:-}" = "--detalle" ]; then
    echo "swap            : ${SWAP_PCT} % (${SWAP_USADA_MB}/${SWAP_TOTAL_MB} MB)   limite ${UMBRAL_SWAP}"
    echo "carga 5 min     : ${CARGA5} / ${NUCLEOS} vCPU = ${CARGA_POR_NUCLEO}      limite ${UMBRAL_CARGA}"
    echo "RAM disponible  : ${RAM_MB} MB                  limite ${UMBRAL_RAM} (por debajo)"
    echo "disco           : ${DISCO_PCT} %                       limite ${UMBRAL_DISCO}"
    echo "en alarma ahora : $(tr '\n' ' ' < "$ESTADO" | sed 's/ $//')"
fi

exit 0
