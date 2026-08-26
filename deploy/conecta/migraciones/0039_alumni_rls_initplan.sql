-- ============================================================
-- 0039 — Rendimiento RLS del módulo Alumni (InitPlan).
--
-- Las políticas de 0036 escribían `(select is_staff()) and has_modulo('alumni')`:
-- is_staff() quedaba envuelto (se evalúa una vez por consulta) pero
-- has_modulo() NO, así que Postgres lo ejecutaba POR FILA — ~3.5k llamadas
-- (cada una consulta permisos_modulo) al listar alumni y ~5k al agregar
-- títulos, ≈700 ms por barrido. Es el mismo problema corregido en 0018/0026:
-- se envuelven ambas funciones en (select ...) para que el planificador las
-- convierta en InitPlan (una sola evaluación por consulta).
-- ============================================================

drop policy if exists alumni_staff_all on alumni;
create policy alumni_staff_all on alumni for all
  using ((select is_staff()) and (select has_modulo('alumni')))
  with check ((select is_staff()) and (select has_modulo('alumni')));

drop policy if exists alumni_titulos_staff_all on alumni_titulos;
create policy alumni_titulos_staff_all on alumni_titulos for all
  using ((select is_staff()) and (select has_modulo('alumni')))
  with check ((select is_staff()) and (select has_modulo('alumni')));

drop policy if exists titulos_mapeo_staff_all on titulos_mapeo;
create policy titulos_mapeo_staff_all on titulos_mapeo for all
  using ((select is_staff()) and (select has_modulo('alumni')))
  with check ((select is_staff()) and (select has_modulo('alumni')));

drop policy if exists alumni_act_staff_all on alumni_actualizaciones;
create policy alumni_act_staff_all on alumni_actualizaciones for all
  using ((select is_staff()) and (select has_modulo('alumni')))
  with check ((select is_staff()) and (select has_modulo('alumni')));
