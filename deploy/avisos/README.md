# Avisos por Discord

Montado el 26 de agosto de 2026. Cubre dos huecos que estaban abiertos:

1. **El respaldo fallaba en silencio.** El script contaba los fallos y salía con
   código 1, pero cron se come ese código: todo quedaba en un log local del propio
   servidor. Te enterabas el día que tocara restaurar.
2. **Nadie vigila la RAM.** Coolify solo sabe notificar por **uso de disco**, que es
   justo el recurso que sobra aquí (18 % de 38 GB). Lo que aprieta es la memoria, y de
   eso no avisaba nada.

## Qué queda instalado

| Archivo | Qué hace |
|---|---|
| `/opt/avisos/config.sh` | La URL del webhook. Permisos 600, **no va a Dropbox** |
| `/opt/avisos/avisos.sh` | Biblioteca común: la función `avisar` |
| `/opt/avisos/vigilar-recursos.sh` | Vigila swap, carga, RAM y disco. Cron cada 10 min |
| `/opt/avisos/probar.sh` | Manda un aviso de prueba |
| `/opt/respaldos/respaldo-bases.sh` | Modificado: avisa al terminar |

## Poner en marcha

En Discord: **Ajustes del canal › Integraciones › Webhooks › Nuevo webhook**, copiar la
URL y pegarla en `WEBHOOK_DISCORD` dentro de `/opt/avisos/config.sh`. Después:

```sh
/opt/avisos/probar.sh
```

Si el mensaje aparece en el canal, ya está: el respaldo y el vigilante usan ese mismo
camino. **Sin webhook nada falla** — los avisos se escriben por salida estándar y los
scripts siguen haciendo su trabajo.

La URL del webhook es una credencial: quien la tenga puede escribir en el canal. Por eso
`config.sh` no se guarda aquí, solo el `config.sh.ejemplo`.

## Umbrales del vigilante

| Métrica | Avisa | Se recupera |
|---|---|---|
| Swap | ≥ 90 % | ≤ 80 % |
| Carga (5 min, por núcleo) | ≥ 4,0 | ≤ 2,5 |
| RAM disponible | ≤ 250 MB | ≥ 400 MB |
| Disco | ≥ 80 % | ≤ 75 % |

**Avisa en el cruce, no mientras dura.** Es la decisión de diseño que más importa: la
swap de este servidor pasa temporadas al 75-85 %, y un aviso cada 10 minutos acabaría
con el canal silenciado — que es como no tener avisos, pero creyendo que los tienes. Se
guarda el estado de cada métrica en `/var/lib/avisos/estado` y solo se avisa al pasar de
normal a alarma y de alarma a normal.

Los umbrales de subida y bajada son distintos a propósito (histéresis): una métrica que
oscila justo en el límite no genera una ristra de avisos alternos.

El umbral de disco (80 %) coincide con el de la limpieza de Docker de Coolify, así que
el aviso llega cuando esa limpieza debería estar actuando.

Para cambiar un umbral, editar las variables del principio de `vigilar-recursos.sh`.
Ver la foto actual sin avisar de nada:

```sh
/opt/avisos/vigilar-recursos.sh --detalle
```

## El parte diario del respaldo

Cuando el respaldo va bien **también avisa**. Puede parecer ruido, pero tiene un motivo:
si un día no llega nada, sabes que el cron dejó de correr. Un aviso solo-si-falla nunca
te diría eso — un cron muerto y un servidor sano se ven exactamente igual.

Para desactivarlo, añadir a `/opt/avisos/config.sh`:

```sh
RESUMEN_DIARIO=0
```

## Comprobado el 26-ago-2026

- Alarma al cruzar el umbral, con el aviso correspondiente.
- Segunda ejecución en el mismo estado: **no repite**.
- Vuelta a la normalidad: avisa y limpia el estado.
- Respaldo real ejecutado con el cambio: 21 volcados correctos, 0 fallidos.
- Falta por probar **solo el envío real a Discord**, que necesita el webhook.

## Registros

- `/var/log/vigilar-recursos.log` — alarmas y recuperaciones
- `/var/log/respaldo-bases.log` — el respaldo diario
