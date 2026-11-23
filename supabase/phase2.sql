-- شغّل هذا الملف في SQL Editor (جداول المصاريف والعمال)
create table expenses (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('purchase','expense')),   -- مشتريات | مصروف
  place text not null check (place in ('shop','home')),        -- المحل | البيت
  who text not null,
  reason text not null,
  amount numeric not null,
  day date not null default current_date
);
create table workers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  weekly_salary numeric not null default 0
);
create table attendance (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references workers(id) on delete cascade,
  day date not null,
  status text not null check (status in ('present','absent')),
  unique (worker_id, day)
);
create table advances (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references workers(id) on delete cascade,
  day date not null default current_date,
  amount numeric not null
);
alter table expenses   enable row level security;
alter table workers    enable row level security;
alter table attendance enable row level security;
alter table advances   enable row level security;
create policy "admin all" on expenses   for all using (is_admin()) with check (is_admin());
create policy "admin all" on workers    for all using (is_admin()) with check (is_admin());
create policy "admin all" on attendance for all using (is_admin()) with check (is_admin());
create policy "admin all" on advances   for all using (is_admin()) with check (is_admin());
grant select, insert, update, delete on all tables in schema public to authenticated;
