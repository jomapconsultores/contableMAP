/**
 * Copia los archivos de Storage del proyecto alojado al stack propio.
 *
 *     ORIGEN_URL=https://xxx.supabase.co ORIGEN_SERVICE_KEY=… \
 *     DESTINO_URL=https://supabase.pensamiento-libre.org DESTINO_SERVICE_KEY=… \
 *     node deploy/supabase/copiar-buckets.mjs
 *
 * Son tres buckets: `documentos` (los PDF y XML que se procesan),
 * `certificados` (los .p12 de firma electrónica) y `comprobantes` (los XML
 * firmados y autorizados por el SRI).
 *
 * Sube por la API, no copiando archivos sueltos al disco, para que el
 * inventario de `storage.objects` lo escriba el propio servicio y no pueda
 * quedar descuadrado respecto a lo que hay en el volumen.
 *
 * Es idempotente: `upsert` reescribe el archivo si la ruta ya existe, así que
 * se puede repetir tras un fallo sin duplicar nada.
 *
 * Cuidado con dónde se ejecuta: las dos claves de servicio se saltan RLS.
 */

import { createClient } from "@supabase/supabase-js";

const env = (nombre) => {
  const valor = process.env[nombre];
  if (!valor) {
    console.error(`Falta ${nombre}`);
    process.exit(1);
  }
  return valor;
};

const origen = createClient(env("ORIGEN_URL"), env("ORIGEN_SERVICE_KEY"), {
  auth: { persistSession: false },
});
const destino = createClient(env("DESTINO_URL"), env("DESTINO_SERVICE_KEY"), {
  auth: { persistSession: false },
});

/** Recorre un bucket entero, entrando en cada carpeta. */
async function* recorrer(cliente, bucket, prefijo = "") {
  const PAGINA = 100;
  for (let desplazamiento = 0; ; desplazamiento += PAGINA) {
    const { data, error } = await cliente.storage
      .from(bucket)
      .list(prefijo, { limit: PAGINA, offset: desplazamiento });

    if (error) throw new Error(`listando ${bucket}/${prefijo}: ${error.message}`);
    if (!data || data.length === 0) return;

    for (const entrada of data) {
      const ruta = prefijo ? `${prefijo}/${entrada.name}` : entrada.name;
      // Las carpetas llegan sin id: no son objetos, hay que descender.
      if (entrada.id === null) {
        yield* recorrer(cliente, bucket, ruta);
      } else {
        yield { ruta, tipo: entrada.metadata?.mimetype, tamano: entrada.metadata?.size };
      }
    }

    if (data.length < PAGINA) return;
  }
}

const { data: buckets, error: errorBuckets } = await origen.storage.listBuckets();
if (errorBuckets) {
  console.error(`No se pudieron listar los buckets del origen: ${errorBuckets.message}`);
  process.exit(1);
}

let copiados = 0;
let fallidos = 0;
let bytes = 0;

for (const bucket of buckets) {
  console.log(`\n=== ${bucket.name} ===`);

  const { error: errorCrear } = await destino.storage.createBucket(bucket.name, {
    public: bucket.public,
    fileSizeLimit: bucket.file_size_limit,
    allowedMimeTypes: bucket.allowed_mime_types,
  });
  // Repetir la copia no debe fallar solo porque el bucket ya exista.
  if (errorCrear && !/exists/i.test(errorCrear.message)) {
    console.error(`  no se pudo crear el bucket: ${errorCrear.message}`);
    fallidos++;
    continue;
  }

  for await (const archivo of recorrer(origen, bucket.name)) {
    const { data: contenido, error: errorDescarga } = await origen.storage
      .from(bucket.name)
      .download(archivo.ruta);

    if (errorDescarga) {
      console.error(`  ✗ ${archivo.ruta} — descarga: ${errorDescarga.message}`);
      fallidos++;
      continue;
    }

    const { error: errorSubida } = await destino.storage
      .from(bucket.name)
      .upload(archivo.ruta, contenido, {
        contentType: archivo.tipo ?? "application/octet-stream",
        upsert: true,
      });

    if (errorSubida) {
      console.error(`  ✗ ${archivo.ruta} — subida: ${errorSubida.message}`);
      fallidos++;
      continue;
    }

    copiados++;
    bytes += archivo.tamano ?? 0;
    console.log(`  ✓ ${archivo.ruta}`);
  }
}

console.log(
  `\n${copiados} archivos copiados (${(bytes / 1024 / 1024).toFixed(1)} MB), ${fallidos} con error.`,
);
process.exit(fallidos > 0 ? 1 : 0);
