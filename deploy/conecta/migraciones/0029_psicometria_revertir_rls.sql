-- Revierte una política aplicada directamente en producción (fuera de
-- cualquier migración versionada) que había reemplazado el diseño original
-- de 0009_psicometria.sql (psico_owner_read + psico_owner_insert) por un
-- único "psico_owner FOR ALL", permitiendo que el propio graduado editara o
-- borrara su resultado psicométrico ya rendido — incluida la alerta de
-- riesgo psicosocial. Se restaura el diseño original documentado en 0009:
-- solo lectura y creación por el dueño, nunca edición ni borrado.
drop policy if exists psico_owner on psicometria_resultados;
drop policy if exists psico_owner_read on psicometria_resultados;
drop policy if exists psico_owner_insert on psicometria_resultados;

create policy psico_owner_read on psicometria_resultados for select
  using (profile_id = auth.uid());
create policy psico_owner_insert on psicometria_resultados for insert
  with check (profile_id = auth.uid());
