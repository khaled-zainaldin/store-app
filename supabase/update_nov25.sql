-- شغّل هذا الملف كاملاً في Supabase > SQL Editor (آمن لو انشغّل أكثر من مرة)
-- 1) إرجاع منتجات من صفحة الموظف   2) رقم التاجر + خصم الفاتورة + صور الدفعات   3) بونص العمال

---------------------------------------------------------------
-- 1) إرجاع المنتجات للموظف (لا يقرأ جدول المبيعات مباشرة)
---------------------------------------------------------------
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

create or replace function submit_return(payload jsonb)
returns jsonb
language plpgsql security definer
set search_path = public as $$
declare
  v_sale uuid := (payload->>'sale_id')::uuid;
  v_ret  sale_returns.id%type;
  it jsonb;
  v_pid uuid; v_qty numeric; v_sold numeric; v_price numeric; v_done numeric;
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

    select sum(qty), sum(qty * price) / sum(qty)
      into v_sold, v_price
    from sale_items where sale_id = v_sale and product_id = v_pid;
    if v_sold is null then raise exception 'منتج ليس ضمن هذه الفاتورة'; end if;

    select coalesce(sum(ri.qty), 0) into v_done
    from sale_return_items ri
    join sale_returns rr on rr.id = ri.return_id
    where rr.sale_id = v_sale and ri.product_id = v_pid;

    if v_qty > v_sold - v_done then
      raise exception 'الكمية المرتجعة أكبر من المتاح للإرجاع';
    end if;

    insert into sale_return_items(return_id, product_id, qty, price)
    values (v_ret, v_pid, v_qty, v_price);

    update products set stock = stock + v_qty where id = v_pid;
    v_total := v_total + v_qty * v_price;
  end loop;

  if v_total = 0 then raise exception 'اختر منتجاً واحداً على الأقل'; end if;

  update sale_returns set total = v_total where id = v_ret;
  return jsonb_build_object('total', v_total);
end $$;

revoke all on function find_sales_for_return(text) from public, anon;
revoke all on function submit_return(jsonb) from public, anon;
grant execute on function find_sales_for_return(text) to authenticated;
grant execute on function submit_return(jsonb) to authenticated;

---------------------------------------------------------------
-- 2) فواتير التجار: رقم التاجر + الخصم + صور الدفعات
---------------------------------------------------------------
alter table supplier_invoices
  add column if not exists supplier_phone text,
  add column if not exists subtotal numeric not null default 0,
  add column if not exists discount numeric not null default 0;

-- جدول الصور (يطابق نوع عمود id الموجود عندك تلقائياً)
do $$
declare t text;
begin
  select format_type(atttypid, atttypmod) into t
  from pg_attribute
  where attrelid = 'public.supplier_invoices'::regclass and attname = 'id';
  execute format($f$
    create table if not exists supplier_payment_images (
      id uuid primary key default gen_random_uuid(),
      invoice_id %s not null references supplier_invoices(id) on delete cascade,
      image_url text not null,          -- مسار الملف داخل التخزين
      created_at timestamptz default now()
    )$f$, t);
end $$;

alter table supplier_payment_images enable row level security;
drop policy if exists "admin all" on supplier_payment_images;
create policy "admin all" on supplier_payment_images
  for all using (is_admin()) with check (is_admin());

-- تعديل خصم الفاتورة و/أو رقم التاجر. الإجمالي النهائي = إجمالي الأصناف − الخصم
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

revoke all on function set_supplier_invoice_extras(text, numeric, text) from public, anon;
revoke all on function set_supplier_phone(text, text) from public, anon;
grant execute on function set_supplier_invoice_extras(text, numeric, text) to authenticated;
grant execute on function set_supplier_phone(text, text) to authenticated;

-- مخزن الصور: خاص (لا أحد يشوف الصور إلا المدير)
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
-- 3) بونص العمال (سجلات بالتاريخ مثل السلف)
---------------------------------------------------------------
do $$
declare t text;
begin
  select format_type(atttypid, atttypmod) into t
  from pg_attribute
  where attrelid = 'public.workers'::regclass and attname = 'id';
  execute format($f$
    create table if not exists worker_bonuses (
      id uuid primary key default gen_random_uuid(),
      worker_id %s not null references workers(id) on delete cascade,
      amount numeric not null check (amount > 0),
      day date not null,
      created_at timestamptz default now()
    )$f$, t);
end $$;

alter table worker_bonuses enable row level security;
drop policy if exists "admin all" on worker_bonuses;
create policy "admin all" on worker_bonuses
  for all using (is_admin()) with check (is_admin());

notify pgrst, 'reload schema';
