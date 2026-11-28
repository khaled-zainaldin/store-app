-- =====================================================================
-- برنامج المتجر: ملف SQL واحد (يجمع schema + fix_customers + phase2..6 + update_nov25 + تحديث 27 نوفمبر)
-- شغّله كاملاً في Supabase > SQL Editor.
-- آمن للتشغيل أكثر من مرة، وآمن على قاعدة فيها بيانات (لا يحذف ولا يغيّر أي بيانات).
-- الترتيب: 1 الجداول  2 الدوال  3 العروض  4 الحماية RLS  5 الصلاحيات  6 تخزين الصور
-- =====================================================================

---------------------------------------------------------------
-- 1) الجداول
---------------------------------------------------------------
create table if not exists profiles (
  id uuid primary key references auth.users on delete cascade,
  name text not null,
  role text not null default 'seller' check (role in ('admin','seller'))
);

-- صلاحية المدير (تُعرَّف هنا لأن سياسات الحماية تستخدمها)
create or replace function is_admin() returns boolean
language sql security definer stable
set search_path = public as
$$ select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') $$;

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  name text not null,
  price numeric not null,
  cost numeric not null default 0,
  stock numeric not null default 0,
  pack_size numeric not null default 12
);
alter table products add column if not exists pack_size numeric not null default 12;
alter table products add column if not exists archived boolean not null default false; -- منتج مخفي بدل الحذف النهائي

create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text
);

create table if not exists sales (
  id uuid primary key,                        -- رقم الفاتورة يتولد على الجهاز لمنع التكرار
  seller_id uuid not null references profiles(id),
  customer_id uuid references customers(id),
  payment_method text not null default 'cash', -- cash | jawwal_pay | bank_of_palestine | palpay
  total numeric not null,
  created_at timestamptz not null default now()
);

create table if not exists sale_items (
  id bigserial primary key,
  sale_id uuid not null references sales(id) on delete cascade,
  product_id uuid not null references products(id),
  qty numeric not null,
  price numeric not null
);

-- المصاريف
create table if not exists expenses (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('purchase','expense')),   -- مشتريات | مصروف
  place text not null check (place in ('shop','home')),        -- المحل | البيت
  who text not null,
  reason text not null,
  amount numeric not null,
  day date not null default current_date
);

-- العمال
create table if not exists workers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  weekly_salary numeric not null default 0
);
create table if not exists attendance (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references workers(id) on delete cascade,
  day date not null,
  status text not null check (status in ('present','absent')),
  unique (worker_id, day)
);
create table if not exists advances (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references workers(id) on delete cascade,
  day date not null default current_date,
  amount numeric not null
);
create table if not exists worker_bonuses (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references workers(id) on delete cascade,
  amount numeric not null check (amount > 0),
  day date not null,
  created_at timestamptz default now()
);

-- فواتير التجار
create sequence if not exists product_code_seq;

create table if not exists supplier_invoices (
  id uuid primary key default gen_random_uuid(),
  company text not null,
  day date not null default current_date,
  total numeric not null default 0
);
alter table supplier_invoices add column if not exists supplier_phone text;
alter table supplier_invoices add column if not exists subtotal numeric not null default 0;
alter table supplier_invoices add column if not exists discount numeric not null default 0;

create table if not exists supplier_invoice_items (
  id bigserial primary key,
  invoice_id uuid not null references supplier_invoices(id) on delete cascade,
  product_id uuid references products(id),
  product_name text not null,
  qty numeric not null,
  buy_price numeric not null,
  sell_price numeric not null
);
alter table supplier_invoice_items add column if not exists old_buy_price numeric;
alter table supplier_invoice_items add column if not exists old_sell_price numeric;

create table if not exists supplier_payment_images (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references supplier_invoices(id) on delete cascade,
  image_url text not null,                    -- مسار الملف داخل التخزين
  created_at timestamptz default now()
);

-- المرتجعات
create table if not exists sale_returns (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references sales(id),
  note text,
  total numeric not null default 0,
  created_at timestamptz not null default now()
);
create table if not exists sale_return_items (
  id bigserial primary key,
  return_id uuid not null references sale_returns(id) on delete cascade,
  product_id uuid not null references products(id),
  qty numeric not null,
  price numeric not null
);


---------------------------------------------------------------
-- أعمدة وجداول التحديث الأخير (آمنة على القاعدة الحالية)
---------------------------------------------------------------
-- العمال: رقم الهاتف + إيقاف بدل الحذف + تاريخ البدء
alter table workers add column if not exists phone text;
alter table workers add column if not exists active boolean not null default true;
alter table workers add column if not exists stopped_at date;
alter table workers add column if not exists started_on date;

-- ملاحظات العمال
create table if not exists worker_notes (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references workers(id) on delete cascade,
  note text not null,
  day date not null default current_date,
  created_at timestamptz not null default now()
);

-- رواتب الأسابيع المغلقة (المستحق هو الذي يُخصم من الأرباح)
create table if not exists worker_payroll (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references workers(id) on delete cascade,
  week_start date not null,
  week_end date not null,
  weekly_salary numeric not null,
  present_days int not null default 0,
  absent_days int not null default 0,
  absence_deduction numeric not null default 0,
  bonus numeric not null default 0,
  earned numeric not null,       -- المستحق = الراتب - خصم الغياب + البونص
  advances numeric not null default 0,
  net_pay numeric not null,      -- صافي التسليم = المستحق - السلف
  closed_at timestamptz not null default now(),
  unique (worker_id, week_start)
);

-- متوسط التكلفة بعد كل فاتورة تاجر
alter table supplier_invoice_items add column if not exists avg_cost_after numeric;

-- ربط سجل المصروف (مشتريات) بفاتورة التاجر حتى يتحدّث مع الخصم
alter table expenses add column if not exists invoice_id uuid references supplier_invoices(id) on delete cascade;

-- تثبيت تكلفة القطعة وقت البيع والمرتجع (حتى لا تتغير الأرباح القديمة)
alter table sale_items       add column if not exists cost numeric;
alter table sale_return_items add column if not exists cost numeric;

-- التالف والمسروق
create table if not exists product_losses (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id),
  qty numeric not null check (qty > 0),
  reason text not null check (reason in ('damaged','stolen','expired','other')),
  cost numeric not null default 0,      -- تكلفة القطعة وقت التسجيل
  note text,
  day date not null default current_date,
  created_at timestamptz not null default now()
);

-- تعبئة البيانات القديمة (آمنة للتكرار): الفواتير القديمة تأخذ تكلفة المنتج الحالية كأفضل تقدير
update sale_items si set cost = p.cost from products p where p.id = si.product_id and si.cost is null;
update sale_return_items ri set cost = p.cost from products p where p.id = ri.product_id and ri.cost is null;

-- ربط مصاريف فواتير التجار القديمة بفواتيرها (فقط عندما يكون التطابق واضحاً) ومزامنة مبالغ الخصم
update expenses e set invoice_id = s.id
from supplier_invoices s
where e.invoice_id is null and e.kind = 'purchase' and e.reason = 'فاتورة تاجر'
  and e.who = s.company and e.day = s.day
  and (select count(*) from supplier_invoices s2 where s2.company = e.who and s2.day = e.day) = 1
  and (select count(*) from expenses e2 where e2.kind = 'purchase' and e2.reason = 'فاتورة تاجر' and e2.who = e.who and e2.day = e.day) = 1;
update expenses e set amount = s.total from supplier_invoices s where e.invoice_id = s.id and e.amount <> s.total;

---------------------------------------------------------------
-- 2) الدوال
---------------------------------------------------------------

-- تسجيل بيع: لا يتكرر لو انرسل مرتين، ويسجّل الزبون حتى لو أُدخل الرقم فقط، ويثبّت تكلفة القطعة وقت البيع
create or replace function submit_sale(payload jsonb) returns void
language plpgsql security definer
set search_path = public as $$
declare
  v_cust uuid; v_new int; it jsonb;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;

  if coalesce(payload->>'customer_name','') <> '' or coalesce(payload->>'customer_phone','') <> '' then
    insert into customers(name, phone)
    values (coalesce(nullif(payload->>'customer_name',''), 'بدون اسم'), nullif(payload->>'customer_phone',''))
    returning id into v_cust;
  end if;

  insert into sales(id, seller_id, customer_id, payment_method, total)
  values ((payload->>'id')::uuid, auth.uid(), v_cust,
          coalesce(payload->>'payment_method','cash'), (payload->>'total')::numeric)
  on conflict (id) do nothing;
  get diagnostics v_new = row_count;
  if v_new = 0 then return; end if;

  for it in select * from jsonb_array_elements(payload->'items') loop
    insert into sale_items(sale_id, product_id, qty, price, cost)
    values ((payload->>'id')::uuid, (it->>'product_id')::uuid,
            (it->>'qty')::numeric, (it->>'price')::numeric,
            (select cost from products where id = (it->>'product_id')::uuid));
    update products set stock = stock - (it->>'qty')::numeric
    where id = (it->>'product_id')::uuid;
  end loop;
end $$;

-- حفظ فاتورة تاجر: المتوسط المرجّح للتكلفة + توزيع الخصم على الأصناف + ربط المصروف بالفاتورة
-- (تغيّر نوع الإرجاع إلى jsonb، لذلك نحذف النسخة القديمة أولاً)
drop function if exists add_supplier_invoice(jsonb);
create function add_supplier_invoice(payload jsonb) returns jsonb
language plpgsql security definer
set search_path = public as $$
declare
  inv uuid; it jsonb; pid uuid; v_name text; v_code text; v_day date;
  v_qty numeric; v_line numeric; v_unit numeric; v_net numeric;
  v_sub numeric; v_disc numeric; v_factor numeric; v_total numeric;
  o_cost numeric; o_price numeric; o_stock numeric; v_new numeric;
begin
  if not is_admin() then raise exception 'admin only'; end if;
  v_day := coalesce(nullif(payload->>'day','')::date, current_date);

  select coalesce(sum(coalesce((e->>'line_total')::numeric, (e->>'qty')::numeric * (e->>'buy_price')::numeric)), 0)
    into v_sub from jsonb_array_elements(payload->'items') e;
  v_sub  := round(v_sub, 2);
  v_disc := coalesce(nullif(payload->>'discount','')::numeric, 0);
  if v_disc < 0 or v_disc > v_sub then raise exception 'الخصم يجب أن يكون بين 0 وإجمالي الفاتورة'; end if;
  v_factor := case when v_sub > 0 then (v_sub - v_disc) / v_sub else 1 end;
  v_total  := v_sub - v_disc;

  insert into supplier_invoices(company, day, total, subtotal, discount, supplier_phone)
  values (trim(payload->>'company'), v_day, v_total, v_sub, v_disc, nullif(trim(coalesce(payload->>'phone','')), ''))
  returning id into inv;

  for it in select * from jsonb_array_elements(payload->'items') loop
    v_name := trim(it->>'name');
    v_qty  := (it->>'qty')::numeric;
    if v_qty is null or v_qty <= 0 then raise exception 'الكمية يجب أن تكون أكبر من صفر'; end if;
    v_line := coalesce((it->>'line_total')::numeric, v_qty * (it->>'buy_price')::numeric);
    v_unit := v_line / v_qty;          -- سعر الشراء للقطعة حسب الفاتورة
    v_net  := v_unit * v_factor;       -- بعد توزيع الخصم

    pid := null; o_cost := null; o_price := null; o_stock := null;
    select id, cost, price, stock into pid, o_cost, o_price, o_stock from products
      where name = v_name or (nullif(trim(it->>'code'),'') is not null and code = trim(it->>'code'))
      limit 1 for update;

    if pid is null then
      v_code := coalesce(nullif(trim(it->>'code'),''), 'P' || nextval('product_code_seq'));
      v_new := round(v_net, 4);
      insert into products(code, name, price, cost, stock)
      values (v_code, v_name, (it->>'sell_price')::numeric, v_new, v_qty)
      returning id into pid;
    else
      -- المتوسط المرجّح: (المخزون الحالي × التكلفة الحالية + الكمية الجديدة × سعرها) ÷ المجموع
      v_new := round((greatest(o_stock, 0) * o_cost + v_qty * v_net) / (greatest(o_stock, 0) + v_qty), 4);
      update products set stock = stock + v_qty, cost = v_new, price = (it->>'sell_price')::numeric, archived = false
      where id = pid;
    end if;

    insert into supplier_invoice_items(invoice_id, product_id, product_name, qty, buy_price, sell_price, old_buy_price, old_sell_price, avg_cost_after)
    values (inv, pid, v_name, v_qty, v_unit, (it->>'sell_price')::numeric, o_cost, o_price, v_new);
  end loop;

  insert into expenses(kind, place, who, reason, amount, day, invoice_id)
  values ('purchase', 'shop', trim(payload->>'company'), 'فاتورة تاجر', v_total, v_day, inv);

  return jsonb_build_object('id', inv, 'total', v_total, 'subtotal', v_sub, 'discount', v_disc);
end $$;

-- إضافة كمية لمنتج موجود بسعر شراء جديد (متوسط مرجّح للتكلفة)
create or replace function add_stock(p_product uuid, p_qty numeric, p_buy numeric, p_sell numeric default null)
returns jsonb
language plpgsql security definer
set search_path = public as $$
declare v_stock numeric; v_cost numeric; v_new numeric;
begin
  if not is_admin() then raise exception 'غير مسموح'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'الكمية يجب أن تكون أكبر من صفر'; end if;
  if p_buy is null or p_buy < 0 then raise exception 'سعر الشراء غير صحيح'; end if;
  select stock, cost into v_stock, v_cost from products where id = p_product for update;
  if not found then raise exception 'المنتج غير موجود'; end if;
  v_new := round((greatest(v_stock, 0) * v_cost + p_qty * p_buy) / (greatest(v_stock, 0) + p_qty), 4);
  update products set stock = stock + p_qty, cost = v_new, price = coalesce(p_sell, price) where id = p_product;
  return jsonb_build_object('old_cost', v_cost, 'new_cost', v_new, 'new_stock', v_stock + p_qty);
end $$;

-- تسجيل تالف / مسروق: يخصم من المخزون ويحسب الخسارة بتكلفة القطعة
create or replace function record_loss(p_product uuid, p_qty numeric, p_reason text, p_note text default null, p_day date default null)
returns jsonb
language plpgsql security definer
set search_path = public as $$
declare v_stock numeric; v_cost numeric;
begin
  if not is_admin() then raise exception 'غير مسموح'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'الكمية يجب أن تكون أكبر من صفر'; end if;
  if p_reason not in ('damaged','stolen','expired','other') then raise exception 'سبب غير صحيح'; end if;
  select stock, cost into v_stock, v_cost from products where id = p_product for update;
  if not found then raise exception 'المنتج غير موجود'; end if;
  if p_qty > v_stock then raise exception 'الكمية أكبر من المخزون الحالي (%). صحّح المخزون أولاً', v_stock; end if;
  update products set stock = stock - p_qty where id = p_product;
  insert into product_losses(product_id, qty, reason, cost, note, day)
  values (p_product, p_qty, p_reason, v_cost, nullif(trim(coalesce(p_note, '')), ''), coalesce(p_day, current_date));
  return jsonb_build_object('loss', round(p_qty * v_cost, 2));
end $$;

-- حذف منتج: نهائي إذا ما له أي سجل، وإلا يُخفى (أرشفة) حتى تبقى المبيعات والتقارير القديمة سليمة
create or replace function delete_product(p_id uuid) returns jsonb
language plpgsql security definer
set search_path = public as $$
begin
  if not is_admin() then raise exception 'غير مسموح'; end if;
  perform 1 from products where id = p_id for update;
  if not found then raise exception 'المنتج غير موجود'; end if;
  if exists (select 1 from sale_items where product_id = p_id)
     or exists (select 1 from sale_return_items where product_id = p_id)
     or exists (select 1 from product_losses where product_id = p_id)
     or exists (select 1 from supplier_invoice_items where product_id = p_id) then
    update products set archived = true where id = p_id;
    return jsonb_build_object('deleted', false, 'archived', true);
  end if;
  delete from products where id = p_id;
  return jsonb_build_object('deleted', true, 'archived', false);
end $$;

-- حذف سجل تالف: يرجّع الكمية للمخزون
create or replace function delete_loss(p_id uuid) returns void
language plpgsql security definer
set search_path = public as $$
declare r product_losses%rowtype;
begin
  if not is_admin() then raise exception 'غير مسموح'; end if;
  select * into r from product_losses where id = p_id for update;
  if not found then raise exception 'السجل غير موجود'; end if;
  update products set stock = stock + r.qty where id = r.product_id;
  delete from product_losses where id = p_id;
end $$;

-- إغلاق أسبوع العمال: يثبّت الرواتب المستحقة لتُخصم من الأرباح (السبت إلى الخميس)
create or replace function close_week(p_week_start date) returns jsonb
language plpgsql security definer
set search_path = public as $$
declare
  w record; v_end date := p_week_start + 5;
  v_abs int; v_pres int; v_adv numeric; v_bon numeric; v_ded numeric; v_earned numeric;
  n int := 0; tot numeric := 0;
begin
  if not is_admin() then raise exception 'غير مسموح'; end if;
  for w in select * from workers
           where (active or (stopped_at is not null and stopped_at >= p_week_start))
             and (started_on is null or started_on <= v_end)
  loop
    continue when exists (select 1 from worker_payroll where worker_id = w.id and week_start = p_week_start);
    select count(*) filter (where status = 'absent'), count(*) filter (where status = 'present')
      into v_abs, v_pres from attendance where worker_id = w.id and day between p_week_start and v_end;
    select coalesce(sum(amount), 0) into v_adv from advances where worker_id = w.id and day between p_week_start and v_end;
    select coalesce(sum(amount), 0) into v_bon from worker_bonuses where worker_id = w.id and day between p_week_start and v_end;
    v_ded := v_abs * w.weekly_salary / 6;
    v_earned := w.weekly_salary - v_ded + v_bon;
    insert into worker_payroll(worker_id, week_start, week_end, weekly_salary, present_days, absent_days,
                               absence_deduction, bonus, earned, advances, net_pay)
    values (w.id, p_week_start, v_end, w.weekly_salary, v_pres, v_abs, v_ded, v_bon, v_earned, v_adv, v_earned - v_adv);
    n := n + 1; tot := tot + v_earned;
  end loop;
  return jsonb_build_object('closed', n, 'earned', tot);
end $$;

create or replace function reopen_week(p_week_start date) returns int
language plpgsql security definer
set search_path = public as $$
declare n int;
begin
  if not is_admin() then raise exception 'غير مسموح'; end if;
  delete from worker_payroll where week_start = p_week_start;
  get diagnostics n = row_count;
  return n;
end $$;

-- مرتجع من صفحة المدير: يستخدم نفس دالة المرتجع (التي تقفل الفاتورة)
create or replace function process_return(payload jsonb) returns void
language plpgsql security definer
set search_path = public as $$
begin
  if not is_admin() then raise exception 'admin only'; end if;
  perform submit_return(payload);
end $$;

-- إرجاع منتجات من صفحة الموظف: البحث عن فواتير الزبون
create or replace function find_sales_for_return(q text)
returns jsonb
language plpgsql security definer stable
set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if length(trim(coalesce(q, ''))) < 2 then return '[]'::jsonb; end if;

  return coalesce((
    select jsonb_agg(row_to_json(t)::jsonb order by t.created_at desc)
    from (
      select sa.id, sa.created_at, sa.total,
             c.name as customer_name, c.phone as customer_phone,
             (
               select coalesce(jsonb_agg(jsonb_build_object(
                        'product_id', x.product_id,
                        'name', p.name,
                        'code', p.code,
                        'price', x.price,
                        'sold', x.qty,
                        'returned', coalesce((
                          select sum(ri.qty)
                          from sale_return_items ri
                          join sale_returns rr on rr.id = ri.return_id
                          where rr.sale_id = sa.id and ri.product_id = x.product_id
                        ), 0)
                      ) order by p.name), '[]'::jsonb)
               from (
                 select product_id, sum(qty) as qty, sum(qty * price) / sum(qty) as price
                 from sale_items
                 where sale_id = sa.id
                 group by product_id
               ) x
               join products p on p.id = x.product_id
             ) as items
      from sales sa
      join customers c on c.id = sa.customer_id
      where c.name ilike '%' || trim(q) || '%'
         or c.phone ilike '%' || trim(q) || '%'
      order by sa.created_at desc
      limit 15
    ) t
  ), '[]'::jsonb);
end $$;

-- تنفيذ المرتجع (يقفل الفاتورة لمنع الإرجاع المزدوج، ويثبّت تكلفة القطعة الأصلية)
create or replace function submit_return(payload jsonb)
returns jsonb
language plpgsql security definer
set search_path = public as $$
declare
  v_sale uuid := (payload->>'sale_id')::uuid;
  v_ret  sale_returns.id%type;
  it jsonb;
  v_pid uuid; v_qty numeric; v_sold numeric; v_price numeric; v_cost numeric; v_done numeric;
  v_total numeric := 0;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;

  perform 1 from sales where id = v_sale for update;
  if not found then raise exception 'الفاتورة غير موجودة'; end if;

  insert into sale_returns(sale_id, note, total)
  values (v_sale, nullif(trim(coalesce(payload->>'note', '')), ''), 0)
  returning id into v_ret;

  for it in select * from jsonb_array_elements(coalesce(payload->'items', '[]'::jsonb)) loop
    v_pid := (it->>'product_id')::uuid;
    v_qty := (it->>'qty')::numeric;
    if v_qty is null or v_qty <= 0 then continue; end if;

    select sum(qty), sum(qty * price) / sum(qty), sum(qty * coalesce(cost, 0)) / sum(qty)
      into v_sold, v_price, v_cost
    from sale_items where sale_id = v_sale and product_id = v_pid;
    if v_sold is null then raise exception 'منتج ليس ضمن هذه الفاتورة'; end if;

    select coalesce(sum(ri.qty), 0) into v_done
    from sale_return_items ri
    join sale_returns rr on rr.id = ri.return_id
    where rr.sale_id = v_sale and ri.product_id = v_pid;

    if v_qty > v_sold - v_done then
      raise exception 'الكمية المرتجعة أكبر من المتاح للإرجاع';
    end if;

    insert into sale_return_items(return_id, product_id, qty, price, cost)
    values (v_ret, v_pid, v_qty, v_price, v_cost);

    update products set stock = stock + v_qty where id = v_pid;
    v_total := v_total + v_qty * v_price;
  end loop;

  if v_total = 0 then raise exception 'اختر منتجاً واحداً على الأقل'; end if;

  update sale_returns set total = v_total where id = v_ret;
  return jsonb_build_object('total', v_total);
end $$;

-- تعديل خصم الفاتورة و/أو رقم التاجر. الإجمالي النهائي = إجمالي الأصناف − الخصم
-- ويتحدّث سجل المصروف المرتبط بالفاتورة. (متوسط تكلفة المنتجات لا يُعاد حسابه عند تعديل الخصم لاحقاً)
create or replace function set_supplier_invoice_extras(
  p_id text, p_discount numeric default null, p_phone text default null)
returns numeric
language plpgsql security definer
set search_path = public as $$
declare v_sub numeric; v_total numeric;
begin
  if not is_admin() then raise exception 'غير مسموح'; end if;

  select case when coalesce(subtotal, 0) > 0 then subtotal
              else total + coalesce(discount, 0) end
    into v_sub
  from supplier_invoices where id::text = p_id for update;
  if not found then raise exception 'الفاتورة غير موجودة'; end if;

  if p_discount is not null then
    if p_discount < 0 or p_discount > v_sub then
      raise exception 'الخصم يجب أن يكون بين 0 وإجمالي الفاتورة';
    end if;
    update supplier_invoices
       set subtotal = v_sub, discount = p_discount, total = v_sub - p_discount
     where id::text = p_id;
    update expenses set amount = v_sub - p_discount where invoice_id::text = p_id;
  end if;

  if p_phone is not null then
    update supplier_invoices set supplier_phone = nullif(trim(p_phone), '')
     where id::text = p_id;
  end if;

  select total into v_total from supplier_invoices where id::text = p_id;
  return v_total;
end $$;

-- رقم التاجر يتحدّث على كل فواتير نفس الشركة
create or replace function set_supplier_phone(p_company text, p_phone text)
returns void
language plpgsql security definer
set search_path = public as $$
begin
  if not is_admin() then raise exception 'غير مسموح'; end if;
  update supplier_invoices set supplier_phone = nullif(trim(coalesce(p_phone, '')), '')
   where company = p_company;
end $$;

---------------------------------------------------------------
-- 3) العروض (Views)
---------------------------------------------------------------
-- البائع يشوف المنتجات بدون سعر التكلفة
create or replace view products_seller as
  select id, code, name, price, stock, pack_size from products where not archived;

-- عدد القطع المباعة والمرتجعة لكل منتج
create or replace view product_sales with (security_invoker = true) as
select p.id as product_id,
  coalesce((select sum(qty) from sale_items si where si.product_id = p.id), 0) as sold,
  coalesce((select sum(qty) from sale_return_items ri where ri.product_id = p.id), 0) as returned
from products p;

---------------------------------------------------------------
-- 4) الحماية RLS (المدير فقط، والبائع عبر الدوال والعرض)
---------------------------------------------------------------
alter table profiles enable row level security;
drop policy if exists "own profile" on profiles;
drop policy if exists "admin all" on profiles;
create policy "own profile" on profiles for select using (id = auth.uid() or is_admin());
create policy "admin all"   on profiles for all    using (is_admin()) with check (is_admin());

do $$
declare t text;
begin
  foreach t in array array[
    'products','customers','sales','sale_items',
    'expenses','workers','attendance','advances','worker_bonuses',
    'supplier_invoices','supplier_invoice_items','supplier_payment_images',
    'sale_returns','sale_return_items',
    'worker_notes','worker_payroll','product_losses'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "admin all" on %I', t);
    execute format('create policy "admin all" on %I for all using (is_admin()) with check (is_admin())', t);
  end loop;
end $$;

---------------------------------------------------------------
-- 5) الصلاحيات
---------------------------------------------------------------
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- العروض: للمسجّلين فقط (لا وصول بدون تسجيل دخول)
revoke all on products_seller from anon;
revoke all on product_sales   from anon;
grant select on products_seller to authenticated;
grant select on product_sales   to authenticated;

-- الدوال: للمسجّلين فقط
revoke all on function submit_sale(jsonb)                          from public, anon;
revoke all on function add_supplier_invoice(jsonb)                 from public, anon;
revoke all on function process_return(jsonb)                       from public, anon;
revoke all on function find_sales_for_return(text)                 from public, anon;
revoke all on function submit_return(jsonb)                        from public, anon;
revoke all on function add_stock(uuid, numeric, numeric, numeric)  from public, anon;
revoke all on function record_loss(uuid, numeric, text, text, date) from public, anon;
revoke all on function delete_loss(uuid)                           from public, anon;
revoke all on function delete_product(uuid)                        from public, anon;
revoke all on function close_week(date)                            from public, anon;
revoke all on function reopen_week(date)                           from public, anon;
revoke all on function set_supplier_invoice_extras(text, numeric, text) from public, anon;
revoke all on function set_supplier_phone(text, text)              from public, anon;
grant execute on function submit_sale(jsonb)                          to authenticated;
grant execute on function add_supplier_invoice(jsonb)                 to authenticated;
grant execute on function process_return(jsonb)                       to authenticated;
grant execute on function find_sales_for_return(text)                 to authenticated;
grant execute on function submit_return(jsonb)                        to authenticated;
grant execute on function add_stock(uuid, numeric, numeric, numeric)  to authenticated;
grant execute on function record_loss(uuid, numeric, text, text, date) to authenticated;
grant execute on function delete_loss(uuid)                           to authenticated;
grant execute on function delete_product(uuid)                        to authenticated;
grant execute on function close_week(date)                            to authenticated;
grant execute on function reopen_week(date)                           to authenticated;
grant execute on function set_supplier_invoice_extras(text, numeric, text) to authenticated;
grant execute on function set_supplier_phone(text, text)              to authenticated;

---------------------------------------------------------------
-- 6) تخزين صور الدفعات (خاص: المدير فقط)
---------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('payments', 'payments', false)
on conflict (id) do update set public = false;

drop policy if exists "payments admin select" on storage.objects;
drop policy if exists "payments admin insert" on storage.objects;
drop policy if exists "payments admin update" on storage.objects;
drop policy if exists "payments admin delete" on storage.objects;
create policy "payments admin select" on storage.objects for select to authenticated
  using (bucket_id = 'payments' and public.is_admin());
create policy "payments admin insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'payments' and public.is_admin());
create policy "payments admin update" on storage.objects for update to authenticated
  using (bucket_id = 'payments' and public.is_admin());
create policy "payments admin delete" on storage.objects for delete to authenticated
  using (bucket_id = 'payments' and public.is_admin());

---------------------------------------------------------------
-- 7) تحديث ذاكرة واجهة Supabase (مهم حتى تظهر الجداول الجديدة مثل البونص)
---------------------------------------------------------------
notify pgrst, 'reload schema';

-- بعد إنشاء مستخدمك الأول من Authentication، اجعله مديراً (مرة واحدة فقط):
-- insert into profiles(id, name, role) values ('USER-UUID', 'خالد', 'admin');

-- فحص سريع: كل القيم يجب أن تكون true
select
  to_regclass('public.worker_bonuses')          is not null as bonuses_ok,
  to_regclass('public.supplier_payment_images') is not null as payment_images_ok,
  to_regclass('public.product_sales')           is not null as product_sales_ok,
  to_regclass('public.sale_returns')            is not null as returns_ok,
  to_regclass('public.product_losses')          is not null as losses_ok,
  to_regclass('public.worker_payroll')          is not null as payroll_ok,
  to_regclass('public.worker_notes')            is not null as notes_ok;
