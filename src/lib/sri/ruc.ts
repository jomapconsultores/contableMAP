/**
 * Consulta del RUC en el catastro público del SRI.
 *
 * Es el mismo servicio que alimenta «Consulta de RUC» de SRI en Línea, y no
 * pide credenciales: cualquiera puede preguntar por un RUC. Sirve para dos
 * cosas distintas y las dos importan.
 *
 * La primera es clasificar. La actividad económica declarada al SRI dice qué
 * vende un proveedor mejor que su nombre comercial: «DIFARE» parecía una
 * ferretería y el catastro la describe como venta al por menor de productos
 * farmacéuticos, que es salud. Adivinar por el nombre se equivoca; preguntar,
 * no.
 *
 * La segunda es tributaria. Si el proveedor está con el RUC suspendido, o es
 * agente de retención, o contribuyente especial, eso cambia lo que hay que
 * hacer con su comprobante. Vale la pena saberlo antes de contabilizar.
 */

const CATASTRO =
  "https://srienlinea.sri.gob.ec/sri-catastro-sujeto-servicio-internet/rest/ConsolidadoContribuyente/obtenerPorNumerosRuc";

export interface Contribuyente {
  ruc: string;
  razonSocial: string | null;
  nombreComercial: string | null;
  estado: string | null;
  /** Lo que declaró vender o hacer. La señal útil para clasificar. */
  actividad: string | null;
  tipo: string | null;
  regimen: string | null;
  obligadoContabilidad: boolean;
  agenteRetencion: boolean;
  contribuyenteEspecial: boolean;
}

interface Crudo {
  numeroRuc?: string;
  razonSocial?: string;
  nombreComercial?: string;
  estadoContribuyente?: string;
  actividadEconomicaPrincipal?: string;
  tipoContribuyente?: string;
  regimen?: string;
  obligadoLlevarContabilidad?: string;
  agenteRetencion?: string;
  contribuyenteEspecial?: string;
}

const si = (v: string | undefined) => (v ?? "").trim().toUpperCase() === "SI";

/** Cédula ecuatoriana: módulo 10 sobre los nueve primeros dígitos. */
function rucPlausible(ruc: string): boolean {
  return /^[0-9]{13}$/.test(ruc) && ruc.endsWith("001");
}

/**
 * Pregunta por un RUC. Devuelve `null` si el SRI no lo conoce.
 *
 * No lanza cuando el servicio está caído: la consulta es una ayuda para
 * clasificar mejor, no un requisito para registrar un gasto. Si el catastro no
 * responde, el sistema sigue con lo que ya sabía.
 */
export async function consultarRuc(ruc: string): Promise<Contribuyente | null> {
  const limpio = ruc.trim();
  if (!rucPlausible(limpio)) return null;

  let respuesta: Response;
  try {
    respuesta = await fetch(`${CATASTRO}?&ruc=${encodeURIComponent(limpio)}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15000),
      cache: "no-store",
    });
  } catch {
    return null;
  }

  if (!respuesta.ok) return null;

  const cuerpo = (await respuesta.json().catch(() => null)) as Crudo[] | Crudo | null;
  const c = Array.isArray(cuerpo) ? cuerpo[0] : cuerpo;
  if (!c || !c.razonSocial) return null;

  return {
    ruc: c.numeroRuc ?? limpio,
    razonSocial: c.razonSocial ?? null,
    nombreComercial: c.nombreComercial ?? null,
    estado: c.estadoContribuyente ?? null,
    actividad: c.actividadEconomicaPrincipal ?? null,
    tipo: c.tipoContribuyente ?? null,
    regimen: c.regimen ?? null,
    obligadoContabilidad: si(c.obligadoLlevarContabilidad),
    agenteRetencion: si(c.agenteRetencion),
    contribuyenteEspecial: si(c.contribuyenteEspecial),
  };
}

/**
 * Varios RUC de una vez, en tandas cortas.
 *
 * El catastro es un servicio público y gratuito: se le pregunta de tres en
 * tres y con una pausa entre tandas, que es la cortesía mínima con un servicio
 * del Estado que no cobra por esto.
 */
export async function consultarRucs(
  rucs: string[],
): Promise<Map<string, Contribuyente>> {
  const unicos = [...new Set(rucs.map((r) => r.trim()).filter(rucPlausible))];
  const salida = new Map<string, Contribuyente>();

  for (let i = 0; i < unicos.length; i += 3) {
    const tanda = await Promise.all(unicos.slice(i, i + 3).map(consultarRuc));
    for (const c of tanda) if (c) salida.set(c.ruc, c);
    if (i + 3 < unicos.length) await new Promise((r) => setTimeout(r, 400));
  }

  return salida;
}
