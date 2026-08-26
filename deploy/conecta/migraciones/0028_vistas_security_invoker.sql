-- Las 5 vistas de indicadores corrían con SECURITY DEFINER implícito (el
-- comportamiento por defecto de Postgres cuando no se especifica
-- security_invoker), bypaseando el RLS de profiles/postulaciones/servicios/
-- competencias_graduado. Como además tienen SELECT otorgado a anon y
-- authenticated (grant por defecto de Supabase sobre vistas en public),
-- cualquiera sin sesión podía leerlas directo vía PostgREST
-- (GET /rest/v1/v_indicadores_globales, etc.) sin pasar por /admin.
--
-- Con security_invoker=true, la vista corre con los privilegios del rol que
-- consulta: el staff (admin/autoridad) sigue viendo los mismos agregados de
-- siempre porque is_staff() ya está permitido en el RLS de cada tabla
-- subyacente; cualquier otro rol o anon solo ve lo que esas políticas le
-- permitirían ver directamente (en la práctica, nada -> agregados en cero).
alter view v_indicadores_globales set (security_invoker = true);
alter view v_empleabilidad_carrera set (security_invoker = true);
alter view v_brechas_competencias set (security_invoker = true);
alter view v_servicio_ejecucion set (security_invoker = true);
alter view v_postulaciones_por_estado set (security_invoker = true);
