-- GoTrue lee los campos de token de `auth.users` como texto plano, no como
-- texto anulable: si encuentra un NULL, la consulta revienta y la API responde
-- «Database error loading user» aunque la fila exista y sea correcta.
--
-- Al migrar por la API los usuarios se insertan a mano, y estas columnas quedan
-- nulas porque la API de origen no las expone (son secretos internos: tokens de
-- confirmación, de recuperación, de cambio de correo). El valor que GoTrue
-- espera cuando no hay ninguno en curso es la cadena vacía.
--
-- Es idempotente: solo toca lo que está en NULL.

do $$
declare
  columna text;
begin
  foreach columna in array array[
    'confirmation_token',
    'recovery_token',
    'email_change',
    'email_change_token_new',
    'email_change_token_current',
    'phone_change',
    'phone_change_token',
    'reauthentication_token'
  ]
  loop
    -- Entre versiones de GoTrue alguna de estas columnas puede no existir.
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'auth' and table_name = 'users' and column_name = columna
    ) then
      execute format('update auth.users set %I = %L where %I is null', columna, '', columna);
    end if;
  end loop;
end $$;

select email, 'listo para autenticar' as estado from auth.users;
