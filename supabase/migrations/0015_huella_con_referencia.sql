-- ---------------------------------------------------------------------
-- La huella de una línea de extracto necesita la referencia
--
-- La huella era fecha|descripción|monto|naturaleza. Con eso, dos movimientos
-- legítimos e idénticos del mismo día comparten huella, y como la carga usa
-- ignoreDuplicates, el segundo se descarta en silencio. No es hipotético: la
-- cuenta 1939365 de Jardín Azuayo tuvo dos retiros de 200,00 el 12/02/2026
-- —comprobantes 436408003 y 436481128, a las 13:13 y a las 18:47— y sólo entró
-- uno. La cuenta quedaba 200,00 por encima del saldo impreso en el extracto,
-- que es justo el error que un sistema contable no puede permitirse.
--
-- Se añade la referencia a la huella y se recalculan las existentes con la
-- misma fórmula que usa la aplicación, para que recargar un extracto ya
-- cargado siga sin duplicar nada.
-- ---------------------------------------------------------------------

create extension if not exists pgcrypto;

update public.movimientos_extracto
   set hash_linea = substr(
     encode(
       digest(
         fecha::text || '|' ||
         upper(btrim(descripcion)) || '|' ||
         to_char(monto, 'FM9999999999990.00') || '|' ||
         naturaleza || '|' ||
         coalesce(referencia, ''),
         'sha256'),
       'hex'),
     1, 32);

comment on column public.movimientos_extracto.hash_linea is
  'sha256(fecha|DESCRIPCIÓN|monto|naturaleza|referencia), 32 hex. La referencia distingue movimientos idénticos del mismo día.';
