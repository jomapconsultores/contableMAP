/**
 * Deja que Node ejecute directamente el TypeScript de `src/` en las pruebas.
 *
 * Node 24 quita los tipos por su cuenta, pero no adivina extensiones ni
 * entiende el alias `@/` del `tsconfig`: eso lo hace el bundler de Next, que
 * aquí no interviene. Este gancho resuelve ambas cosas y nada más, de modo que
 * las pruebas corren sobre el mismo código que se despliega, sin compilarlo ni
 * duplicarlo.
 */
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve as resolverRuta } from "node:path";

const RAIZ = resolverRuta(fileURLToPath(import.meta.url), "../../../src");

const candidatos = (base) => [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`];

function primeroQueExiste(rutas) {
  for (const r of rutas) if (existsSync(fileURLToPath(r))) return r;
  return null;
}

registerHooks({
  resolve(especificador, contexto, siguiente) {
    const tieneExtension = /\.[cm]?[jt]sx?$/.test(especificador);

    if (especificador.startsWith("@/")) {
      const base = pathToFileURL(resolverRuta(RAIZ, especificador.slice(2))).href;
      const url = tieneExtension ? base : primeroQueExiste(candidatos(base));
      if (url) return { url, shortCircuit: true };
    }

    if (especificador.startsWith(".") && !tieneExtension && contexto.parentURL) {
      const url = primeroQueExiste(candidatos(new URL(especificador, contexto.parentURL).href));
      if (url) return { url, shortCircuit: true };
    }

    return siguiente(especificador, contexto);
  },
});
