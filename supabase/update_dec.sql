-- شغّل هذا الملف مرة واحدة في Supabase → SQL Editor

-- 1) إيقاف العامل بدل حذفه
alter table public.workers add column if not exists active boolean not null default true;
alter table public.workers add column if not exists stopped_at date; -- أول يوم لا يُحسب فيه راتب

-- 2) جدول التالف والمسروق + جدول ملاحظات العمال
-- (نقرأ نوع عمود id الحالي حتى يتطابق مع uuid أو bigint عندك)
do $$
declare pid text; wid text;
begin
  select format_type(a.atttypid, a.atttypmod) into pid
    from pg_attribute a where a.attrelid = 'public.products'::regclass and a.attname = 'id';
  select format_type(a.atttypid, a.atttypmod) into wid
    from pg_attribute a where a.attrelid = 'public.workers'::regclass and a.attname = 'id';

  execute format($f$
    create table if not exists public.product_losses (
      id bigint generated always as identity primary key,
      product_id %s references public.products(id) on delete set null,
      product_name text not null,
      qty numeric not null check (qty > 0),
      reason text not null check (reason in ('damaged','stolen','expired')),
      unit_cost numeric not null default 0,
      loss numeric generated always as (qty * unit_cost) stored,
      note text,
      day date not null default current_date,
      created_at timestamptz not null default now()
    )$f$, pid);

  execute format($f$
    create table if not exists public.worker_notes (
      id bigint generated always as identity primary key,
      worker_id %s not null references public.workers(id) on delete cascade,
      note text not null,
      day date not null default current_date,
      created_at timestamptz not null default now()
    )$f$, wid);
end $$;

-- 3) الصلاحيات: للمدير فقط
alter table public.product_losses enable row level security;
alter table public.worker_notes enable row level security;

drop policy if exists admin_all on public.product_losses;
create policy admin_all on public.product_losses for all to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'))
  with check (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

drop policy if exists admin_all on public.worker_notes;
create policy admin_all on public.worker_notes for all to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'))
  with check (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

-- 4) تسجيل تالف/مسروق: يخصم المخزون ويسجّل الخسارة بتكلفة اللحظة
create or replace function public.record_loss(payload jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  p public.products%rowtype;
  q numeric := (payload->>'qty')::numeric;
  r text := payload->>'reason';
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    raise exception 'غير مصرّح';
  end if;
  if q is null or q <= 0 then raise exception 'الكمية غير صحيحة'; end if;
  if r not in ('damaged','stolen','expired') then raise exception 'السبب غير صحيح'; end if;

  select * into p from public.products where id::text = payload->>'product_id' for update;
  if not found then raise exception 'المنتج غير موجود'; end if;
  if q > coalesce(p.stock, 0) then
    raise exception 'الكمية أكبر من المخزون الحالي (%)', coalesce(p.stock, 0);
  end if;

  update public.products set stock = stock - q where id = p.id;
  insert into public.product_losses (product_id, product_name, qty, reason, unit_cost, note, day)
  values (p.id, p.name, q, r, coalesce(p.cost, 0), nullif(payload->>'note', ''),
          coalesce((payload->>'day')::date, current_date));

  return jsonb_build_object('loss', q * coalesce(p.cost, 0));
end $$;

grant execute on function public.record_loss(jsonb) to authenticated;
