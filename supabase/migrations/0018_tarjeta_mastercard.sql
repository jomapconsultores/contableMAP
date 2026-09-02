-- ---------------------------------------------------------------------
-- La tarjeta de Produbanco no es una Visa
--
-- La cuenta se dio de alta como «TC Visa Produbanco» y ese nombre se arrastró a
-- su cuenta contable al separar las tarjetas. Pero el extracto declara el número
-- 522409XXXXXX6835, y un número que empieza por 5 es Mastercard: las Visa
-- empiezan por 4. El saldo, los movimientos y los cortes son los correctos —lo
-- único equivocado era la marca—, así que basta con llamarla por su nombre.
-- ---------------------------------------------------------------------
update public.cuentas_financieras
   set nombre = 'TC Mastercard Produbanco'
 where nombre = 'TC Visa Produbanco';

-- La cuenta contable de esa tarjeta, sin tocar el código: se localiza por el
-- vínculo con la cuenta financiera, no por el número que le tocó en el plan.
update public.plan_cuentas p
   set nombre = 'Mastercard Produbanco'
  from public.cuentas_financieras cf
 where cf.cuenta_id = p.id
   and cf.nombre = 'TC Mastercard Produbanco'
   and p.nombre = 'Visa Produbanco';
