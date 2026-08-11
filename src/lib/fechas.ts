/**
 * Normalización de fechas a ISO (AAAA-MM-DD).
 *
 * El modelo recibe la instrucción de devolver ISO, pero no siempre obedece:
 * los estados de cuenta ecuatorianos vienen en DD/MM/AAAA y con frecuencia se
 * cuela ese formato en la respuesta. La columna `date` de PostgreSQL
 * rechazaría "08/06/2026" (o peor, lo interpretaría como 8 de junio o como el
 * mes 6 según el locale), así que la conversión se hace aquí, en el límite con
 * la base de datos, y no se deja a merced del prompt.
 */

const ISO = /^(\d{4})-(\d{1,2})-(\d{1,2})/;
const DMY = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/;
const YMD_COMPACTO = /^(\d{4})(\d{2})(\d{2})$/;

const dosDigitos = (n: string) => n.padStart(2, "0");

/**
 * Convierte a AAAA-MM-DD. Devuelve null si no se reconoce el formato, para que
 * quien llama decida (usar la fecha de hoy, rechazar, etc.) en lugar de
 * insertar una fecha inventada.
 */
export function aISO(valor: string | null | undefined): string | null {
  if (!valor) return null;
  const s = valor.trim();

  let m = ISO.exec(s);
  if (m) return `${m[1]}-${dosDigitos(m[2])}-${dosDigitos(m[3])}`;

  // DD/MM/AAAA — el orden ecuatoriano: día primero.
  m = DMY.exec(s);
  if (m) {
    const dia = Number(m[1]);
    const mes = Number(m[2]);
    if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
    return `${m[3]}-${dosDigitos(m[2])}-${dosDigitos(m[1])}`;
  }

  m = YMD_COMPACTO.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;

  return null;
}

/** Igual que `aISO`, pero cae a la fecha de hoy cuando no hay valor reconocible. */
export function aISOoHoy(valor: string | null | undefined): string {
  return aISO(valor) ?? new Date().toISOString().slice(0, 10);
}
