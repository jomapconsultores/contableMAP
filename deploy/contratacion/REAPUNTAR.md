# Reapuntar la aplicación de contratación

La base ya está migrada, verificada y respaldada. Lo único que falta es que la
aplicación mire al servidor propio en vez de a supabase.com.

## Por qué esto no se hace con variables de entorno

`csc` no es como las otras nueve. Es un `index.html` monolítico de 1,3 MB con el
código embebido, servido por nginx, y **no lee ninguna variable de entorno**: en
Coolify no hay ni una definida. La URL está escrita en el propio archivo, así
que reapuntarla es un cambio en el repositorio.

Por eso el barrido de contenedores no lo detectó en su día: buscaba conexiones
en el entorno de los procesos, y aquí el dato vive dentro del bundle.

## El cambio

Repositorio: `github.com/jomapconsultores/contratacion` (privado), rama `main`,
archivo `index.html`, líneas 909-910.

Antes:

```js
const SUPABASE_URL='https://uvtxqbegulsxrtlmsmrd.supabase.co';
const SUPABASE_ANON='sb_publishable_oJK8ZeVSJjOWG30UYXfv_g_XDiaW4xH';
```

Después:

```js
const SUPABASE_URL='https://supabase-cs.pensamiento-libre.org';
const SUPABASE_ANON='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzg3NTQwMTU1LCJleHAiOjIxMDI5MDAxNTV9.acdwe2a_YAnbmSMjApuX41zoVs3VTET3ZjLtua-v2fM';
```

Al hacer push, Coolify reconstruye la imagen y despliega solo.

## El orden importa

1. Crear primero `supabase-cs.pensamiento-libre.org` → `178.104.101.84`, sin proxy.
2. Esperar a que Traefik emita el certificado (el primer acceso HTTPS lo dispara).
3. Solo entonces, cambiar las dos líneas y hacer push.

Al revés, la aplicación queda apuntando a un dominio que todavía no resuelve.
Traefik reintenta la emisión con espera creciente, así que si el certificado se
pidió antes de existir el DNS, conviene reiniciar el stack para forzar otro
intento: `cd /opt/contratacion-supabase && docker compose restart`.

## Comprobación posterior

```sh
curl -s -o /dev/null -w '%{http_code}' https://supabase-cs.pensamiento-libre.org/rest/v1/
# 200 con clave válida · 401 sin ella

curl -s -o /dev/null -w '%{http_code}' https://contratacion.178.104.101.84.sslip.io
```

Y entrar con una de las 13 cuentas: las contraseñas son las de siempre, se
migraron los hashes.

---

## HECHO — 24 de agosto de 2026, 19:30 (hora de Ecuador)

**La aplicación ya trabaja contra el servidor propio.** Con esto, los diez
sistemas dependen del servidor y de supabase.com no depende nada en producción.

Cómo fue:

1. **Censo previo.** Las 13 tablas de la nube tenían exactamente los mismos
   recuentos que el servidor: **no hubo ni una escritura en todo el día**. La
   copia de la madrugada seguía siendo fiel.
2. **Sincronización de todas formas**, porque un recuento igual no descarta que
   alguien modificara una fila sin cambiar el total. 690 filas recargadas en una
   única transacción, con respaldo previo en
   `/opt/respaldos/contratacion-antes-de-sincronizar-2026-08-24-1928.sql.gz`.
3. **Secuencias realineadas** (`cronograma` → 5, las otras dos → 1).
4. **Publicado** el commit `d807177`. Coolify reconstruyó solo y levantó el
   contenedor nuevo en algo más de un minuto.

Comprobado después del despliegue, no antes:

- El `index.html` **servido** tiene 0 referencias a `uvtxqbegulsxrtlmsmrd` y 1 a
  `supabase-cs`. Se comprobó descargándolo, no mirando el repositorio.
- La clave que lleva la aplicación coincide con la `anon` del servidor.
- GoTrue del servidor responde `400 invalid_credentials` a un login falso desde
  el origen de la aplicación: autentica de verdad.
- El CORS devuelve `Access-Control-Allow-Origin` correcto y RLS da 0 filas sin
  sesión, que es lo que debe pasar.

Los 13 usuarios entran con sus contraseñas de siempre: los hashes se migraron.

**Pendiente:** rotar la clave `service_role` del proyecto en la nube, que se usó
para esta sincronización.

---

## Cómo estaba antes (histórico)

## Estado al 24 de agosto de 2026, 13:15 (hora de Ecuador)

El DNS `supabase-cs` **ya existe y responde**, así que el punto 1 del orden de
arriba está cumplido. Comprobado en vivo ese día:

- `https://supabase-cs.pensamiento-libre.org/rest/v1/` → 200 con la clave `anon`
- `/auth/v1/health` y `/storage/v1/version` → 200
- GoTrue devuelve `400 invalid_credentials` ante un login falso (responde bien)
- El CORS ya admite exactamente `https://contratacion.pensamiento-libre.org`
- La base tiene sus 13 tablas, 690 filas y 13 usuarios en `auth.users`

**El cambio de las dos líneas ya está aplicado** en el repositorio local
`contratacion_publica/automatizacion/contratacion-publicador/index.html`
(sin publicar, a la espera del paso de abajo). Cero referencias a
`uvtxqbegulsxrtlmsmrd` en el archivo.

### Falta sincronizar los datos antes de publicar

La copia del servidor se hizo la madrugada del 24-ago y **la aplicación ha
seguido escribiendo en supabase.com desde entonces**. Publicar sin sincronizar
haría retroceder lo que se haya trabajado ese día.

Ninguna tabla de negocio tiene columna de fecha, así que no hay manera de
detectar un delta —pero tampoco hace falta: el servidor no ha recibido ni una
escritura, porque ninguna aplicación lo usa. La nube es la fuente de verdad y
basta con recargarla entera. Eso hace `sincronizar-datos.sh`, que además
respalda la base del servidor antes de tocarla y carga todo en una sola
transacción con las claves ajenas suspendidas.

```sh
CLAVE_NUBE='sb_secret_...' ./sincronizar-datos.sh   # clave service_role del proyecto en la nube
# y acto seguido, publicar el reapuntado:
cd contratacion_publica/automatizacion/contratacion-publicador
git commit -am "Apuntar la aplicación al Supabase del servidor propio" && git push
```

El mecanismo de carga se probó contra la base real el 24-ago dentro de una
transacción revertida: vació `cronograma`, la recargó desde JSON y volvió atrás
sin dejar rastro.

**Decisión del usuario:** hacerlo al final de la jornada, para no congelar
trabajo de los 13 usuarios a media tarde.

**Aviso:** el proyecto `contratacion` está en la cuenta de Supabase
«Marco Antonio» (`opoogjmbeqxhcvxodixe`), no en la que ve el MCP ni en la de
atlas/calendario.
