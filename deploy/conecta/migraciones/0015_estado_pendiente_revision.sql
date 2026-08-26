-- Nuevo estado intermedio para el flujo de revisión de cursos internos: antes
-- el propio graduado se auto-aprobaba un curso y el sistema emitía el aval
-- institucional sin que ningún staff lo revisara. Se separa en dos pasos
-- (ver 0016_revisar_curso_rpc.sql): el graduado marca el curso como
-- completado ("pendiente_revision") y solo el staff puede aprobar o
-- rechazar. Va en su propia migración porque un nuevo valor de enum debe
-- confirmarse antes de poder usarse en otra transacción.
alter type estado_curso add value if not exists 'pendiente_revision';
