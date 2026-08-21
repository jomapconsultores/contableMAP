/**
 * Code 128 en SVG, para la clave de acceso del RIDE.
 *
 * Se genera aquí en vez de tirar de una librería porque el caso es uno solo y
 * está cerrado: 49 dígitos, siempre los mismos. Los 48 primeros van en
 * conjunto C, que empaqueta dos cifras por símbolo, y el último en conjunto B,
 * porque C solo admite pares.
 */

/** Anchos de barra y espacio de cada símbolo, del 0 al 106. */
const PATRONES = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
  "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
];

const CODIGO_B = 100;
const INICIO_C = 105;
const PARADA = 106;

/** Símbolos de una cadena de dígitos: pares en C y el sobrante en B. */
function simbolos(digitos: string): number[] {
  const salida = [INICIO_C];
  let i = 0;

  while (digitos.length - i >= 2) {
    salida.push(Number(digitos.slice(i, i + 2)));
    i += 2;
  }
  if (i < digitos.length) {
    salida.push(CODIGO_B);
    salida.push(digitos.charCodeAt(i) - 32);
  }

  const suma = salida.reduce((acc, v, pos) => acc + (pos === 0 ? v : v * pos), 0);
  salida.push(suma % 103);
  salida.push(PARADA);
  return salida;
}

export interface OpcionesBarras {
  /** Ancho del módulo más estrecho, en píxeles. */
  modulo?: number;
  alto?: number;
}

/** SVG autocontenido con el código de barras de la clave de acceso. */
export function codigoBarras128(datos: string, opciones: OpcionesBarras = {}): string {
  if (!/^[0-9]+$/.test(datos)) throw new Error("El código de barras solo admite dígitos.");

  const modulo = opciones.modulo ?? 1.4;
  const alto = opciones.alto ?? 46;

  let x = 0;
  const barras: string[] = [];

  for (const simbolo of simbolos(datos)) {
    const patron = PATRONES[simbolo];
    for (let i = 0; i < patron.length; i += 1) {
      const ancho = Number(patron[i]) * modulo;
      // Las posiciones pares son barra; las impares, espacio.
      if (i % 2 === 0) {
        barras.push(`<rect x="${x.toFixed(2)}" y="0" width="${ancho.toFixed(2)}" height="${alto}"/>`);
      }
      x += ancho;
    }
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(x)}" height="${alto}" ` +
    `viewBox="0 0 ${Math.ceil(x)} ${alto}" role="img" aria-label="Clave de acceso ${datos}">` +
    `<rect width="100%" height="100%" fill="#fff"/><g fill="#000">${barras.join("")}</g></svg>`
  );
}
