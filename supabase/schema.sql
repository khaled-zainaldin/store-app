-- شغّل هذا الملف كاملاً في Supabase > SQL Editor

create table profiles (
  id uuid primary key references auth.users on delete cascade,
  name text not null,
  role text not null default 'seller' check (role in ('admin','seller'))
);

create table products (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  name text not null,
  price numeric not null,
  cost numeric not null default 0,
  stock numeric not null default 0
);

create table customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text
);

create table sales (
  id uuid primary key,                      -- رقم الفاتورة يتولد على الجهاز لمنع التكرار
  seller_id uuid not null references profiles(id),
  customer_id uuid references customers(id),
  payment_method text not null default 'cash',  -- cash | jawwal_pay | bank_of_palestine | palpay
  total numeric not null,
  created_at timestamptz not null default now()
);

create table sale_items (
  id bigserial primary key,
  sale_id uuid not null references sales(id) on delete cascade,
  product_id uuid not null references products(id),
  qty numeric not null,
  price numeric not null
);

create or replace function is_admin() returns boolean
language sql security definer stable as
$$ select exists (select 1 from profiles where id = auth.uid() and role = 'admin') $$;

-- البائع يشوف المنتجات بدون سعر التكلفة
create view products_seller as select id, code, name, price, stock from products;
grant select on products_seller to authenticated;

alter table profiles   enable row level security;
alter table products   enable row level security;
alter table customers  enable row level security;
alter table sales      enable row level security;
alter table sale_items enable row level security;

create policy "own profile" on profiles   for select using (id = auth.uid() or is_admin());
create policy "admin all"   on profiles   for all    using (is_admin()) with check (is_admin());
create policy "admin all"   on products   for all    using (is_admin()) with check (is_admin());
create policy "admin all"   on customers  for all    using (is_admin()) with check (is_admin());
create policy "admin all"   on sales      for all    using (is_admin()) with check (is_admin());
create policy "admin all"   on sale_items for all    using (is_admin()) with check (is_admin());

-- تسجيل بيع: آمن ولا يتكرر لو انرسل مرتين
create or replace function submit_sale(payload jsonb) returns void
language plpgsql security definer as $$
declare
  v_cust uuid; v_new int; it jsonb;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;

  if coalesce(payload->>'customer_name','') <> '' then
    insert into customers(name, phone)
    values (payload->>'customer_name', payload->>'customer_phone')
    returning id into v_cust;
  end if;

  insert into sales(id, seller_id, customer_id, payment_method, total)
  values ((payload->>'id')::uuid, auth.uid(), v_cust,
          coalesce(payload->>'payment_method','cash'), (payload->>'total')::numeric)
  on conflict (id) do nothing;
  get diagnostics v_new = row_count;
  if v_new = 0 then return; end if;

  for it in select * from jsonb_array_elements(payload->'items') loop
    insert into sale_items(sale_id, product_id, qty, price)
    values ((payload->>'id')::uuid, (it->>'product_id')::uuid,
            (it->>'qty')::numeric, (it->>'price')::numeric);
    update products set stock = stock - (it->>'qty')::numeric
    where id = (it->>'product_id')::uuid;
  end loop;
end $$;
grant execute on function submit_sale(jsonb) to authenticated;

-- بعد إنشاء مستخدمك الأول من Authentication، اجعله مديراً:
-- insert into profiles(id, name, role) values ('USER-UUID', 'خالد', 'admin');

-- صلاحيات الوصول (الحماية الفعلية تبقى بسياسات RLS أعلاه)
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
