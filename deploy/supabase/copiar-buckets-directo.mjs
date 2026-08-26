/**
 * Copia los archivos de Storage hablando directamente con storage-api.
 *
 * Se ejecuta DENTRO de la red de Docker del servidor, así que no necesita el
 * dominio público ni el certificado:
 *
 *   docker run --rm --network coolify \
 *     -v /opt/contable-supabase/copiar-buckets-directo.mjs:/copiar.mjs \
 *     -e ORIGEN_URL -e ORIGEN_SERVICE_KEY -e DESTINO_SERVICE_KEY \
 *     node:22-alpine node /copiar.mjs
 *
 * Sin dependencias: solo `fetch`, que Node 22 ya trae. Contra el origen usa las
 * rutas públicas (/storage/v1/…); contra el destino, las nativas de storage-api
 * (/bucket, /object/…), porque ahí no hay pasarela delante que recorte el
 * prefijo.
 *
 * Es idempotente: sube con upsert, así que se puede repetir tras un fallo.
 */

const ORIGEN = process.env.ORIGEN_URL.replace(/\/$/, "");
if (!process.env.ORIGEN_SERVICE_KEY || !process.env.DESTINO_SERVICE_KEY) {
  console.error("Faltan ORIGEN_SERVICE_KEY o DESTINO_SERVICE_KEY");
  process.exit(1);
}
const CLAVE_ORIGEN = process.env.ORIGEN_SERVICE_KEY;
const CLAVE_DESTINO = process.env.DESTINO_SERVICE_KEY;
// El nombre del contenedor de storage cambia según el proyecto; se pasa por
// entorno para poder reutilizar este script en todas las migraciones.
const DESTINO = `http://${process.env.DESTINO_HOST || "storage"}:5000`;

const cabOrigen = { apikey: CLAVE_ORIGEN, Authorization: `Bearer ${CLAVE_ORIGEN}` };
const cabDestino = { Authorization: `Bearer ${CLAVE_DESTINO}` };

/** Lista un prefijo del bucket; storage-api devuelve las carpetas sin id. */
async function listar(bucket, prefijo = "") {
  const resp = await fetch(`${ORIGEN}/storage/v1/object/list/${bucket}`, {
    method: "POST",
    headers: { ...cabOrigen, "Content-Type": "application/json" },
    body: JSON.stringify({ prefix: prefijo, limit: 1000, offset: 0 }),
  });
  if (!resp.ok) throw new Error(`listando ${bucket}/${prefijo}: ${resp.status}`);
  return resp.json();
}

async function* recorrer(bucket, prefijo = "") {
  for (const entrada of await listar(bucket, prefijo)) {
    const ruta = prefijo ? `${prefijo}/${entrada.name}` : entrada.name;
    if (entrada.id === null) yield* recorrer(bucket, ruta);
    else yield { ruta, tipo: entrada.metadata?.mimetype, tamano: entrada.metadata?.size };
  }
}

const respBuckets = await fetch(`${ORIGEN}/storage/v1/bucket`, { headers: cabOrigen });
const buckets = await respBuckets.json();
console.log(`${buckets.length} buckets en el origen\n`);

let copiados = 0, fallidos = 0, bytes = 0;

for (const b of buckets) {
  console.log(`=== ${b.name} ===`);

  // Con OMITIR_CREAR_BUCKET los buckets se dan por creados (por ejemplo,
  // insertados por SQL). Algunas versiones de storage-api rechazan crear
  // buckets en bases añadidas a mano con «DatabaseSchemaMismatch», aunque
  // luego sirven objetos sin problema.
  const creado = process.env.OMITIR_CREAR_BUCKET ? { ok: true } : await fetch(`${DESTINO}/bucket`, {
    method: "POST",
    headers: { ...cabDestino, "Content-Type": "application/json" },
    body: JSON.stringify({
      id: b.id, name: b.name, public: b.public,
      file_size_limit: b.file_size_limit, allowed_mime_types: b.allowed_mime_types,
    }),
  });
  if (!creado.ok) {
    const detalle = await creado.text();
    // Repetir la copia no debe fallar solo porque el bucket ya exista.
    if (!/exist/i.test(detalle)) { console.error(`  bucket: ${detalle}`); fallidos++; continue; }
  }

  for await (const archivo of recorrer(b.name)) {
    const descarga = await fetch(
      `${ORIGEN}/storage/v1/object/${b.name}/${encodeURI(archivo.ruta)}`, { headers: cabOrigen });
    if (!descarga.ok) { console.error(`  ✗ ${archivo.ruta} — descarga ${descarga.status}`); fallidos++; continue; }

    const cuerpo = Buffer.from(await descarga.arrayBuffer());
    const subida = await fetch(`${DESTINO}/object/${b.name}/${encodeURI(archivo.ruta)}`, {
      method: "POST",
      headers: {
        ...cabDestino,
        "Content-Type": archivo.tipo ?? "application/octet-stream",
        "x-upsert": "true",
      },
      body: cuerpo,
    });
    if (!subida.ok) { console.error(`  ✗ ${archivo.ruta} — subida ${subida.status}: ${await subida.text()}`); fallidos++; continue; }

    copiados++; bytes += cuerpo.length;
    console.log(`  ✓ ${archivo.ruta}  (${(cuerpo.length / 1024).toFixed(0)} KB)`);
  }
}

console.log(`\n${copiados} archivos copiados (${(bytes / 1024 / 1024).toFixed(2)} MB), ${fallidos} con error.`);
process.exit(fallidos > 0 ? 1 : 0);
