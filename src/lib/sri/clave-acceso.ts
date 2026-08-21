/**
 * Clave de acceso: los 49 dígitos que identifican el comprobante ante el SRI.
 *
 *   ddmmaaaa (8) · tipo (2) · RUC (13) · ambiente (1) · serie (6)
 *   · secuencial (9) · código numérico (8) · tipo de emisión (1) · verificador (1)
 *
 * En el esquema offline la clave la calcula el emisor, y es también el número
 * de autorización: si un solo dígito no cuadra, el SRI devuelve el comprobante.
 */

export class ErrorClaveAcceso extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ErrorClaveAcceso";
  }
}

/**
 * Dígito verificador por módulo 11: se pondera de derecha a izquierda con
 * 2,3,4,5,6,7 en ciclo. Resto 0 → 0; resto 1 → 1 (no 10, que no es un dígito).
 */
export function digitoVerificador(cadena: string): number {
  let suma = 0;
  let peso = 2;

  for (let i = cadena.length - 1; i >= 0; i -= 1) {
    const d = cadena.charCodeAt(i) - 48;
    if (d < 0 || d > 9) throw new ErrorClaveAcceso("La clave de acceso solo admite dígitos.");
    suma += d * peso;
    peso = peso === 7 ? 2 : peso + 1;
  }

  const resto = suma % 11;
  const dv = 11 - resto;
  if (dv === 11) return 0;
  if (dv === 10) return 1;
  return dv;
}

const soloDigitos = (v: string) => /^[0-9]+$/.test(v);
const rellena = (v: string | number, largo: number) => String(v).padStart(largo, "0");

export interface DatosClave {
  /** Fecha de emisión del comprobante. */
  fecha: Date;
  /** Código de la tabla 3: "01" factura, "04" nota de crédito, ... */
  tipoComprobante: string;
  ruc: string;
  /** 1 pruebas, 2 producción. */
  ambiente: number;
  establecimiento: string;
  puntoEmision: string;
  secuencial: number | string;
  /** Ocho dígitos a elección del emisor. Si no se pasa, se genera. */
  codigoNumerico?: string;
  /** 1 = emisión normal. */
  tipoEmision?: number;
}

/** Ocho dígitos aleatorios. El SRI solo exige que sean numéricos. */
export function codigoNumericoAleatorio(): string {
  let v = "";
  for (let i = 0; i < 8; i += 1) v += Math.floor(Math.random() * 10);
  return v;
}

export function claveAcceso(datos: DatosClave): string {
  const { fecha, tipoComprobante, ruc, ambiente } = datos;

  if (!soloDigitos(ruc) || ruc.length !== 13) {
    throw new ErrorClaveAcceso(`El RUC del emisor debe tener 13 dígitos: "${ruc}".`);
  }
  if (!soloDigitos(tipoComprobante) || tipoComprobante.length !== 2) {
    throw new ErrorClaveAcceso("Tipo de comprobante no válido.");
  }
  if (ambiente !== 1 && ambiente !== 2) {
    throw new ErrorClaveAcceso("El ambiente debe ser 1 (pruebas) o 2 (producción).");
  }

  const dia = rellena(fecha.getDate(), 2);
  const mes = rellena(fecha.getMonth() + 1, 2);
  const anio = String(fecha.getFullYear());

  const codigo = datos.codigoNumerico ?? codigoNumericoAleatorio();
  if (!soloDigitos(codigo) || codigo.length !== 8) {
    throw new ErrorClaveAcceso("El código numérico debe tener 8 dígitos.");
  }

  const cuerpo =
    dia + mes + anio +
    tipoComprobante +
    ruc +
    String(ambiente) +
    rellena(datos.establecimiento, 3) +
    rellena(datos.puntoEmision, 3) +
    rellena(datos.secuencial, 9) +
    codigo +
    String(datos.tipoEmision ?? 1);

  if (cuerpo.length !== 48) {
    throw new ErrorClaveAcceso(
      `La clave de acceso quedó con ${cuerpo.length} dígitos antes del verificador; deben ser 48.`,
    );
  }

  return cuerpo + digitoVerificador(cuerpo);
}

/** Comprueba largo y dígito verificador de una clave recibida. */
export function claveAccesoValida(clave: string): boolean {
  if (clave.length !== 49 || !soloDigitos(clave)) return false;
  return digitoVerificador(clave.slice(0, 48)) === Number(clave[48]);
}
