# Traer todo al servidor propio

Inventario y plan para migrar el resto de bases de datos alojadas en
supabase.com al servidor `ubuntu-4gb-nbg1-1` (178.104.101.84), siguiendo el
patrón ya validado con ContableMAP.

Levantado del servidor el 24 de agosto de 2026, leyendo a qué apunta cada
contenedor en marcha.

## Progreso (24 de agosto de 2026)

| Proyecto | Datos | Archivos | Servicios | Aplicación |
|---|---|---|---|---|
| ContableMAP | 308 filas ✅ | 10 ✅ | ✅ | **en el servidor** |
| MK_MaP (Marketing) | 963 ✅ | — | ✅ | **en el servidor** |
| proyectos | 31 ✅ | — | ✅ | **en el servidor** |
| Gestión contable | 45.931 ✅ | 4 ✅ | ✅ | **en el servidor** |
| tributos | 66.892 ✅ · 4 usuarios con contraseña ✅ | 9 ✅ | ✅ | **en el servidor** |
| ATLAS | ✅ · 36 tablas | — | ✅ | **en el servidor** |
| Calendario | ✅ · 39 tablas | — | ✅ | **en el servidor** |
| Pensamiento Libre | ✅ · 5 tablas | — | ✅ | **en el servidor** |
| conecta | ✅ · 34 tablas, 13.862 filas | — | ✅ 4 servicios | **en el servidor** |
| contratación (CSC) | ✅ · 13 tablas, 690 filas | 2 ✅ | ✅ 4 servicios | falta DNS y 2 líneas de código |

**Las nueve aplicaciones corren ya contra el servidor propio.** Comprobado
recorriendo los 43 contenedores en marcha: ninguno nombra `supabase.co` en su
entorno. De supabase.com no depende nada en producción.

### Lo que falta

**Rotar credenciales.** El token de Google de calendario, las dos claves `anon`
que están en el historial de dos repositorios públicos, y los tokens que
circularon durante la migración: tres PAT de Supabase, dos de Cloudflare y el de
Coolify.

**Las contraseñas de conecta.** Los cinco usuarios están con su identificador
original —y los cinco `profiles` enlazan— pero sin contraseña: la API de
administración de GoTrue no expone los hashes y ningún token de gestión alcanza
ese proyecto. O se consigue uno, o se generan cinco enlaces de recuperación.

**Cerrar `anon` en `atlas-sistema` y `calendarios-map`**, o pausarlos.

**Cuatro proyectos de Coolify sin revisar**: `Kardex`, `Multiagente`, `csc` y
`vinculacion`. Ninguno apareció en el barrido de contenedores que usan
`supabase.co`, así que en principio no dependen de Supabase.

### El décimo proyecto, y por qué no aparecía

`contratacion` (`uvtxqbegulsxrtlmsmrd`) no salió en ningún inventario hasta que
el usuario preguntó por él. El barrido que dio por buenos los demás recorría los
43 contenedores buscando cadenas de conexión en `docker inspect` del entorno.
`csc` es un frontend compilado servido por nginx: su URL y su clave viven
**dentro del bundle**, no en variables. El barrido no dio un falso negativo por
error de ejecución, sino por diseño: miraba donde el dato no estaba.

Es la tercera vez que el mismo patrón muerde —antes con `vencimiento_avisos` y
con el puente `atlas_sync`—. La forma corta de decirlo: **una comprobación que
sale limpia solo prueba algo si podía haber salido sucia.**

**La clave de servicio no basta para migrar.** El usuario facilitó primero la
`sb_secret_` del proyecto, que da acceso a los datos pero no al catálogo. Con
ella se habrían copiado las 690 filas y se habría perdido lo que sostiene la
seguridad: 45 funciones (`es_miembro`, `es_superadmin`, `es_admin_de`,
`puede_editar`) que las 23 políticas invocan. Reconstruir sin ellas deja dos
finales, y los dos malos: con RLS y sin políticas la aplicación no ve nada; sin
RLS, cualquiera de las dos empresas ve los datos de la otra. Son 13 usuarios de
una entidad pública. Hizo falta un token de gestión, y con él el esquema salió
idéntico al origen en las siete métricas.

**El extractor solo saca los disparadores de `public`.** Este proyecto tenía dos
sobre `auth.users` —`on_auth_user_created` y `trg_auth_libera_clave`— que se
perdían en silencio. Se añadieron a mano. Conviene revisarlo si se vuelve a usar
`extraer-esquema.mjs`.

Queda pendiente el reapuntado, documentado en `deploy/contratacion/REAPUNTAR.md`:
esta aplicación no lee variables de entorno, así que hay que cambiar dos líneas
del `index.html` en su repositorio y crear el registro DNS `supabase-cs`.

### Los proyectos de origen siguen expuestos (24 de agosto de 2026)

Al comprobar el estado de `cuentas_pago_docentes` apareció algo mayor, y está
en supabase.com, no en el servidor nuevo. En los dos proyectos de origen el rol
`anon` conserva SELECT sobre casi todas las tablas, y no hay ni una sola
política RLS en `public` que lo limite:

| Proyecto | Tablas legibles con la clave `anon` |
|---|---|
| `naubddczohedvtywmmmy` (ATLAS) | 20 · entre ellas `usuarios`, `estudiantes`, `padres_familia`, `citas_psicologia`, `pagos`, `pagos_docentes` |
| `lqdpirsfzodmbeyoivww` (Calendario) | 39, es decir todas · entre ellas `google_tokens`, `ms_tokens`, `password_log`, `webauthn_credentials`, `face_descriptors`, `users` |

Sin clave, Supabase responde 401. Con la clave `anon`, todo eso se lee. Y esa
clave es pública: los dos repositorios lo son —comprobado contra la API de
GitHub— y cada uno lleva la suya en el historial de git.

| Repositorio | Visibilidad | Clave en el historial |
|---|---|---|
| `jomapconsultores/atlas-sistema` | **pública**, 0 forks | `anon` de `naubddczohedvtywmmmy` |
| `jomapconsultores/calendarios-map-app` | **pública**, 0 forks | `anon` de `lqdpirsfzodmbeyoivww` |

Hay un commit titulado «Fix: auditoria de seguridad» que la quitó del código en
su día, pero quitar un secreto en un commit posterior no lo borra del historial.

O sea que hoy, sin credenciales de nadie, se pueden clonar dos repositorios
públicos, sacar las claves y leer datos de menores, credenciales de Google y de
Microsoft, registros de contraseñas y descriptores faciales.

Comprobado antes de recomendar nada: ninguno de los dos proyectos tiene Edge
Functions ni funciones `SECURITY DEFINER`, así que por `anon` no entra nada más
que las aplicaciones, y esas ya no miran ahí. Revocar no rompe nada.
El SQL está listo en `deploy/supabase/cerrar-anon-origen.sql`.

Esto no lo introdujo la migración: es el estado que traían. En el servidor nuevo
ya está cerrado —`anon` tiene cero tablas en las dos bases, comprobado también
desde fuera—, pero mientras los proyectos de origen sigan activos la exposición
continúa, y ahora ya no la tapa nadie porque ninguna aplicación los usa.

Mitigación, en orden de preferencia:

1. **Revocar `anon` en los dos proyectos de origen**, con
   `cerrar-anon-origen.sql`. Es lo que corta la exposición hoy y no estorba la
   vuelta atrás, porque las aplicaciones entran con `service_role`.
2. **Rotar las dos claves `anon`** en sus paneles. Esto es lo que de verdad
   cierra el asunto: el revoke corta el acceso, pero la clave sigue viva. No
   tiene sentido reescribir el historial de un repositorio público del que
   puede haber clones; lo efectivo es invalidar la clave.
3. **Revisar si esos repositorios deben seguir siendo públicos.**
4. **Pausar los proyectos de origen** cuando pasen unos días estables, no antes:
   son la vuelta atrás.

Y rotar el token de Google, que ya no es prudencia: `google_tokens` se lee ahora
mismo en el origen con una clave que está en un repositorio público.

**`migration_cuentas_pago.sql` describe un estado que la base nunca tuvo.** El
archivo activa RLS, crea una política y concede `grant all` a `anon` sobre
`cuentas_pago_docentes`. En el origen esa tabla no tiene ninguna política —no
las hay en todo `public`— ni grants a `anon`. Nunca se aplicó, igual que la 030.
Conviene no reaplicarlo tal cual sobre la base nueva: reabriría a `anon` una
tabla de cuentas de pago.

Matiz que corrige la lección anterior: el código tampoco es la verdad. El repo
describe un estado y la base tiene otro. Ninguna de las dos fuentes basta por sí
sola; hay que cruzarlas.

### Regla de decisión: cuándo revocar `anon` protege y cuándo rompe

El mismo comando cura en una base y envenena en otra. Antes de aplicar
`cerrar-anon.sql`, mirar si las tablas tienen políticas RLS:

```sql
select c.relname,
       c.relrowsecurity                                         as rls,
       (select count(*) from pg_policy p where p.polrelid=c.oid) as politicas
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind='r'
order by 2, 3;
```

| Situación | Qué hace el permiso | Revocar `anon` |
|---|---|---|
| RLS activo **con** políticas | es el requisito previo para que la política llegue a evaluarse | **rompe la aplicación** |
| RLS activo **sin** políticas | irrelevante: sin política no se ve ninguna fila | inocuo |
| **Sin** RLS | es la única barrera que hay | **protege** |

En atlas y calendario no había ni una política en `public`, así que el permiso
era lo único que separaba los datos de internet: revocar fue lo correcto. En
conecta, con RLS en las 34 tablas y 63 políticas, revocar impediría que esas
políticas se evaluaran siquiera, y la aplicación dejaría de funcionar para los
usuarios autenticados.

Dicho corto: con políticas, el permiso abre la puerta y la política filtra;
sin políticas, el permiso *es* la puerta.

### La IP del servidor está publicada

Comprobado el 24 de agosto de 2026:

| Subdominio | DNS |
|---|---|
| `atlas`, `tributos`, `www` | tras Cloudflare |
| `calendario` | **directo — publica 178.104.101.84** |
| `supabase-at` | **directo** |
| `supabase-ca` | **directo** |

Consecuencia verificada: el proxy de `atlas` se puede esquivar hablando con la
IP y la cabecera `Host`, que devuelve HTTP 200. Mientras un solo subdominio
resuelva al origen, el proxy de los demás es una cortina.

Poner `calendario`, `supabase-at` y `supabase-ca` tras el proxy lo cierra, y de
paso `calendario` gana velocidad: hoy tarda 0,77-0,92 s frente a los ~0,25 s de
`atlas`, que va por Cloudflare. Mismo servidor, 3× más lento por terminar el TLS
en Alemania en vez de cerca del usuario.

En los hosts de API (`supabase-*`), al pasarlos por el proxy conviene dejar el
cacheo en «bypass» para `/rest/v1/*` y no activar minificación ni Rocket Loader:
son JSON de datos, no páginas, y llevan cabeceras propias (`apikey`, `Prefer`,
`Range`, `Content-Range`).

### Lo aprendido, que ahorra tiempo en las siguientes

**La lista de lo que hay que verificar sale del código, no del catálogo del
origen.** Comparar origen contra destino —tabla a tabla, fila a fila— demuestra
que la copia es fiel, y eso es exactamente lo que no basta. Una tabla que falta
en los dos lados cuadra perfectamente: `vencimiento_avisos` está en una
migración del repo que nunca se aplicó en Supabase, así que la comparación la
daba por buena sin verla siquiera. La verificación por comparación es ciega a
todo lo que el origen ya tenía mal. Lo que el código espera encontrar es la
única lista completa.

**Una aplicación puede hablar con más de una base.** Calendario lee y escribe
en la base de ATLAS por un canal HTTP propio, con su propio par de variables
(`ATLAS_SUPABASE_URL` / `ATLAS_SUPABASE_KEY`) y un valor por defecto codificado
que apunta al proyecto viejo. Cambiar solo `SUPABASE_URL` habría dejado la
aplicación escribiendo reuniones en una base que ya no lee nadie, sin un solo
error en los registros: los INSERT tienen éxito, solo que en el sitio
equivocado. Antes de reapuntar, listar TODAS las variables de la aplicación y
buscar en el código cada `getenv` que contenga una URL.

Un valor por defecto codificado que apunta a producción antigua es una trampa:
si falta la variable, en vez de fallar, se reconecta en silencio a donde no
debe. Mejor cadena vacía y desactivar la función.

- **No todos los proyectos necesitan el stack completo.** Marketing y proyectos
  no tienen usuarios ni buckets: les basta PostgREST, 8–17 MB en lugar de 90.
- **El esquema no se deduce de la API de datos**: `extraer-esquema.mjs` lo saca
  del catálogo de PostgreSQL, única forma de conservar claves foráneas,
  índices, triggers y RLS.
- **Columnas generadas**: al crear la tabla van como `generated always as (…)
  stored`, y al insertar hay que excluirlas.
- **Secuencias**: hay que extraerlas aparte, o las tablas con columnas
  autoincrementales no se crean.
- **Funciones de extensiones**: `pg_trgm` aporta 31 funciones al esquema
  `public` que no deben copiarse.
- **`auth.users.confirmed_at`** es una columna generada: rompía la migración de
  usuarios.
- **GoTrue no crea su esquema `auth`**: hay que crearlo antes, y con
  `grant … to postgres` previo porque PostgreSQL 16 exige ser miembro del rol.
- **storage-api solo opera sobre la base `postgres`** que inicializa la imagen.
  Sobre una base añadida con `CREATE DATABASE` responde
  «DatabaseSchemaMismatch» aunque el esquema sea idéntico —mismas tablas,
  funciones y migraciones, con el mismo hash—. Por eso tributos y gestión
  tienen su propia instancia.
- **storage-api necesita `auth.users`**: `storage.objects` la referencia, así
  que hay que desplegar GoTrue aunque el proyecto no tenga usuarios.
- **`revoke connect … from public` rompe storage-api.** El aislamiento hay que
  hacerlo nombrando los roles: `anon`, `authenticated` y `service_role`
  incluidos. Sin ellos, leer funciona y escribir devuelve un 500 opaco.
- **El alias `db` colisiona entre stacks** en una red compartida: cada compose
  lo declara y la conexión acaba en el PostgreSQL de otro proyecto. Hay que
  usar el nombre completo del contenedor.
- **La interfaz de Coolify no guarda variables de forma fiable**; con el token
  de API (`PATCH /applications/{uuid}/envs`) sí. El despliegue sí funciona
  desde la interfaz.

### Encontrado de paso

El trabajo `run-sequences` de Marketing llamaba cada 10 minutos a
`marketing-map-backend.onrender.com`, que devuelve 404 desde que el backend se
movió. Las secuencias llevaban meses sin ejecutarse. Recreado con cron del
sistema contra el backend real.

## Situación actual

### Ya está en el servidor — no hay nada que hacer

| Aplicación | Dominio | Base de datos |
|---|---|---|
| **ContableMAP** | `map` | Supabase self-hosted propio ✅ migrado hoy |
| **Kardex** | `kardex` | PostgreSQL 16 local, gestionado por Coolify |
| **csc** (contratación) | `contratacion` | sin base externa |
| **multiagente** | `multiagente` | sin base externa |
| **marketing-landing** | `marketing` | sitio estático |

### Sigue dependiendo de supabase.com — 8 proyectos

| Proyecto en la nube | Aplicaciones que lo usan | Dominios |
|---|---|---|
| `iaxhryjsmapwpjbsnavy` | tributos-api | `app-tributos` |
| `yxypbdcryjerestwbhxm` | Gestión contable | `gestion`, `sistema` |
| `naubddczohedvtywmmmy` | **ATLAS y Calendario** (compartido) | `atlas`, `calendario` |
| `lqdpirsfzodmbeyoivww` | Calendario | `calendario` |
| `rzdpfhflkzwylaaplgml` | agente-map (Proyectos) | `proyectos` |
| `pamplfrwwawfgvbzbndk` | **marketing-backend y dashboard** (compartido) | `api.marketing`, `panel.marketing` |
| `rfijjtvozncllqvocdat` | conecta (vinculación) | `conecta` |
| `przkcufncvwejpllbxbo` | pensamiento-libre | `pensamiento-libre.org` |

Ocho proyectos, nueve aplicaciones. Dos proyectos los comparten dos
aplicaciones cada uno: hay que migrarlos de una vez, no por partes, o una de
las dos se quedaría hablando con la copia vieja.

## Lo que hay que resolver antes de empezar

### 1. La memoria: ahora sí es un requisito

Medido hoy, con ContableMAP ya migrado:

```
Mem:   3,7 Gi total · 1,9 Gi en uso · 1,8 Gi disponible
Swap:  4,0 Gi total · 2,0 Gi en uso     ← ya hay 2 GB fuera de la RAM
Carga: 1,3 sobre 2 núcleos
```

Cada proyecto migrado necesita sus tres servicios propios —`auth`, `rest` y
`storage`— porque cada uno tiene su secreto de firma y sus usuarios. Medido
sobre ContableMAP, son unos 90 MB por proyecto:

```
8 proyectos × 90 MB           ≈ 720 MB
PostgreSQL compartido          ≈ 250 MB
                               ─────────
                               ≈ 1,0 GB adicionales
```

Sobre 1,8 GB disponibles cabría por los pelos, pero con 2 GB ya en swap el
resultado sería una máquina que pasa el día moviendo memoria a disco. Y basta
un `docker build` de cualquiera de las 14 aplicaciones para que el kernel
empiece a matar procesos.

**Ampliar a 8 GB antes de migrar nada.** De CX22 a CX32: unos 3 € más al mes,
duplica también los núcleos (2 → 4), y el redimensionado es un reinicio de dos
minutos que no toca los discos.

### 2. Un PostgreSQL, ocho bases

No hace falta un PostgreSQL por proyecto. Uno solo con ocho bases separadas
consume una fracción y se respalda de una vez:

```
postgres-central
├── contable      (ya migrada)
├── tributos
├── gestion
├── atlas_calendario
├── proyectos
├── marketing
├── conecta
└── pensamiento_libre
```

Cada base con su propio juego de `auth` + `rest` + `storage` delante, con sus
claves independientes. Ninguna aplicación puede ver los datos de otra, igual
que ahora.

### 3. Un dominio por proyecto

Cada aplicación necesita su punto de entrada:
`supabase-tributos.pensamiento-libre.org`, `supabase-marketing…`, etcétera.
Son registros A en Cloudflare, iguales al que ya creamos.

### 4. Las credenciales

Para cada proyecto hace falta su clave de servicio, la misma que se copia con
un botón en *Settings → API Keys → Legacy*. Sin eso no hay forma de leer los
datos.

## Plan por fases

Cada fase deja el sistema en un estado consistente y con vuelta atrás.

**Fase 0 · Ampliar el servidor.** Redimensionar a 8 GB. Dos minutos de corte.

**Fase 1 · Piloto de la nueva forma.** Migrar `conecta` — es de las más
pequeñas y solo la usa una aplicación. Sirve para validar el patrón de varias
bases sobre un PostgreSQL compartido antes de tocar nada importante.

**Fase 2 · Los compartidos.** `marketing` (dos aplicaciones) y
`atlas_calendario` (dos aplicaciones, más el segundo proyecto de Calendario).
Son los de mayor riesgo porque el corte afecta a dos frentes a la vez.

**Fase 3 · Los contables.** `tributos` y `gestion` — los más delicados por el
tipo de dato. Se hacen los últimos, cuando el procedimiento ya se repitió seis
veces.

**Fase 4 · El resto.** `proyectos` y `pensamiento-libre`.

**Fase 5 · Cierre.** Respaldo unificado de las ocho bases, verificación de
restauración, y solo entonces dar de baja los proyectos de supabase.com.

## Lo que ya está resuelto y se reutiliza

El piloto de ContableMAP dejó hecho el camino y dos fallos corregidos:

- `docker-compose.yml` parametrizado y probado
- `migrar-por-api.mjs` — migra sin tocar el proyecto de origen ni pedir la
  contraseña de PostgreSQL
- `copiar-buckets-directo.mjs` — archivos por la red interna
- `arreglar-usuarios.sql` — los campos de token en `auth.users` deben ir a
  cadena vacía, no a NULL, o GoTrue rechaza el acceso
- El middleware de CORS hay que declararlo en los tres servicios, no en uno
- `respaldo.sh` y `probar-restauracion.sh`

## El riesgo que conviene mirar de frente

Al terminar, **catorce aplicaciones y nueve bases de datos vivirán en una sola
máquina**. Hoy, si el servidor cae, se caen las aplicaciones pero los datos
siguen a salvo en la infraestructura de Supabase. Después, se cae todo junto.

Eso no es un argumento para no hacerlo —el control y el ahorro tienen valor—,
pero sí para acompañarlo de:

- Respaldos automáticos de las nueve bases, fuera del servidor (ya montado el
  mecanismo, falta extenderlo)
- Una prueba de restauración periódica, no solo la existencia de los archivos
- Tener claro cuánto se tarda en levantar todo en un servidor nuevo

Con lo que hay montado hoy, reconstruir ContableMAP en otra máquina son un par
de horas. Multiplicado por nueve, conviene medirlo antes de necesitarlo.
