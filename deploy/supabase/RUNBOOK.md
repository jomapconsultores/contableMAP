# Migración de ContableMAP a Supabase self-hosted

Plan piloto: mover la base de ContableMAP desde supabase.com al servidor propio
(Coolify sobre Hetzner), como ensayo antes de trasladar `tributos` y
`gestion_contable`.

El proyecto alojado **no se toca ni se borra** en todo el proceso. Es la vuelta
atrás: mientras siga en pie, revertir es cambiar tres variables y reconstruir.

## Estado: MIGRACIÓN COMPLETADA (23 de agosto de 2026)

ContableMAP funciona sobre Supabase self-hosted en `ubuntu-4gb-nbg1-1`
(178.104.101.84). El proyecto de supabase.com sigue intacto como vuelta atrás.

| Paso | Estado |
|---|---|
| 1 · Dónde viven los datos | Base en `sda` (local, 33 GB libres); archivos y respaldos en el Volume |
| 2 · Swap | De 2 GB al 85 % a 4 GB; `swappiness` 60 → 10 |
| 3 · Credenciales | Generadas y verificadas |
| 4 · Stack desplegado | Cuatro servicios *healthy*, 280 MB |
| 5 · Comprobación | Certificado Let's Encrypt, rutas y CORS desde internet |
| 6 · Datos | 11 tablas con datos, 308 filas, todas cuadran |
| 7 · Archivos | 10 archivos (2,71 MB), incluido el certificado `.p12` |
| 8 · Corte | Variables cambiadas y **imagen reconstruida**: el bundle lleva el host nuevo |
| 9 · Verificación | Login real, RLS, `fn_dashboard` con IVA y cartera |
| 10 · Respaldo | **Hecho.** Diario a las 03:15, local + Dropbox, con restauración probada |
| 11 · Vuelta atrás | Disponible mientras el origen siga en pie |

### Vuelta atrás

Devolver estas tres variables en Coolify (`contable-map` → *Environment
Variables* → *Developer view*) y **reconstruir**, no reiniciar:

```
NEXT_PUBLIC_SUPABASE_URL=https://aghnegcsdmfurctfdjsh.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<la del proyecto alojado>
SUPABASE_SERVICE_ROLE_KEY=<la del proyecto alojado>
```

Lo escrito en el servidor propio después del corte no viaja de vuelta: cuanto
más tarde se revierta, más se pierde.

### Pendientes

1. ~~Respaldos.~~ **Resueltos.** `respaldo.sh` corre cada día a las 03:15 por
   cron: vuelca la base, empaqueta los archivos, copia el `.env`, verifica que
   el volcado es legible, rota a 30 días en local y sube a
   `dropbox:09_RESPALDOS/contable-map` conservando 7 diarios más el primero de
   cada mes. `probar-restauracion.sh` restaura la última copia en una base
   temporal y cuenta lo que recupera — conviene lanzarlo una vez al mes.

   Dos cosas a tener presentes: el paquete incluye `env-stack.txt` con
   `JWT_SECRET` y `SRI_CERT_SECRET` sin cifrar (va así porque sin esas claves
   el respaldo no se puede poner en marcha, pero quien acceda al Dropbox las
   tiene), y la cuenta de Dropbox solo tiene 4 GB libres, de ahí la retención
   corta en remoto.
2. **SMTP.** Sin correo no hay recuperación de contraseña.
3. **Contraseña temporal** del usuario: cambiar en el primer acceso.
4. **Token de Cloudflare** usado para crear el DNS: revocar.
5. **Variables de *Preview Deployments*** siguen apuntando al proyecto alojado.
6. **`tributos` y `gestion_contable`**: el piloto ya dejó el camino hecho y dos
   fallos corregidos (campos de token en `auth.users`, middleware de CORS).

## Por qué el stack completo y no solo PostgreSQL

La aplicación no usa Supabase como base de datos, sino como plataforma:

| Servicio | Dónde se usa |
|---|---|
| Auth (GoTrue) | `login/page.tsx`, `proxy.ts`, y `auth.uid()` dentro de las políticas RLS |
| Storage | buckets `documentos`, `certificados`, `comprobantes` |
| PostgREST | todo el acceso a datos (`sb.from`) y las funciones (`fn_dashboard`, `sri_siguiente_secuencial`) |

Un PostgreSQL pelado obligaría a reescribir cada ruta de API, el acceso y las
políticas. Con el stack, el código no cambia: solo las variables de entorno.

Se despliegan cuatro de los once servicios oficiales. Se omiten Studio y meta
(administración), Realtime (la aplicación no abre canales), Edge Functions (no
hay), imgproxy (no se transforman imágenes) y el gateway Envoy, cuyo trabajo lo
hace el Traefik que Coolify ya tiene corriendo.

## Antes de empezar

- [ ] **Punto de montaje y espacio libre del segundo disco.** `lsblk` y `df`
      en el servidor. Los discos ya tienen información: nada se formatea, solo
      se crea un directorio dentro (paso 1).
- [ ] Registro DNS `supabase.pensamiento-libre.org` → IP del servidor, en modo
      **solo-DNS** hasta que Let's Encrypt emita el certificado.
- [ ] Cadena de conexión del proyecto de origen: panel de Supabase →
      *Project Settings* → *Database* → *Connection string*, modo **Session**.
- [ ] `pg_dump` versión 17 o superior en la máquina desde la que se migra.
- [ ] Ninguna otra aplicación desplegándose mientras dure la migración: los
      `docker build` de Coolify son el único pico de memoria que puede competir.

---

## 1 · Elegir dónde viven los datos

**No se formatea nada.** Los discos ya tienen información, y añadir Supabase a
un disco con contenido no requiere formatearlo: un disco con datos ya tiene
sistema de archivos, así que basta con crear un directorio dentro. `mkfs` solo
haría falta con un disco crudo, y ese no es el caso.

Todo el estado nuevo va al segundo disco, no al de sistema: ese ya sostiene
Coolify y catorce aplicaciones, y lo que se llena primero siempre es
`/var/lib/docker`.

```bash
lsblk -o NAME,SIZE,TYPE,FSTYPE,MOUNTPOINT
df -hT | grep -v tmpfs
```

Según lo que devuelva:

| Lo que se ve | Qué hacer |
|---|---|
| Segundo disco montado (p. ej. `/mnt/HC_Volume_…`), `ext4` o `xfs`, con espacio | `DISCO_DATOS` = ese punto de montaje. Solo `mkdir`. |
| Montado pero con poco espacio libre | Ampliar el Volume en el panel de Hetzner y `resize2fs` en caliente: crece sin perder nada |
| Con sistema de archivos pero **sin montar** | Montarlo (`mount`, más línea en `/etc/fstab`). Montar no borra |
| `ntfs`, `exfat`, `fuse` o un montaje de red | No sirve para PGDATA: Postgres necesita permisos POSIX y `fsync` fiable. Úsalo solo para respaldos |

Fijado el punto de montaje —lo llamo `$RUTA`—, las tres comprobaciones previas:

```bash
df -h "$RUTA"                    # espacio libre: 20 GB holgado para el piloto
stat -f -c '%T' "$RUTA"          # tipo real de sistema de archivos
touch "$RUTA/.prueba" && rm "$RUTA/.prueba" && echo "se puede escribir"
```

Y la preparación completa, que no destruye nada:

```bash
mkdir -p "$RUTA/supabase/db" "$RUTA/supabase/storage" "$RUTA/respaldos"

# Los contenedores no corren como root: sin esto fallan al arrancar con
# «permission denied» sobre un directorio que Docker creó como root.
chown -R 105:106 "$RUTA/supabase/db"        # usuario postgres de la imagen
chown -R 1000:1000 "$RUTA/supabase/storage" # usuario node de storage-api
```

Después, `DISCO_DATOS=$RUTA` en el `.env`.

Lo que ya vive en ese disco se queda intacto: Supabase solo escribe dentro de
`supabase/`. Lo único que se comparte es el espacio libre, así que conviene
dejar la alerta de disco puesta si algún día ese disco se llena por el otro
lado.

**Si fueran dos NVMe idénticos de un servidor dedicado** y estuvieran vacíos,
lo correcto sería RAID1 con mdadm en lugar de separar por rol. Con datos
dentro esa opción ya no está sobre la mesa: convertir a RAID1 exige reconstruir
los discos. Se trabaja con lo que hay.

## 2 · Añadir swap

Ninguna aplicación tiene límites de memoria configurados, así que un build
puede pedir cuanta quiera. El swap convierte un OOM kill —que se llevaría por
delante a Postgres, el proceso más grande— en lentitud pasajera.

```bash
fallocate -l 4G /swapfile && chmod 600 /swapfile
mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
sysctl -w vm.swappiness=10 && echo 'vm.swappiness=10' >> /etc/sysctl.conf
```

`swappiness=10` mantiene el swap como red de seguridad y no como uso habitual.

## 3 · Generar las credenciales

**Ya está hecho.** `deploy/supabase/.env` existe, con las cuatro credenciales
generadas y verificadas (firma válida, `role=anon` y `role=service_role`). Solo
falta ajustar `DISCO_DATOS` con el punto de montaje del paso 1.

Para regenerarlas —si alguna se filtra, por ejemplo—:

```bash
node deploy/supabase/generar-claves.mjs
```

`ANON_KEY` y `SERVICE_ROLE_KEY` son JWT firmados con `JWT_SECRET`: los tres
valores viajan juntos y ninguno se versiona.

## 4 · Desplegar el stack en Coolify

1. Proyecto **ContableMAP** → *+ Add Resource* → **Docker Compose**.
2. Pega `deploy/supabase/docker-compose.yml`.
3. Carga las variables de `.env` en *Environment Variables*.
4. Conecta el recurso a la red predefinida **`coolify`** — sin eso Traefik no
   ve los contenedores y el enrutado por prefijo no funciona.
5. Despliega y espera a que los cuatro servicios queden *healthy*.

El archivo `init/99-roles.sql` debe estar accesible junto al compose: pone
contraseña a `authenticator`, `supabase_auth_admin` y `supabase_storage_admin`,
que la imagen crea sin ella. Se ejecuta **una sola vez**, con el directorio de
datos vacío; si hay que rotar la contraseña después, se aplican los `ALTER` a
mano.

## 5 · Comprobar que el stack responde

```bash
# PostgREST contesta y acepta la clave anónima
curl -s -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY" \
  https://supabase.pensamiento-libre.org/rest/v1/ | head -c 200

# GoTrue vivo
curl -s https://supabase.pensamiento-libre.org/auth/v1/health

# Storage vivo
curl -s https://supabase.pensamiento-libre.org/storage/v1/status
```

Los tres deben responder antes de tocar un solo dato. Si el certificado aún no
se emitió, revisa que el DNS esté en modo solo-DNS.

## 6 · Migrar los datos

```bash
# Túnel al Postgres del servidor, que no está expuesto a internet
ssh -L 5433:localhost:5432 root@178.104.101.84

ORIGEN='postgresql://postgres.PROYECTO:CLAVE@aws-0-us-east-1.pooler.supabase.com:5432/postgres' \
DESTINO='postgresql://postgres:CLAVE_POSTGRES@localhost:5433/postgres' \
bash deploy/supabase/migrar-datos.sh
```

El script vuelca usuarios y contabilidad, restaura en orden y **compara el
número de filas de cada tabla entre origen y destino**. Si algo no cuadra, se
detiene y no debes continuar.

Los triggers se desactivan durante la carga (`session_replication_role =
replica`): las validaciones de cuadre y los recálculos de saldo ya se
aplicaron cuando el dato se creó, y reprocesarlos alteraría movimientos ya
contabilizados.

Las contraseñas de los usuarios sobreviven —los hashes viajan en `auth.users`—,
pero las sesiones abiertas no: el `JWT_SECRET` es otro, así que todos tendrán
que volver a entrar.

## 7 · Copiar los archivos

```bash
ORIGEN_URL=https://PROYECTO.supabase.co ORIGEN_SERVICE_KEY=… \
DESTINO_URL=https://supabase.pensamiento-libre.org DESTINO_SERVICE_KEY=… \
node deploy/supabase/copiar-buckets.mjs
```

Sube por la API para que el inventario lo escriba el propio servicio. Es
idempotente: si falla a medias, se vuelve a lanzar.

## 8 · Reapuntar la aplicación

En Coolify, aplicación **contable-map**:

| Variable | Valor |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://supabase.pensamiento-libre.org` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | el `ANON_KEY` generado |
| `SUPABASE_SERVICE_ROLE_KEY` | el `SERVICE_ROLE_KEY` generado |

⚠️ **No basta con reiniciar.** Las dos `NEXT_PUBLIC_*` se incrustan en el bundle
del navegador durante la compilación: hay que pasarlas como *build args* y
**reconstruir** la imagen. El `Dockerfile` ya las declara como `ARG`.

⚠️ **`SRI_CERT_SECRET` no se toca.** Con ella se cifró la contraseña del
certificado `.p12` guardado en la base. Si cambia, la contraseña ya guardada
deja de poder descifrarse y hay que volver a subir el certificado —y sin
certificado no se firma ni se emite ninguna factura.

## 9 · Verificación funcional

En este orden, porque cada paso depende del anterior:

1. **Acceso** — entrar con un usuario real y llegar al panel.
2. **RLS** — con sesión iniciada, comprobar que solo se ven los datos de la
   entidad propia. Es la comprobación que no puede saltarse: el aislamiento
   entero cuelga de `entidades.user_id` y de que las políticas viajaran con el
   volcado.
3. **Informes** — abrir el panel (llama a `fn_dashboard`) y el formulario 104.
4. **Documentos** — subir un PDF y procesarlo: prueba Storage de ida y vuelta.
5. **Facturación electrónica** — emitir una factura **contra el ambiente de
   pruebas del SRI**, nunca contra producción. Verifica de una vez el
   certificado descifrado, la reserva atómica del secuencial y el guardado del
   XML firmado.

Además, `npm run test:db` sigue siendo válido: levanta un PostgreSQL en proceso
y comprueba las invariantes contables contra el mismo SQL que se despliega.

## 10 · Respaldo

Hoy no hay ninguno saliendo del servidor: en Coolify no hay ningún *S3 Storage*
configurado. Con datos contables y facturas autorizadas por el SRI, esto es lo
primero que hay que dejar resuelto, y antes de dar la migración por buena.

```bash
# Volcado diario al segundo disco
cat > /etc/cron.daily/respaldo-supabase <<'FIN'
#!/bin/sh
set -e
FECHA=$(date +%Y%m%d)
docker exec supabase-db pg_dump -U postgres postgres | gzip \
  > /mnt/datos/respaldos/contable-$FECHA.sql.gz
find /mnt/datos/respaldos -name 'contable-*.sql.gz' -mtime +30 -delete
FIN
chmod +x /etc/cron.daily/respaldo-supabase
```

Un respaldo en el mismo servidor protege de un borrado accidental, **no de la
pérdida del servidor**. Falta la copia fuera: un bucket S3 configurado en
Coolify, o `rclone` contra el Dropbox que ya usas.

## 11 · Vuelta atrás

Mientras el proyecto alojado siga vivo:

1. Devolver las tres variables a los valores de supabase.com.
2. Reconstruir la imagen (build args, no reinicio).
3. Verificar el acceso.

Lo escrito en el stack propio durante la prueba se queda ahí. Por eso conviene
hacer el corte en un momento sin movimientos y, sobre todo, **sin emitir
facturas al SRI en producción**: una factura autorizada es un documento
tributario real y no se deshace revirtiendo variables — solo con una nota de
crédito o con la solicitud de anulación del portal del SRI.

No borres el proyecto de supabase.com hasta que haya pasado un cierre de
período completo sobre el stack nuevo.

---

## Pendiente de confirmar

- **`DISCO_DATOS`**: fijado provisionalmente a `/mnt/datos`. Depende del
  `lsblk` del paso 1.
- **CORS sin gateway**: el enrutado por Traefik sustituye al gateway oficial y
  el middleware de CORS cubre las cabeceras que usa supabase-js. Si alguna
  petición del navegador fuera rechazada, la alternativa es añadir Kong 2.8.1
  en modo declarativo delante de los tres servicios, como hacía el compose
  oficial hasta la versión anterior.
