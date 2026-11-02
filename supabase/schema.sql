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
-- 3) Realtime: para que los cambios se vean en vivo sin recargar
-- ============================================================
alter publication supabase_realtime add table app_settings;
alter publication supabase_realtime add table orders;
