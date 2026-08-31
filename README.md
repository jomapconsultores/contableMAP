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
| **Comprobantes** | Compras y ventas con su desglose de bases e IVA por tarifa, crédito tributario y deducibilidad, contabilizables uno a uno o en lote. |
| **Facturación electrónica** | Emisión de facturas al SRI por el esquema *offline*: clave de acceso, XML firmado con el certificado del contribuyente, envío a recepción y autorización, RIDE y descarga del XML autorizado. |
| **Retenciones** | Retenciones recibidas y efectuadas de renta, IVA e ISD, con su asiento. |
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

**Una factura no es un PDF: es el XML que el SRI autorizó.** El sistema genera
el XML, calcula la clave de acceso, lo firma con XAdES-BES y lo envía a los web
services del SRI. Hasta que la respuesta es `AUTORIZADO` la pantalla dice que
la factura está pendiente y el RIDE lo advierte impreso, porque entregar al
cliente una representación impresa de un comprobante no autorizado es entregar
un papel sin valor. El secuencial se reserva en la base con `update …
returning`, de modo que dos emisiones simultáneas no pueden recibir el mismo
número, y la factura se guarda **antes** de hablar con el SRI: si el envío
falla se reintenta con la misma clave de acceso, sin abrir huecos en la
numeración.

**La IA propone, la persona confirma.** Nada se contabiliza sin pasar por una
pantalla de revisión, y todo movimiento guarda con qué confianza y por qué vía
(`MAPA`, `IA` o `MANUAL`) se clasificó. Por debajo de 0,7 se marca para revisar.

**Primero se transcribe, después se estructura.** Los estados de cuenta llegan
escaneados, sin capa de texto, y pedirle a un modelo de chat que los lea con
visión sale caro y se equivoca en lo único que no puede fallar: las cifras. En
las pruebas leyó `46,50` donde decía `46,80`. Ahora cada PDF o imagen pasa
primero por el OCR de Mistral, que devuelve el extracto como tablas de markdown,
y el modelo solo tiene que estructurar texto ya leído. Es más exacto, más
barato, y deja de exigir un modelo con visión.

El OCR tampoco es infalible —confunde algún dígito suelto—, así que el prompt
de extracción le pide al modelo dos comprobaciones aritméticas sobre el propio
documento: que la suma de los movimientos concuerde con los subtotales impresos
y que `saldo_anterior` más los movimientos dé `saldo_actual`. Lo que no cuadra
se anota en `observaciones` **y se muestra en la pantalla de carga**, junto al
documento. Un aviso que solo queda en la base de datos no lo lee nadie.

## Pruebas

```bash
npm run test:db
npm run test:sri
```

Levanta un PostgreSQL 17 real en proceso (PGlite), replica el andamiaje que
aporta Supabase (rol `authenticated`, esquemas `auth` y `storage`), aplica las
once migraciones **sin modificar una línea del SQL que se despliega** y
ejecuta 48 comprobaciones sobre el motor: cuadre de asientos, rechazo de
períodos cerrados, saldos de cartera, formulario 104 —incluido que el IVA sin
derecho a crédito no reste del impuesto causado—, topes de gastos personales,
exención de los décimos en el impuesto a la renta y la reserva atómica de los
secuenciales de facturación electrónica.

No es una prueba de que el SQL compile: es una prueba de que la contabilidad
cuadra y de que las invariantes se rechazan cuando deben.

`test:sri` cubre la emisión electrónica sin tocar el SRI: genera un certificado
autofirmado al vuelo, emite una factura, la firma y **verifica la firma como lo
hace el validador del SRI** —recalculando los tres resúmenes sobre la forma
canónica de cada fragmento y comprobando la firma RSA del `SignedInfo`—, además
del módulo 11 de la clave de acceso, el redondeo por línea y el aviso del RIDE
cuando el comprobante aún no está autorizado. Es la red que evita descubrir un
fallo de firma después de haber gastado un secuencial.

## Puesta en marcha

### 1. Base de datos

Aplica las migraciones de `supabase/migrations/` en orden sobre el proyecto
Supabase. Con el CLI:

```bash
supabase link --project-ref <ref>
supabase db push
```

O pegando cada archivo en el editor SQL, del `0001` al `0010`. La migración
`0007` crea además el bucket privado `documentos` y sus políticas.

### 2. Variables de entorno

Copia `.env.example` a `.env.local` y complétalo:

| Variable | Para qué |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | URL del proyecto |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Clave pública |
| `SUPABASE_SERVICE_ROLE_KEY` | Solo servidor: tareas que deben saltar RLS |
| `MISTRAL_API_KEY` | Extracción, clasificación e interpretación de voz |
| `MISTRAL_MODEL` | Opcional; fija un solo modelo para todo. Sin él, el sistema usa `mistral-medium-latest`, y `mistral-small-latest` en las tareas de bajo esfuerzo |
| `MISTRAL_OCR_MODEL` | Opcional; modelo que transcribe PDF e imágenes antes de estructurarlos. Por defecto `mistral-ocr-latest` |
| `SRI_CERT_SECRET` | Cifra la contraseña del certificado de firma. Mínimo 16 caracteres y distinta por entorno; si cambia hay que volver a subir el `.p12` |

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

### 5. Para emitir facturas

En **Ajustes → Facturación electrónica**:

1. Sube el certificado `.p12` con su contraseña. Se comprueba al subirlo: si
   la contraseña no lo abre o está caducado, no se guarda.
2. Completa la dirección de la matriz y, si aplica, las resoluciones de
   contribuyente especial y de agente de retención.
3. Crea los puntos de emisión que tengas registrados en SRI en Línea y fija el
   **próximo** secuencial de cada uno: si ya emitiste hasta la `000000120`,
   pon 121. El secuencial solo se puede adelantar, nunca retroceder.
4. Deja el ambiente en **pruebas** y emite unas cuantas facturas contra
   `celcer` antes de pasar a producción.

Desde **Facturar** se emite la factura y se ve la respuesta del SRI. Lo emitido
queda además en **Comprobantes** como una venta más, lista para contabilizar
con el mismo botón de siempre.

**Antes de pasar a producción** el RUC tiene que estar autorizado para emisión
electrónica en SRI en Línea, con sus establecimientos y puntos de emisión
declarados. Una factura autorizada en producción es un documento tributario
real: solo se deja sin efecto con una nota de crédito o con la solicitud de
anulación del portal del SRI.

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
                       0010 deduplicación de documentos
                       0011 facturación electrónica
src/lib/               ia · esquemas · prompts · extraccion · clasificacion
                       contabilizacion · cuentas · api · fechas · formato
                       carga · supabase/
src/lib/sri/           catalogos · clave-acceso · xml · firma · certificado
                       ws · emision · ride · codigo-barras
src/app/api/           documentos · movimientos · comprobantes · retenciones
                       cartera · voz · informes · categorias · cuentas
                       entidades · health · sri/
src/app/               panel · ingesta · movimientos · comprobantes
                       facturar · retenciones · cartera · informes
                       impuestos · ajustes · login
```

## Sobre los cálculos tributarios

Los números de casillero del formulario 104 siguen la estructura vigente, y los
parámetros de renta que se siembran en la migración `0008` son valores de
referencia marcados como tales. **Antes de presentar cualquier declaración hay
que contrastarlos con la resolución del SRI del ejercicio**: el sistema es una
herramienta de gestión y de preparación, no un sustituto del criterio
profesional.
