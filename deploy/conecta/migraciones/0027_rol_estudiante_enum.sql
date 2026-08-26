-- El valor 'estudiante' del enum rol_usuario ya estaba aplicado directamente
-- en producción (fuera de cualquier migración versionada) — handle_new_user()
-- ya lo castea correctamente y hay cuentas reales usándolo. Esta migración
-- solo documenta ese estado en el repo (idempotente, no repara datos).
alter type rol_usuario add value if not exists 'estudiante';
