# ContableMAP

Sistema contable y tributario ecuatoriano para Marco Antonio Posligua.
Los datos entran por voz o por documentos (estados de cuenta de tarjetas,
bancos y cooperativas, facturas y roles de pago), la IA los extrae y clasifica
con el mismo criterio de **tributos-web**, y de ahí salen la contabilidad de
partida doble, los estados financieros y las declaraciones.

## Qué hace

| Módulo | Qué resuelve |
|---|---|
| **Ingesta por voz** | Se dicta el movimiento en lenguaje natural. Se muestra la interpretación antes de registrar nada. |
| **Ingesta por documentos** | PDF, imagen, XML o CSV. Extracción de la cabecera y de cada línea del extracto. |
| **Clasificación** | Mapa aprendido RUC/comercio → categoría. Lo que el mapa no reconoce va al modelo; lo que el modelo resuelve con confianza alta se incorpora al mapa. |
| **Contabilidad** | Partida doble con plan de cuentas propio, validación de cuadre en base de datos y cierre de períodos. |
| **Cartera** | Cuentas y documentos por cobrar y por pagar, con abonos y antigüedad de saldos. |
| **IVA** | Libros de compras y ventas, formulario 104 y mayor de crédito tributario. |
| **Renta** | Acumulación anual, gastos personales por rubro con topes y liquidación del formulario 102. |
| **Estados financieros** | Estado de resultados y balance general, derivados del balance de sumas y saldos. |

## Decisiones de diseño

**Las reglas contables y fiscales viven en PostgreSQL, no en la aplicación.**
El cuadre de asientos, el saldo de cartera, el cálculo del 104, los topes de
gastos personales y la tabla del impuesto a la renta son funciones y triggers
de base de datos. La aplicación solo presenta. Así un error de la interfaz no
puede producir un asiento descuadrado ni un impuesto mal calculado, y cualquier
otro cliente que ataque la misma base obtiene los mismos números.

**Las cifras del SRI son datos, no código.** La fracción básica desgravada, la
canasta básica, los topes por rubro y la tabla progresiva viven en
`parametros_fiscales`, una fila por ejercicio. Cuando el SRI publica la
resolución del año se edita la fila; no se toca la aplicación.

**El aislamiento es por RLS.** Todo cuelga de `entidades.user_id`. Las
políticas se aplican también a las vistas (`security_invoker = true`), de modo
que ni un fallo en una ruta de API puede filtrar datos de otra entidad. La
comprobación de sesión del `proxy.ts` es solo comodidad de navegación.

**La IA propone, la persona confirma.** Nada se contabiliza sin pasar por una
pantalla de revisión, y todo movimiento guarda con qué confianza y por qué vía
(`MAPA`, `IA` o `MANUAL`) se clasificó. Por debajo de 0,7 se marca para revisar.

## Pruebas

```bash
npm run test:db
```

Levanta un PostgreSQL 17 real en proceso (PGlite), replica el andamiaje que
aporta Supabase (rol `authenticated`, esquemas `auth` y `storage`), aplica las
nueve migraciones **sin modificar una línea del SQL que se despliega** y
ejecuta 38 comprobaciones sobre el motor: cuadre de asientos, rechazo de
períodos cerrados, saldos de cartera, formulario 104 —incluido que el IVA sin
derecho a crédito no reste del impuesto causado—, topes de gastos personales y
exención de los décimos en el impuesto a la renta.

No es una prueba de que el SQL compile: es una prueba de que la contabilidad
cuadra y de que las invariantes se rechazan cuando deben.

## Puesta en marcha

### 1. Base de datos

Aplica las migraciones de `supabase/migrations/` en orden sobre el proyecto
Supabase. Con el CLI:

```bash
supabase link --project-ref <ref>
supabase db push
```

O pegando cada archivo en el editor SQL, del `0001` al `0009`. La migración
`0007` crea además el bucket privado `documentos` y sus políticas.

### 2. Variables de entorno

Copia `.env.example` a `.env.local` y complétalo:

| Variable | Para qué |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | URL del proyecto |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Clave pública |
| `SUPABASE_SERVICE_ROLE_KEY` | Solo servidor: tareas que deben saltar RLS |
| `ANTHROPIC_API_KEY` | Extracción, clasificación e interpretación de voz |
| `ANTHROPIC_MODEL` | Opcional; por defecto `claude-opus-5` |

### 3. Desarrollo

```bash
npm install
npm run dev
```

### 4. Primer uso

1. Regístrate en `/login`.
2. En **Ajustes**, crea la entidad con su RUC y régimen. El plan de cuentas y
   las categorías se generan solos.
3. Crea las cuentas financieras (banco, tarjeta, cooperativa).
4. En **Ingresar datos**, carga un estado de cuenta o dicta un movimiento.
5. Revisa en **Movimientos** y pulsa *Contabilizar*.

## Despliegue

La imagen es un Next.js `standalone`. Las variables `NEXT_PUBLIC_*` se
incrustan en el bundle del navegador, así que hay que pasarlas como
`build args`, no solo como variables de entorno de ejecución:

```bash
docker build \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=... \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=... \
  -t contable-map .
```

En Coolify: aplicación tipo *Dockerfile*, puerto 3000, dominio
`map.pensamiento-libre.org`. El registro DNS ya apunta al servidor en modo
solo-DNS para que Let's Encrypt pueda emitir el certificado; una vez emitido
se puede activar el proxy de Cloudflare.

`GET /api/health` responde sin autenticación y sirve de healthcheck.

## Estructura

```
supabase/migrations/   0001 núcleo · 0002 contabilidad · 0003 documentos
                       0004 tributario · 0005 cartera · 0006 declaraciones
                       0007 RLS · 0008 semillas · 0009 estados financieros
src/lib/               ia · esquemas · prompts · extraccion · clasificacion
                       contabilizacion · api · formato · supabase/
src/app/api/           documentos · movimientos · voz · informes · categorias
                       cuentas · entidades · health
src/app/               panel · ingesta · movimientos · cartera · informes
                       impuestos · ajustes · login
```

## Sobre los cálculos tributarios

Los números de casillero del formulario 104 siguen la estructura vigente, y los
parámetros de renta que se siembran en la migración `0008` son valores de
referencia marcados como tales. **Antes de presentar cualquier declaración hay
que contrastarlos con la resolución del SRI del ejercicio**: el sistema es una
herramienta de gestión y de preparación, no un sustituto del criterio
profesional.
