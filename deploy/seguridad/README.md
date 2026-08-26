# Refuerzo de seguridad · 24 de agosto de 2026

## 1. Cabeceras de seguridad para todos los dominios

**Siete de las doce aplicaciones no enviaban ninguna cabecera de seguridad**:
`map`, `gestion`, `sistema`, `marketing`, `panel-marketing`, `proyectos` y
`multiagente`. Ni HSTS, ni `nosniff`, ni protección contra incrustación.

En vez de tocar los doce proyectos uno a uno, se aplicó **un middleware por
defecto en el entryPoint https de Traefik**, que cubre de golpe las aplicaciones
y las APIs de las bases.

- Middleware: `/data/coolify/proxy/dynamic/seguridad.yaml` (copia versionada aquí)
- Activación: se añadió `--entrypoints.https.http.middlewares=seguridad@file`
  a `/data/coolify/proxy/docker-compose.yml`
- Copia previa: `docker-compose.yml.antes-cabeceras-20260824`

Cabeceras que pone: `Strict-Transport-Security` (1 año, con subdominios),
`X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`,
`Referrer-Policy: strict-origin-when-cross-origin`,
`X-Permitted-Cross-Domain-Policies: none`, y vacía `Server` y `X-Powered-By`.

`SAMEORIGIN` y no `DENY` a propósito: `DENY` impediría incrustar una página en
otra del propio dominio, y no hay forma de saber desde fuera si alguna lo hace.

> **AVISO IMPORTANTE.** Coolify regenera `docker-compose.yml` del proxy cuando se
> reconfigura el servidor desde su interfaz. Si eso ocurre, **la línea del
> middleware se pierde** y las cabeceras dejan de aplicarse — el fichero
> `seguridad.yaml` seguiría ahí, pero sin nadie que lo invoque. Conviene
> comprobarlo después de cualquier cambio de proxy en Coolify:
>
> ```sh
> grep middlewares /data/coolify/proxy/docker-compose.yml
> curl -sI https://gestion.pensamiento-libre.org | grep -i strict-transport
> ```

## 2. RLS activado en tres bases

`atlas`, `calendario` y `pensamiento_libre` estaban protegidas **sólo por
privilegios**: `anon` no tenía permiso sobre las tablas, así que devolvían `401`.
Una sola capa. Detrás no había red: calendario tenía **0 de 39** tablas con RLS,
atlas 20 sin ella. Un `GRANT` mal dado las habría abierto por completo — y son
justo las que guardan `users`, `google_tokens`, `estudiantes` y `padres_familia`.

Se activó RLS en las 64 tablas que no lo tenían:

| Base | Antes | Después |
|---|---|---|
| atlas | 16/36 | **36/36** |
| calendario | 0/39 | **39/39** |
| pensamiento_libre | 0/5 | **5/5** |

**No rompe nada**, y se comprobó antes de aplicarlo: las tres aplicaciones leen
con `service_role`, que ignora RLS por diseño. Verificado después: las tres webs
responden 200 y las bases siguen sirviendo datos.

Nota: activar RLS sin políticas deniega todo salvo a `service_role`. Si algún día
una de estas aplicaciones pasa a consultar desde el navegador con `anon`, habrá
que escribirle políticas.

## Lo que NO se tocó, y por qué

**El rendimiento ya estaba optimizado.** Se comprobó: HTTP/2 y HTTP/3 activos,
TLS 1.3, compresión zstd/gzip. No había nada que ajustar en el servidor: los
~570 ms que se miden desde Ecuador son distancia física a Núremberg, no lentitud.
De cada consulta, ~383 ms se van en conectar y cifrar, y PostgreSQL responde en
0,4–3,6 ms.

La única mejora estructural pendiente sería **poner los dominios `supabase-*`
detrás del proxy de Cloudflare**, para que el cifrado termine cerca del usuario
en vez de en Alemania. Los dominios de aplicaciones ya van así y conectan en
~80 ms, frente a los ~190 ms de las bases: el ahorro estimado son 200–300 ms por
consulta. Requiere tocar el DNS en Cloudflare y comprobar que no interfiere con
la API.
