# Respaldos de las bases del servidor

Montado el 24 de agosto de 2026. Antes de esto **solo Kardex tenía copia
automática**: las diez bases traídas de supabase.com no tenían ninguna.

## Qué hay

| | |
|---|---|
| Script | `/opt/respaldos/respaldo-bases.sh` (copia versionada aquí) |
| Cuándo | cron diario a las **3:30** (el de Kardex sigue aparte, a las 3:15) |
| Dónde | `/opt/respaldos/bases/AAAA-MM-DD/` |
| Retención | 30 días, borrando por carpeta de día |
| Registro | `/var/log/respaldo-bases.log` |
| Tamaño | ~46 MB por día → ~1,4 GB con la retención llena (hay 30 GB libres) |
| Duración | ~11 segundos |

## Qué respalda

Las **cinco instancias** PostgreSQL, y dentro de cada una **todas sus bases**, no
solo `postgres`. Esto importa: `contable-supabase-db-1` aloja ocho bases (atlas,
calendario, marketing, proyectos, pensamiento_libre, la de ContableMAP y sendas
copias de gestion y tributos que quedaron de la migración). Un respaldo que
volcara solo `postgres` se dejaría seis fuera.

Son **21 archivos por día**: 12 bases, los roles de cada instancia y los archivos
de los buckets de las cuatro que tienen (conecta no tiene ninguno).

**Los roles se guardan aparte y hacen falta.** Las políticas RLS dependen de
`anon`, `authenticated` y `service_role`; sin ellos un volcado no se puede
restaurar en una instancia nueva.

## Restaurar

Usar **`supabase_admin`**, no `postgres`:

```sh
docker exec -i INSTANCIA psql -U postgres -c 'CREATE DATABASE destino;'
docker exec -i INSTANCIA pg_restore -U supabase_admin -d destino < INSTANCIA--BASE.dump
```

Con `postgres` los datos también quedan bien, pero salen 141 avisos y 21
«permission denied» sobre objetos internos de Supabase, porque `postgres` no es
superusuario en esa imagen. Con `supabase_admin`, cero avisos.

Si la instancia es nueva, los roles van primero:

```sh
gunzip -c INSTANCIA-roles.sql.gz | docker exec -i INSTANCIA psql -U postgres
```

## Por qué merece confianza

No se dio por bueno porque el script terminara sin error. Se restauró de verdad,
dos veces, sobre una base temporal que después se borró:

- `pensamiento_libre` → mismas 5 tablas, mismos recuentos, mismas 36 funciones.
- `contratacion` → 690 filas, 23 políticas, 45 funciones, 13 usuarios y los dos
  disparadores sobre `auth.users` (`on_auth_user_created`, `trg_auth_libera_clave`),
  idénticos al origen. Son justo los que se perdieron en silencio en la migración
  original, así que se comprobaron a propósito.

El propio script verifica cada volcado leyendo su índice con `pg_restore -l` antes
de aceptarlo, y escribe a `.parcial` hasta que termina, para no dejar nunca un
archivo a medias. Si algo falla, sale con código 1.

## Los archivos de los buckets

Van incluidos desde el 24-ago-2026, en `INSTANCIA-archivos.tar.gz`. Son 25 archivos
en total (contable 10, tributos 9, gestión 4, contratación 2; conecta no tiene).

Viven en un **volumen Hetzner aparte**, `/mnt/HC_Volume_106171631/INSTANCIA/storage`,
que `pg_dump` no toca. La lista de qué archivo es cuál sí viaja en el volcado de la
base, en el esquema `storage` — así que sin esta parte una restauración devolvería
el inventario completo y ni un solo archivo.

Se comprobó extrayendo los cuatro paquetes y comparando sumas MD5 contra el
original: **idénticos, archivo por archivo**.

Para devolverlos:

```sh
tar xzf INSTANCIA-archivos.tar.gz -C /mnt/HC_Volume_106171631/INSTANCIA/storage
```

## Copia fuera del servidor (desde el 28-ago-2026)

`/opt/respaldos/subir-a-dropbox.sh`, cron **a las 4:00**, media hora después del
respaldo. Sube `bases/` y `kardex/` a Dropbox **cifrados** con `rclone crypt`
(remoto `respaldos-cifrados:` → `dropbox:09_RESPALDOS/servidor-hetzner`). En Dropbox
no se leen ni los nombres de los ficheros. Registro en `/var/log/subir-a-dropbox.log`;
si falla, avisa por Discord.

**Las claves están en `/opt/respaldos/CLAVES-CIFRADO-LEEME.txt` (permisos 600) y hay
que guardarlas FUERA del servidor.** Sin ellas, lo que hay en Dropbox no se puede
descifrar — ni siquiera con acceso a la cuenta.

Para restaurar desde otro equipo, con las claves a mano:

```sh
rclone config create respaldos crypt remote=dropbox:09_RESPALDOS/servidor-hetzner \
  password="$(rclone obscure 'CLAVE1')" password2="$(rclone obscure 'CLAVE2')"
rclone copy respaldos:bases/2026-08-27 ./restaurado
```

Comprobado el 28-ago-2026 de verdad: se bajó `contratacion--postgres.dump` desde
Dropbox y su **MD5 coincide** con el del servidor; `pg_restore -l` lee sus 837
entradas. No basta con que la subida no dé error — esa es la lección del guardado
mudo de la Consola Violeta.

**Dos límites que conviene tener presentes:**

- El script usa `rclone sync`, que refleja el origen en el destino. Por eso **aborta
  si el origen está vacío**: un respaldo fallido que dejara la carpeta sin nada
  borraría la copia de Dropbox. Además lleva `--max-delete 60`.
- La contraseña del cifrado vive en la configuración de rclone del servidor, porque
  el cron debe poder ejecutarse solo. Protege si alguien entra a **Dropbox**; no
  protege si alguien entra al **servidor**.

## Lo que este respaldo NO cubre

- Nota: las bases están en el disco del sistema y los archivos de los buckets en el
  volumen `/dev/sdb`, pero **los respaldos locales de ambos van al disco del sistema**.
  La copia de Dropbox sí queda fuera.
