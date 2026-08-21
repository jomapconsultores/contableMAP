import { baseDePruebas, verificador, UID } from "./andamiaje.mjs";

/**
 * Prueba de extremo a extremo del motor contable y fiscal.
 *
 * No comprueba que el SQL "compile": comprueba que la contabilidad cuadre,
 * que las invariantes se rechacen cuando deben y que las cifras del 104 y del
 * impuesto a la renta salgan con los valores esperados.
 */

const { db, archivos } = await baseDePruebas();
const v = verificador();
const uno = async (sql) => (await db.query(sql)).rows[0];

console.log(`${archivos.length} migraciones aplicadas\n`);

// ---------------------------------------------------------------------------
console.log("1. Alta de entidad y provisión automática");

const { id: E } = await uno(`
  insert into public.entidades (user_id, ruc, razon_social, regimen)
  values ('${UID}', '1791234567001', 'MARCO ANTONIO POSLIGUA', 'GENERAL')
  returning id`);

const cuentas = await uno(`select count(*)::int n from public.plan_cuentas where entidad_id='${E}'`);
const cats = await uno(`select count(*)::int n from public.categorias_gasto where entidad_id='${E}'`);
v.comprobar("plan de cuentas sembrado", cuentas.n > 50, `(${cuentas.n})`);
v.comprobar("catálogo de categorías sembrado", cats.n > 40, `(${cats.n})`);

const jerarquia = await uno(`
  select p.codigo padre from public.plan_cuentas h
  join public.plan_cuentas p on p.id = h.padre_id
  where h.entidad_id='${E}' and h.codigo='1.1.01.02'`);
v.comprobar("jerarquía de cuentas correcta", jerarquia?.padre === "1.1.01", `(${jerarquia?.padre})`);

const alim = await uno(`
  select cuenta_id is not null ligada, rubro_personal
  from public.categorias_gasto where entidad_id='${E}' and nombre='ALIMENTACIÓN'`);
v.comprobar("categoría ligada a cuenta y a rubro personal",
  alim?.ligada && alim?.rubro_personal === "ALIMENTACION");

// Cuentas que el motor de contabilización referencia por código: si falta
// alguna, el asiento correspondiente fallaría solo en producción.
const requeridas = await uno(`
  select count(*)::int n from public.plan_cuentas
   where entidad_id='${E}' and es_movimiento
     and codigo in ('1.1.01.01','1.1.01.02','1.1.01.03','1.1.02.01','1.1.02.02',
                    '1.1.03.01','1.1.03.03','1.1.03.04','2.1.01','2.1.02','2.1.03',
                    '2.1.04.01','2.1.04.03','2.1.04.04','2.1.04.06','2.1.05',
                    '4.1.02','4.2','4.3','6.1.99','6.2.02')`);
v.comprobar("todas las cuentas que usa el motor existen y son de movimiento",
  requeridas.n === 21, `(${requeridas.n}/21)`);

// ---------------------------------------------------------------------------
console.log("\n2. Partida doble e invariantes");

const cta = async (codigo) =>
  (await uno(`select id from public.plan_cuentas where entidad_id='${E}' and codigo='${codigo}'`)).id;

const banco = await cta("1.1.01.02");
const capital = await cta("3.1");
const gasolina = await cta("6.1.05");
const ivaCompras = await cta("1.1.03.01");
const proveedores = await cta("2.1.01");

const a1 = await uno(`
  insert into public.asientos (entidad_id, fecha, glosa, origen, tipo)
  values ('${E}','2026-01-02','Aporte inicial','MANUAL','APERTURA') returning id, numero`);
await db.exec(`
  insert into public.asiento_lineas (asiento_id, orden, cuenta_id, debe, haber) values
    ('${a1.id}', 1, '${banco}',   10000, 0),
    ('${a1.id}', 2, '${capital}', 0, 10000);
  update public.asientos set estado='CONTABILIZADO' where id='${a1.id}';`);
v.comprobar("numeración correlativa por ejercicio", Number(a1.numero) === 1, `(${a1.numero})`);

await v.debeFallar(db, "rechaza asiento descuadrado", `
  do $$ declare x uuid; begin
    insert into public.asientos (entidad_id, fecha, glosa, origen)
    values ('${E}','2026-01-03','Descuadrado','MANUAL') returning id into x;
    insert into public.asiento_lineas (asiento_id, orden, cuenta_id, debe, haber)
    values (x, 1, '${banco}', 100, 0), (x, 2, '${capital}', 0, 90);
    update public.asientos set estado='CONTABILIZADO' where id=x;
  end $$;`);

await v.debeFallar(db, "rechaza línea con debe y haber a la vez", `
  insert into public.asiento_lineas (asiento_id, orden, cuenta_id, debe, haber)
  values ('${a1.id}', 9, '${banco}', 50, 50);`);

await v.debeFallar(db, "rechaza movimiento en cuenta de agrupación", `
  do $$ declare x uuid; g uuid; begin
    select id into g from public.plan_cuentas where entidad_id='${E}' and codigo='1.1';
    insert into public.asientos (entidad_id, fecha, glosa, origen)
    values ('${E}','2026-01-04','En cuenta de grupo','MANUAL') returning id into x;
    insert into public.asiento_lineas (asiento_id, orden, cuenta_id, debe, haber)
    values (x, 1, g, 10, 0);
  end $$;`);

await v.debeFallar(db, "rechaza asiento de una sola línea", `
  do $$ declare x uuid; begin
    insert into public.asientos (entidad_id, fecha, glosa, origen)
    values ('${E}','2026-01-05','Una línea','MANUAL') returning id into x;
    insert into public.asiento_lineas (asiento_id, orden, cuenta_id, debe, haber)
    values (x, 1, '${banco}', 10, 0);
    update public.asientos set estado='CONTABILIZADO' where id=x;
  end $$;`);

const a2 = await uno(`
  insert into public.asientos (entidad_id, fecha, glosa, origen, tipo)
  values ('${E}','2026-01-15','Compra combustible','COMPRA','EGRESO') returning id`);
await db.exec(`
  insert into public.asiento_lineas (asiento_id, orden, cuenta_id, debe, haber) values
    ('${a2.id}', 1, '${gasolina}',    100.00, 0),
    ('${a2.id}', 2, '${ivaCompras}',   15.00, 0),
    ('${a2.id}', 3, '${proveedores}', 0, 115.00);
  update public.asientos set estado='CONTABILIZADO' where id='${a2.id}';`);
v.comprobar("acepta asiento de compra con IVA", true);

// ---------------------------------------------------------------------------
console.log("\n3. Cierre de período");

await db.exec(`insert into public.periodos (entidad_id, anio, mes, estado)
               values ('${E}', 2026, 2, 'CERRADO')`);
await v.debeFallar(db, "rechaza registrar en período cerrado", `
  do $$ declare x uuid; begin
    insert into public.asientos (entidad_id, fecha, glosa, origen)
    values ('${E}','2026-02-10','En mes cerrado','MANUAL') returning id into x;
    insert into public.asiento_lineas (asiento_id, orden, cuenta_id, debe, haber)
    values (x, 1, '${banco}', 10, 0), (x, 2, '${capital}', 0, 10);
    update public.asientos set estado='CONTABILIZADO' where id=x;
  end $$;`);

// ---------------------------------------------------------------------------
console.log("\n4. Estados financieros");

const { r: pyg } = await uno(
  `select public.fn_estado_resultados('${E}','2026-01-01','2026-12-31') r`);
v.comprobar("P y G recoge el gasto operativo", Number(pyg.gastos_operativos) === 100,
  `(${pyg.gastos_operativos})`);
v.comprobar("resultado del ejercicio", Number(pyg.resultado_ejercicio) === -100,
  `(${pyg.resultado_ejercicio})`);

const { b: bal } = await uno(`select public.fn_balance_general('${E}','2026-12-31') b`);
v.comprobar("balance general cuadra", Math.abs(Number(bal.descuadre)) < 0.01,
  `(descuadre ${bal.descuadre})`);
v.comprobar("total activo = 10 015", Number(bal.total_activo) === 10015, `(${bal.total_activo})`);
v.comprobar("total pasivo = 115", Number(bal.total_pasivo) === 115, `(${bal.total_pasivo})`);
v.comprobar("ecuación contable",
  Number(bal.total_activo) === Number(bal.pasivo_mas_patrimonio));

// ---------------------------------------------------------------------------
console.log("\n5. Cartera y abonos");

const car = await uno(`
  insert into public.cartera (entidad_id, clase, nombre_tercero, descripcion,
    fecha_emision, fecha_vencimiento, monto_original)
  values ('${E}','CXP','PRIMAX','Compra combustible','2026-01-15','2026-02-15',115)
  returning id, saldo`);
v.comprobar("saldo inicial = monto original", Number(car.saldo) === 115);

await db.exec(`insert into public.abonos (entidad_id, cartera_id, fecha, monto)
               values ('${E}','${car.id}','2026-02-01', 50)`);
const parcial = await uno(`select saldo, estado from public.cartera where id='${car.id}'`);
v.comprobar("abono parcial recalcula saldo y estado",
  Number(parcial.saldo) === 65 && parcial.estado === "PARCIAL",
  `(${parcial.saldo}, ${parcial.estado})`);

await db.exec(`insert into public.abonos (entidad_id, cartera_id, fecha, monto)
               values ('${E}','${car.id}','2026-02-10', 65)`);
const cancelado = await uno(`select saldo, estado from public.cartera where id='${car.id}'`);
v.comprobar("cancelación total", Number(cancelado.saldo) === 0 && cancelado.estado === "CANCELADO",
  `(${cancelado.saldo}, ${cancelado.estado})`);

await v.debeFallar(db, "rechaza abono que excede el saldo", `
  insert into public.abonos (entidad_id, cartera_id, fecha, monto)
  values ('${E}','${car.id}','2026-02-20', 1)`);

// ---------------------------------------------------------------------------
console.log("\n6. Formulario 104");

await db.exec(`
  insert into public.ventas (entidad_id, fecha, secuencial, razon_social_cliente,
    base_15, iva_15, total)
  values ('${E}','2026-03-10','000000001','CLIENTE UNO', 1000, 150, 1150);

  insert into public.compras (entidad_id, fecha, secuencial, ruc_proveedor,
    nombre_proveedor, base_15, iva_15, total, da_credito_iva)
  values ('${E}','2026-03-05','000000010','1790000000001','PROVEEDOR UNO', 400, 60, 460, true);

  insert into public.compras (entidad_id, fecha, secuencial, ruc_proveedor,
    nombre_proveedor, base_15, iva_15, total, da_credito_iva)
  values ('${E}','2026-03-06','000000011','1790000000009','GASTO PERSONAL', 100, 15, 115, false);
`);

const { v: iva } = await uno(`select public.fn_calcular_iva('${E}',2026,3) v`);
v.comprobar("IVA generado en ventas = 150", Number(iva.ventas.c480_iva_generado) === 150);
v.comprobar("IVA pagado en compras = 75", Number(iva.compras.c520_iva_compras) === 75);
v.comprobar("solo 60 da derecho a crédito",
  Number(iva.compras.c521_iva_con_derecho_credito) === 60,
  "el IVA sin derecho a crédito no debe restar del impuesto causado");
v.comprobar("impuesto causado = 90", Number(iva.resumen.c601_impuesto_causado) === 90,
  `(${iva.resumen.c601_impuesto_causado})`);
v.comprobar("impuesto a pagar = 90", Number(iva.resumen.c619_impuesto_a_pagar) === 90,
  `(${iva.resumen.c619_impuesto_a_pagar})`);

await db.exec(`
  insert into public.retenciones (entidad_id, clase, fecha, ruc_contraparte,
    nombre_contraparte, base_iva, porc_iva, ret_iva)
  values ('${E}','RECIBIDA','2026-03-10','1790000000002','CLIENTE UNO', 150, 70, 105)`);

const { v: iva2 } = await uno(`select public.fn_calcular_iva('${E}',2026,3) v`);
v.comprobar("la retención de IVA recibida cancela el pago",
  Number(iva2.resumen.c619_impuesto_a_pagar) === 0, `(${iva2.resumen.c619_impuesto_a_pagar})`);
v.comprobar("y el excedente arrastra como crédito",
  Number(iva2.resumen.c609_credito_proximo_periodo) === 15,
  `(${iva2.resumen.c609_credito_proximo_periodo})`);

// ---------------------------------------------------------------------------
console.log("\n7. Gastos personales e impuesto a la renta");

const salud = await uno(
  `select id from public.categorias_gasto where entidad_id='${E}' and nombre='SALUD'`);
await db.exec(`
  insert into public.compras (entidad_id, fecha, secuencial, ruc_proveedor, nombre_proveedor,
    base_0, total, categoria_id, rubro_personal, da_credito_iva, deducible_ir)
  values ('${E}','2026-04-01','000000020','1790000000003','CLINICA', 3000, 3000,
          '${salud.id}', 'SALUD', false, false)`);

const { g: gp } = await uno(`select public.fn_gastos_personales('${E}',2026) g`);
const rubroSalud = gp.rubros.find((r) => r.rubro === "SALUD");
v.comprobar("gasto de salud acumulado", Number(rubroSalud?.gastado) === 3000);
v.comprobar("tope por rubro en canastas básicas",
  Math.abs(Number(rubroSalud?.tope) - 7 * Number(gp.canasta_basica)) < 0.01,
  `(${rubroSalud?.tope})`);
v.comprobar("la rebaja es el 18 % del deducible",
  Math.abs(Number(gp.rebaja_impuesto) - Number(gp.total_deducible) * 0.18) < 0.01,
  `(${gp.rebaja_impuesto})`);

await db.exec(`
  insert into public.roles_pago (entidad_id, anio, mes, nombre_empleador,
    sueldo, total_ingresos, decimo_tercero, decimo_cuarto,
    aporte_iess, impuesto_renta, total_descuentos, liquido_recibir)
  values ('${E}',2026,1,'EMPRESA X', 3000, 3000, 250, 470, 283.50, 100, 383.50, 2616.50)`);

const { r: renta } = await uno(`select public.fn_calcular_renta('${E}',2026) r`);
v.comprobar("los décimos quedan fuera del ingreso gravado",
  Number(renta.ingresos.relacion_dependencia) === 3000 - 250 - 470,
  `(${renta.ingresos.relacion_dependencia})`);
v.comprobar("aporte personal al IESS deducido",
  Number(renta.deducciones.aporte_iess) === 283.5);
v.comprobar("base imponible coherente",
  Math.abs(
    Number(renta.base_imponible) -
      (Number(renta.ingresos.total) -
        Number(renta.deducciones.gastos_actividad) -
        Number(renta.deducciones.aporte_iess)),
  ) < 0.01,
  `(${renta.base_imponible})`);
v.comprobar("la rebaja nunca supera el impuesto causado",
  Number(renta.rebaja_gastos_personales) <= Number(renta.impuesto_causado));
v.comprobar("retención del empleador descontada",
  Number(renta.retenciones.relacion_dependencia) === 100);
v.comprobar("resultado clasificado",
  ["IMPUESTO_A_PAGAR", "CREDITO_A_FAVOR", "SIN_SALDO"].includes(renta.resultado),
  `(${renta.resultado}, saldo ${renta.saldo})`);

// ---------------------------------------------------------------------------
console.log("\n8. Panel");

const { d: dash } = await uno(`select public.fn_dashboard('${E}',2026,3) d`);
v.comprobar("el panel devuelve todas las secciones",
  Boolean(dash.resultados && dash.iva && dash.cartera && dash.pendientes));

// ---------------------------------------------------------------------------
console.log("\n9. Facturación electrónica");

const { id: PUNTO } = await uno(`
  insert into public.puntos_emision (entidad_id, establecimiento, punto_emision, sec_factura)
  values ('${E}', '001', '001', 120)
  returning id`);

const sec1 = await uno(`select public.sri_siguiente_secuencial('${PUNTO}','FACTURA') s`);
const sec2 = await uno(`select public.sri_siguiente_secuencial('${PUNTO}','FACTURA') s`);
const reservado = await uno(`select sec_factura from public.puntos_emision where id='${PUNTO}'`);

v.comprobar("el secuencial arranca donde se dejó la numeración", Number(sec1.s) === 120, `(${sec1.s})`);
v.comprobar("y no se repite en la siguiente factura", Number(sec2.s) === 121, `(${sec2.s})`);
v.comprobar("cada entrega deja reservado el próximo número",
  Number(reservado.sec_factura) === 122, `(${reservado.sec_factura})`);

// Pedir un secuencial de un punto que no existe no puede devolver uno válido.
let secuencialFantasma = false;
try {
  await uno(`select public.sri_siguiente_secuencial('00000000-0000-0000-0000-000000000000','FACTURA') s`);
} catch {
  secuencialFantasma = true;
}
v.comprobar("un punto de emisión inexistente no entrega numeración", secuencialFantasma);

let tipoDesconocido = false;
try {
  await uno(`select public.sri_siguiente_secuencial('${PUNTO}','GUIA') s`);
} catch {
  tipoDesconocido = true;
}
v.comprobar("solo hay secuencial para los comprobantes previstos", tipoDesconocido);

// La clave de acceso identifica el comprobante: no puede haber dos iguales.
const CLAVE = "2108202601179123456700110010010000001201234567819";
await db.exec(`
  insert into public.ventas (entidad_id, fecha, establecimiento, punto_emision, secuencial,
    clave_acceso, razon_social_cliente, id_cliente, base_15, iva_15, total, sri_estado, sri_ambiente)
  values ('${E}','2026-08-21','001','001','000000120','${CLAVE}','COMERCIAL ANDINA S.A.',
          '1791234567001', 100, 15, 115, 'FIRMADA', 1)`);

let claveRepetida = false;
try {
  await db.exec(`
    insert into public.ventas (entidad_id, fecha, establecimiento, punto_emision, secuencial,
      clave_acceso, razon_social_cliente, id_cliente, total)
    values ('${E}','2026-08-21','001','002','000000999','${CLAVE}','OTRO CLIENTE','1791234567001', 50)`);
} catch {
  claveRepetida = true;
}
v.comprobar("la clave de acceso no se puede repetir", claveRepetida);

const { id: VENTA } = await uno(
  `select id from public.ventas where clave_acceso='${CLAVE}'`);

await db.exec(`
  insert into public.venta_items (venta_id, orden, codigo_principal, descripcion,
    cantidad, precio_unitario, tarifa, base, iva)
  values ('${VENTA}', 1, 'SERV-01', 'Asesoría', 1, 100, '15', 100, 15)`);

let tarifaInventada = false;
try {
  await db.exec(`
    insert into public.venta_items (venta_id, orden, codigo_principal, descripcion,
      cantidad, precio_unitario, tarifa, base, iva)
    values ('${VENTA}', 2, 'SERV-02', 'Otro', 1, 100, '12', 100, 12)`);
} catch {
  tarifaInventada = true;
}
v.comprobar("solo se admiten las tarifas de IVA vigentes", tarifaInventada);

let estadoInventado = false;
try {
  await db.exec(`update public.ventas set sri_estado='ENVIADA' where id='${VENTA}'`);
} catch {
  estadoInventado = true;
}
v.comprobar("el estado ante el SRI no admite valores fuera del catálogo", estadoInventado);

// La factura emitida es una venta más: entra en el libro de ventas y en el 104
// sin que el módulo de IVA sepa nada de firmas ni de claves de acceso.
const resumenAgosto = await uno(
  `select * from public.fn_resumen_ventas('${E}','2026-08-01','2026-08-31')`);
v.comprobar("la factura electrónica entra en el libro de ventas",
  Number(resumenAgosto.base_gravada) === 100 && Number(resumenAgosto.iva_generado) === 15,
  `(base ${resumenAgosto.base_gravada}, IVA ${resumenAgosto.iva_generado})`);

process.exit(v.resumen() > 0 ? 1 : 0);
