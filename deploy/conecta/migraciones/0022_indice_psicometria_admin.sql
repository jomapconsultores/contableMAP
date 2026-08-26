-- idx_psico_profile(profile_id, created_at desc) sirve para "mis resultados"
-- (filtrado por profile_id), pero el listado de staff ordena por created_at
-- global sin filtrar por persona: se agrega un índice que cubra ese patrón,
-- priorizando además los casos con alerta.
create index if not exists idx_psico_alerta_created on psicometria_resultados(alerta desc, created_at desc);
