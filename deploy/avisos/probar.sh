#!/bin/bash
# Envia un aviso de prueba por Discord. Para comprobar el webhook nada mas
# pegarlo en /opt/avisos/config.sh:
#
#     /opt/avisos/probar.sh
#
# Si aparece en el canal, esta todo listo: el respaldo y el vigilante usan
# exactamente este mismo camino.

set -uo pipefail
. /opt/avisos/avisos.sh

if [ -z "${WEBHOOK_DISCORD:-}" ]; then
    echo "Falta WEBHOOK_DISCORD en /opt/avisos/config.sh."
    echo
    echo "En Discord: Ajustes del canal > Integraciones > Webhooks > Nuevo webhook"
    echo "y pega la URL en esa variable. El archivo ya tiene permisos 600."
    exit 1
fi

carga=$(awk '{print $2}' /proc/loadavg)
swap=$(awk '/^SwapTotal:/{t=$2} /^SwapFree:/{f=$2} END{if(t>0) printf "%.0f", (t-f)*100/t; else print 0}' /proc/meminfo)
disco=$(df --output=pcent / | tail -1 | tr -dc '0-9')

if avisar ok "Prueba de avisos" "Si ves este mensaje, el webhook funciona.

Estado ahora mismo:
Carga (5 min): $carga
Swap: $swap %
Disco: $disco %

Este es el mismo camino que usan el respaldo diario y el vigilante de recursos."
then
    echo "Enviado. Comprueba el canal de Discord."
else
    echo "No se pudo enviar. Revisa que la URL del webhook sea correcta y no haya caducado."
    exit 1
fi
