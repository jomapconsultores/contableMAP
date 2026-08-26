-- Agrega 'profesional' al enum rol_usuario, en su propio archivo/transacción.
-- Postgres no permite usar un valor de enum recién agregado por ALTER TYPE ...
-- ADD VALUE dentro de la misma transacción que lo agregó, así que este paso no
-- puede ir junto con el UPDATE/función de 0005_niveles.sql que lo consumen.
-- Antes esto se ejecutaba a mano fuera del repo; sin este archivo, aplicar las
-- migraciones en orden (0001 -> 0011) en una base nueva fallaba en 0005.
alter type rol_usuario add value if not exists 'profesional';
