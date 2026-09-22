// Envía a ContableMAP los gastos en efectivo dictados a Microsoft To Do.
//
// Lee la copia local que la app de To Do guarda en este PC —no hace falta
// conectar la cuenta de Microsoft— y manda las notas de la lista «Gastos
// personales» de los últimos 60 días. ContableMAP descarta las que ya importó,
// así que mandarlas otra vez no duplica nada.
//
// Configuración en %USERPROFILE%\.contablemap\efectivo.json:
//   { "url": "https://map.pensamiento-libre.org", "token": "…", "entidad_ruc": "1710308741001" }
//
// Uso: node enviar.mjs            (lo ejecuta la tarea programada)
//      node enviar.mjs --prueba   (muestra qué mandaría, sin mandar nada)

import { DatabaseSync } from "node:sqlite";
import { appendFileSync, copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

const DIR = path.join(homedir(), ".contablemap");
const LOG = path.join(DIR, "efectivo.log");
const LISTA = "Gastos personales";
const DIAS = 60;
const POR_PETICION = 5;

const log = (...a) => {
  const linea = `${new Date().toISOString()} ${a.join(" ")}`;
  console.log(linea);
  try {
    appendFileSync(LOG, linea + "\n");
  } catch {
    // Sin carpeta de configuración no hay dónde anotar; la consola basta.
  }
};

function baseDeTodo() {
  const raiz = path.join(
    process.env.LOCALAPPDATA ?? path.join(homedir(), "AppData", "Local"),
    "Packages", "Microsoft.Todos_8wekyb3d8bbwe", "LocalState", "AccountsRoot",
  );
  for (const cuenta of readdirSync(raiz)) {
    const db = path.join(raiz, cuenta, "todosqlite.db");
    if (existsSync(db)) return db;
  }
  throw new Error(`No se encontró la base de To Do en ${raiz}`);
}

/** La app puede tener la base abierta: se lee una copia, con su diario WAL. */
function leerNotas() {
  const original = baseDeTodo();
  const tmp = mkdtempSync(path.join(tmpdir(), "todo-"));
  try {
    for (const suf of ["", "-wal", "-shm"]) {
      if (existsSync(original + suf)) copyFileSync(original + suf, path.join(tmp, "todo.db" + suf));
    }
    const db = new DatabaseSync(path.join(tmp, "todo.db"), { readOnly: true });
    const desde = new Date(Date.now() - DIAS * 86400_000).toISOString();
    const filas = db
      .prepare(
        `select t.online_id as id, t.subject as asunto, t.body_content as cuerpo,
                t.created_datetime as creada
           from tasks t
           join task_folders f on f.local_id = t.task_folder_local_id
          where f.name like ? and f.deleted = 0 and t.deleted = 0
            and t.online_id is not null and t.created_datetime >= ?
          order by t.created_datetime`,
      )
      .all(`%${LISTA}`, desde);
    db.close();
    return filas.map((f) => ({
      id: f.id,
      texto: [f.asunto, f.cuerpo].filter((x) => x && x.trim()).join(" — ").slice(0, 2000),
      creada: f.creada,
    }));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

const prueba = process.argv.includes("--prueba");
try {
  const notas = leerNotas();
  if (prueba) {
    for (const n of notas) console.log(n.creada.slice(0, 10), "|", n.texto);
    console.log(`${notas.length} notas de los últimos ${DIAS} días.`);
    process.exit(0);
  }

  const cfg = JSON.parse(readFileSync(path.join(DIR, "efectivo.json"), "utf8"));
  const total = { recibidas: 0, yaImportadas: 0, registradas: 0 };

  for (let i = 0; i < notas.length; i += POR_PETICION) {
    const r = await fetch(`${cfg.url.replace(/\/$/, "")}/api/integracion/efectivo`, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ entidad_ruc: cfg.entidad_ruc, notas: notas.slice(i, i + POR_PETICION) }),
    });
    const j = await r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` }));
    if (!j.ok) throw new Error(j.error);
    total.recibidas += j.datos.recibidas;
    total.yaImportadas += j.datos.yaImportadas;
    total.registradas += j.datos.registradas;
    for (const s of j.datos.sinCategoria ?? []) log("sin categoría:", s);
  }

  log(`OK · ${total.recibidas} notas · ${total.yaImportadas} ya estaban · ${total.registradas} gastos nuevos`);
} catch (e) {
  log("ERROR", e instanceof Error ? e.message : String(e));
  process.exit(1);
}
