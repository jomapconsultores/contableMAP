-- El botón "Rechazar" en /admin/solicitudes ponía aprobado=false, el mismo valor
-- que ya tiene una cuenta de autoridad recién registrada. Sin un estado distinto
-- de "pendiente", la solicitud rechazada reaparecía indefinidamente en la bandeja.
alter table profiles add column if not exists rechazado_en timestamptz;
