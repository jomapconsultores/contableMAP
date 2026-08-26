#!/usr/bin/env bash
#
# Dispara las secuencias de outreach de Marketing cada 10 minutos.
#
# Sustituye al trabajo de pg_cron que traía el proyecto alojado, que llamaba a
# `marketing-map-backend.onrender.com`. Ese servidor ya no existe y responde
# 404, así que las secuencias llevaban tiempo sin ejecutarse sin que nadie lo
# notara. Aquí apunta al backend que sí está en marcha.
#
# Se usa cron del sistema en lugar de pg_cron por dos razones: pg_cron exige
# recargar PostgreSQL con bibliotecas precargadas —un reinicio de la base que
# también afectaría a ContableMAP—, y así queda un registro de cada ejecución
# que se puede mirar cuando algo no cuadre.
#
# El secreto de autenticación se lee del propio contenedor del backend en cada
# ejecución, para no mantener una segunda copia en disco que se desincronice
# el día que se rote.

set -uo pipefail

REGISTRO=/var/log/marketing-secuencias.log
DESTINO=https://api.marketing.pensamiento-libre.org/cron/run-sequences

CONTENEDOR=$(docker ps --format '{{.Names}}' | grep '^e14nh7' | head -1)
if [ -z "$CONTENEDOR" ]; then
  echo "$(date -Is) · backend no está en marcha, se omite" >> "$REGISTRO"
  exit 0
fi

SECRETO=$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$CONTENEDOR" \
          | grep '^CRON_SECRET=' | cut -d= -f2-)

CODIGO=$(curl -s -o /dev/null -w '%{http_code}' -X POST \
  -H 'Content-Type: application/json' \
  -H "x-cron-secret: $SECRETO" \
  --max-time 60 "$DESTINO")

echo "$(date -Is) · HTTP $CODIGO" >> "$REGISTRO"

# Se conservan las últimas 500 líneas: sin esto el archivo crecería sin fin.
tail -500 "$REGISTRO" > "$REGISTRO.tmp" 2>/dev/null && mv "$REGISTRO.tmp" "$REGISTRO"
