-- Fufa Food — esquema de base de datos (Supabase / Postgres)
-- Correr una sola vez en: Supabase Dashboard → SQL Editor → New query → Run
--
-- El panel (admin.html) NO tiene login: cualquiera con la URL /administracion
-- puede editar. Por eso acá se le da a "anon" (el rol público, el mismo que
-- usa la web) permiso para leer Y escribir. La única protección real es que
-- la URL no es obvia — no hay nada del lado de la base que la proteja.

-- ============================================================
-- 1) app_settings: una sola fila con todo lo que hoy se guarda
--    en localStorage del panel (precios, promos, zonas, horarios,
--    fotos, etc). El sitio público la lee; el panel la escribe.
-- ============================================================
create table if not exists app_settings (
  id text primary key default 'main',
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

insert into app_settings (id, data)
values ('main', '{}'::jsonb)
on conflict (id) do nothing;

alter table app_settings enable row level security;

drop policy if exists "public puede leer settings" on app_settings;
create policy "public puede leer settings" on app_settings
  for select using (true);

drop policy if exists "solo admin logueado escribe settings" on app_settings;
drop policy if exists "public puede escribir settings" on app_settings;
create policy "public puede escribir settings" on app_settings
  for update using (true);

drop policy if exists "solo admin logueado inserta settings" on app_settings;
drop policy if exists "public puede insertar settings" on app_settings;
create policy "public puede insertar settings" on app_settings
  for insert with check (true);

-- ============================================================
-- 2) orders: pedidos reales hechos desde la web (checkout).
--    Cualquiera puede crear un pedido (son los clientes) y, como el
--    panel tampoco tiene login, cualquiera puede leerlos y cambiarles
--    el estado (es el mismo rol público el que usa el panel).
-- ============================================================
create table if not exists orders (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  customer_name text not null,
  phone text,
  tipo text not null, -- 'retiro' | 'delivery' | 'local'
  address text,
  zone text,
  payment text,
  items jsonb not null default '[]'::jsonb,
  total numeric not null default 0,
  status text not null default 'nuevos' -- nuevos | cocina | listos | camino | entregado
);

alter table orders enable row level security;

drop policy if exists "cualquiera puede crear un pedido" on orders;
create policy "cualquiera puede crear un pedido" on orders
  for insert with check (true);

drop policy if exists "solo admin logueado lee pedidos" on orders;
drop policy if exists "public puede leer pedidos" on orders;
create policy "public puede leer pedidos" on orders
  for select using (true);

drop policy if exists "solo admin logueado actualiza pedidos" on orders;
drop policy if exists "public puede actualizar pedidos" on orders;
create policy "public puede actualizar pedidos" on orders
  for update using (true);

drop policy if exists "public puede borrar pedidos" on orders;
create policy "public puede borrar pedidos" on orders
  for delete using (true);

-- ============================================================
-- 2.1) Numero de pedido del dia: el que se muestra en el mensaje de
--      WhatsApp ("Pedido: #3"). Se calcula en el servidor (no en el
--      celular del cliente) para que sea el mismo contador para TODOS
--      los pedidos del local, y se reinicia solo porque esta atado a
--      la fecha (huso horario de Cordoba).
-- ============================================================
create table if not exists daily_order_seq (
  day date primary key,
  seq integer not null default 0
);

-- RLS activada y sin ninguna policy: nadie puede tocar esta tabla
-- directamente desde la web ni el panel. Solo puede escribir ahí la
-- función de abajo, que corre como "security definer" (con los
-- permisos de quien la creó, no los del rol público) para poder
-- saltarse esa restricción.
alter table daily_order_seq enable row level security;

create or replace function next_daily_order_seq() returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  today date := (now() at time zone 'America/Argentina/Cordoba')::date;
  n integer;
begin
  insert into daily_order_seq (day, seq) values (today, 1)
    on conflict (day) do update set seq = daily_order_seq.seq + 1
    returning seq into n;
  return n;
end;
$$;

alter table orders add column if not exists daily_seq integer;

create or replace function set_order_daily_seq() returns trigger as $$
begin
  new.daily_seq := next_daily_order_seq();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_set_order_daily_seq on orders;
create trigger trg_set_order_daily_seq
  before insert on orders
  for each row execute function set_order_daily_seq();

-- ============================================================
-- 3) Realtime: para que los cambios se vean en vivo sin recargar
--    (a prueba de repetición: si ya estaban agregadas, no falla)
-- ============================================================
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'app_settings'
  ) then
    alter publication supabase_realtime add table app_settings;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'orders'
  ) then
    alter publication supabase_realtime add table orders;
  end if;
end $$;
