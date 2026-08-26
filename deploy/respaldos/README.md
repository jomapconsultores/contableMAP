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

## Lo que este respaldo NO cubre

- **Copia fuera del servidor.** Todo vive en `/opt/respaldos`, en el disco del
  sistema. Protege de un borrado accidental o una migración mal hecha, no de la
  pérdida del servidor. Conviene una copia semanal a otro sitio.
- Nota: las bases están en el disco del sistema y los archivos de los buckets en el
  volumen `/dev/sdb`, pero **los respaldos de ambos van al disco del sistema**.
