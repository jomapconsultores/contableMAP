-- =====================================================================
-- ContableMAP · 0007 · Row Level Security
-- Todo el modelo cuelga de `entidades.user_id`: un usuario solo ve y
-- escribe filas cuya entidad le pertenece.
-- =====================================================================

-- ¿La entidad pertenece al usuario autenticado?
create or replace function public.fn_es_mi_entidad(p_entidad uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.entidades e
     where e.id = p_entidad and e.user_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------
-- Activar RLS en todas las tablas del dominio
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'entidades','plan_cuentas','terceros','categorias_gasto','mapa_clasificacion',
    'parametros_fiscales','periodos','asientos','asiento_lineas',
    'cuentas_financieras','documentos','movimientos_extracto','ia_ejecuciones',
    'compras','ventas','retenciones','roles_pago',
    'cartera','abonos','credito_tributario','declaraciones'
  ]
  loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('alter table public.%I force row level security;', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Entidades: dueño directo
-- ---------------------------------------------------------------------
drop policy if exists entidades_all on public.entidades;
create policy entidades_all on public.entidades
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- Tablas con `entidad_id` directo
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'plan_cuentas','terceros','categorias_gasto','mapa_clasificacion','periodos',
    'asientos','cuentas_financieras','documentos','movimientos_extracto',
    'compras','ventas','retenciones','roles_pago',
    'cartera','abonos','credito_tributario','declaraciones','ia_ejecuciones'
  ]
  loop
    execute format('drop policy if exists %I on public.%I;', t || '_all', t);
    execute format($p$
      create policy %I on public.%I
        for all to authenticated
        using (public.fn_es_mi_entidad(entidad_id))
        with check (public.fn_es_mi_entidad(entidad_id));
    $p$, t || '_all', t);
  end loop;
end $$;

-- `ia_ejecuciones` admite entidad_id nulo (consultas globales del usuario)
drop policy if exists ia_ejecuciones_all on public.ia_ejecuciones;
create policy ia_ejecuciones_all on public.ia_ejecuciones
  for all to authenticated
  using (entidad_id is null and created_by = auth.uid()
         or public.fn_es_mi_entidad(entidad_id))
  with check (entidad_id is null and created_by = auth.uid()
              or public.fn_es_mi_entidad(entidad_id));

-- ---------------------------------------------------------------------
-- Líneas de asiento: heredan del asiento padre
-- ---------------------------------------------------------------------
drop policy if exists asiento_lineas_all on public.asiento_lineas;
create policy asiento_lineas_all on public.asiento_lineas
  for all to authenticated
  using (exists (
    select 1 from public.asientos a
     where a.id = asiento_id and public.fn_es_mi_entidad(a.entidad_id)))
  with check (exists (
    select 1 from public.asientos a
     where a.id = asiento_id and public.fn_es_mi_entidad(a.entidad_id)));

-- ---------------------------------------------------------------------
-- Parámetros fiscales: catálogo compartido, lectura para todos,
-- escritura reservada al backend (service role).
-- ---------------------------------------------------------------------
drop policy if exists parametros_lectura on public.parametros_fiscales;
create policy parametros_lectura on public.parametros_fiscales
  for select to authenticated using (true);

-- ---------------------------------------------------------------------
-- Storage: bucket privado de documentos, un prefijo por usuario
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('documentos', 'documentos', false)
on conflict (id) do nothing;

drop policy if exists documentos_lectura on storage.objects;
create policy documentos_lectura on storage.objects
  for select to authenticated
  using (bucket_id = 'documentos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists documentos_escritura on storage.objects;
create policy documentos_escritura on storage.objects
  for insert to authenticated
  with check (bucket_id = 'documentos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists documentos_borrado on storage.objects;
create policy documentos_borrado on storage.objects
  for delete to authenticated
  using (bucket_id = 'documentos' and (storage.foldername(name))[1] = auth.uid()::text);
