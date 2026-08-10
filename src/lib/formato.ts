const MONEDA = new Intl.NumberFormat("es-EC", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
});

const NUMERO = new Intl.NumberFormat("es-EC", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export const usd = (v: unknown) => MONEDA.format(Number(v ?? 0));
export const num = (v: unknown) => NUMERO.format(Number(v ?? 0));

export const fecha = (v: string | null | undefined) => {
  if (!v) return "—";
  // Se fija UTC: una fecha contable no debe desplazarse por zona horaria.
  const d = new Date(`${v.slice(0, 10)}T00:00:00Z`);
  return d.toLocaleDateString("es-EC", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
};

export const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

export const nombreMes = (m: number) => MESES[m - 1] ?? String(m);
