import type { SupabaseClient } from "@supabase/supabase-js";
import { consultar } from "./ia";
import { CuentaIdentificada } from "./esquemas";
import { SISTEMA_IDENTIFICAR_CUENTA } from "./prompts";

/**
 * Determina a qué cuenta financiera registrada pertenece un estado de cuenta,
 * a partir de la cabecera que la IA extrajo del documento. Así el usuario no
 * tiene que elegir la cuenta a mano.
 *
 * Estrategia: primero una coincidencia determinista por dígitos e institución
 * (exacta y gratis para el caso normal); si queda ambigua, decide la IA; y si
 * nada corresponde, se crea la cuenta con los datos leídos del propio extracto.
 */

export type TipoExtracto = "BANCO" | "TARJETA_CREDITO" | "COOPERATIVA" | "OTRO";

export interface CabeceraExtracto {
  institucion: string | null;
  numero_cuenta: string | null;
  tipo_cuenta: TipoExtracto;
  titular: string | null;
}

interface CuentaRegistrada {
  id: string;
  nombre: string;
  tipo: string;
  institucion: string | null;
  numero: string | null;
}

export interface Emparejamiento {
  cuentaId: string;
  nombre: string;
  origen: "DIGITOS" | "IA" | "CREADA";
  motivo: string;
}

const soloDigitos = (s: string | null | undefined) => (s ?? "").replace(/\D+/g, "");

const normaliza = (s: string | null | undefined) =>
  (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** ¿La institución del extracto y la registrada aluden al mismo banco? */
function mismaInstitucion(a: string | null, b: string | null): boolean {
  const x = normaliza(a);
  const y = normaliza(b);
  if (!x || !y) return false;
  if (x === y) return true;
  // La primera palabra significativa suele bastar: "Banco Pichincha" ~ "Pichincha".
  const clave = (t: string) =>
    t.split(" ").filter((w) => !["BANCO", "COOP", "COOPERATIVA", "DEL", "DE", "LA"].includes(w));
  return clave(x).some((w) => w.length > 3 && y.includes(w));
}

/**
 * Dos números casan si comparten al menos sus cuatro últimos dígitos. Cubre el
 * enmascarado habitual (****9004, 040XXX4825) sin caer en falsos positivos de
 * coincidencias cortas.
 */
function mismoNumero(a: string | null, b: string | null): boolean {
  const x = soloDigitos(a);
  const y = soloDigitos(b);
  if (x.length < 4 || y.length < 4) return false;
  return x.slice(-4) === y.slice(-4);
}

const CUENTA_CONTABLE: Record<string, string> = {
  BANCO: "1.1.01.02",
  COOPERATIVA: "1.1.01.03",
  TARJETA_CREDITO: "2.1.03",
};

const TIPO_FINANCIERO: Record<TipoExtracto, string> = {
  BANCO: "BANCO",
  COOPERATIVA: "COOPERATIVA",
  TARJETA_CREDITO: "TARJETA_CREDITO",
  OTRO: "BANCO",
};

export async function identificarCuenta(
  sb: SupabaseClient,
  entidadId: string,
  cabecera: CabeceraExtracto,
): Promise<Emparejamiento> {
  const { data } = await sb
    .from("cuentas_financieras")
    .select("id, nombre, tipo, institucion, numero")
    .eq("entidad_id", entidadId)
    .eq("activo", true);

  const cuentas = (data ?? []) as CuentaRegistrada[];

  // --- Paso 1: coincidencia determinista --------------------------------
  // El número comparte los últimos dígitos: señal fuerte. Si además coincide
  // la institución, es prácticamente segura.
  const porNumero = cuentas.filter((c) => mismoNumero(cabecera.numero_cuenta, c.numero));

  if (porNumero.length === 1) {
    return {
      cuentaId: porNumero[0].id,
      nombre: porNumero[0].nombre,
      origen: "DIGITOS",
      motivo: "Coincide el número de cuenta",
    };
  }

  if (porNumero.length > 1) {
    // Varias con los mismos 4 dígitos finales: desempata la institución.
    const conBanco = porNumero.filter((c) => mismaInstitucion(cabecera.institucion, c.institucion));
    if (conBanco.length === 1) {
      return {
        cuentaId: conBanco[0].id,
        nombre: conBanco[0].nombre,
        origen: "DIGITOS",
        motivo: "Coincide el número y la institución",
      };
    }
  }

  // --- Paso 2: decide la IA entre las registradas -----------------------
  if (cuentas.length > 0) {
    const lista = cuentas
      .map(
        (c, i) =>
          `${i}. ${c.nombre} · tipo ${c.tipo} · institución ${c.institucion ?? "—"} · número ${c.numero ?? "—"}`,
      )
      .join("\n");

    const { datos } = await consultar({
      sistema: SISTEMA_IDENTIFICAR_CUENTA,
      esquema: CuentaIdentificada,
      maxTokens: 2000,
      esfuerzo: "medium",
      contenido: [
        {
          type: "text",
          text:
            `Cabecera del estado de cuenta:\n` +
            `  institución: ${cabecera.institucion ?? "—"}\n` +
            `  número: ${cabecera.numero_cuenta ?? "—"}\n` +
            `  tipo: ${cabecera.tipo_cuenta}\n` +
            `  titular: ${cabecera.titular ?? "—"}\n\n` +
            `Cuentas registradas:\n${lista}`,
        },
      ],
    });

    if (datos.indice >= 0 && datos.indice < cuentas.length && datos.confianza >= 0.6) {
      const c = cuentas[datos.indice];
      return { cuentaId: c.id, nombre: c.nombre, origen: "IA", motivo: datos.motivo };
    }
  }

  // --- Paso 3: no existe; se crea con lo que dice el propio extracto -----
  return crearDesdeCabecera(sb, entidadId, cabecera);
}

async function crearDesdeCabecera(
  sb: SupabaseClient,
  entidadId: string,
  cabecera: CabeceraExtracto,
): Promise<Emparejamiento> {
  const tipo = TIPO_FINANCIERO[cabecera.tipo_cuenta];
  const codigo = CUENTA_CONTABLE[tipo] ?? "1.1.01.02";

  const { data: cuentaContable } = await sb
    .from("plan_cuentas")
    .select("id")
    .eq("entidad_id", entidadId)
    .eq("codigo", codigo)
    .maybeSingle();

  const inst = cabecera.institucion?.trim() || "Institución sin identificar";
  const num = soloDigitos(cabecera.numero_cuenta);
  const nombre = num ? `${inst} - ${num.slice(-6)}` : inst;

  const { data, error } = await sb
    .from("cuentas_financieras")
    .insert({
      entidad_id: entidadId,
      nombre,
      tipo,
      institucion: inst,
      numero: cabecera.numero_cuenta,
      cuenta_id: cuentaContable?.id ?? null,
    })
    .select("id, nombre")
    .single();

  // Si ya existía una con ese nombre (choque de unicidad), la reutilizamos.
  if (error) {
    const { data: existente } = await sb
      .from("cuentas_financieras")
      .select("id, nombre")
      .eq("entidad_id", entidadId)
      .eq("nombre", nombre)
      .maybeSingle();
    if (existente) {
      return {
        cuentaId: existente.id,
        nombre: existente.nombre,
        origen: "CREADA",
        motivo: "Cuenta ya existente reutilizada",
      };
    }
    throw new Error(`No se pudo crear la cuenta del extracto: ${error.message}`);
  }

  return {
    cuentaId: data.id,
    nombre: data.nombre,
    origen: "CREADA",
    motivo: "Cuenta creada a partir de los datos del estado de cuenta",
  };
}
