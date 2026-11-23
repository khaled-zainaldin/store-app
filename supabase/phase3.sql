-- شغّله في SQL Editor: فواتير التجار (مشتريات من الشركات)
create sequence if not exists product_code_seq;

create table supplier_invoices (
  id uuid primary key default gen_random_uuid(),
  company text not null,
  day date not null default current_date,
  total numeric not null default 0
);
create table supplier_invoice_items (
  id bigserial primary key,
  invoice_id uuid not null references supplier_invoices(id) on delete cascade,
  product_id uuid references products(id),
  product_name text not null,
  qty numeric not null,
  buy_price numeric not null,
  sell_price numeric not null
);
alter table supplier_invoices      enable row level security;
alter table supplier_invoice_items enable row level security;
create policy "admin all" on supplier_invoices      for all using (is_admin()) with check (is_admin());
create policy "admin all" on supplier_invoice_items for all using (is_admin()) with check (is_admin());
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- حفظ الفاتورة كاملة: يزيد المخزون ويحدّث سعر الشراء والبيع، وينشئ المنتج الجديد تلقائياً
create or replace function add_supplier_invoice(payload jsonb) returns void
language plpgsql security definer as $$
declare inv uuid; it jsonb; pid uuid; v_name text; v_code text; tot numeric := 0; v_day date;
begin
  if not is_admin() then raise exception 'admin only'; end if;
  v_day := coalesce(nullif(payload->>'day','')::date, current_date);
  insert into supplier_invoices(company, day) values (trim(payload->>'company'), v_day) returning id into inv;

  for it in select * from jsonb_array_elements(payload->'items') loop
    v_name := trim(it->>'name');
    select id into pid from products
      where name = v_name or (nullif(trim(it->>'code'),'') is not null and code = trim(it->>'code')) limit 1;
    if pid is null then
      v_code := coalesce(nullif(trim(it->>'code'),''), 'P' || nextval('product_code_seq'));
      insert into products(code, name, price, cost, stock)
      values (v_code, v_name, (it->>'sell_price')::numeric, (it->>'buy_price')::numeric, (it->>'qty')::numeric)
      returning id into pid;
    else
      update products set stock = stock + (it->>'qty')::numeric,
        cost = (it->>'buy_price')::numeric, price = (it->>'sell_price')::numeric
      where id = pid;
    end if;
    insert into supplier_invoice_items(invoice_id, product_id, product_name, qty, buy_price, sell_price)
    values (inv, pid, v_name, (it->>'qty')::numeric, (it->>'buy_price')::numeric, (it->>'sell_price')::numeric);
    tot := tot + (it->>'qty')::numeric * (it->>'buy_price')::numeric;
  end loop;

  update supplier_invoices set total = tot where id = inv;
  insert into expenses(kind, place, who, reason, amount, day)
  values ('purchase', 'shop', trim(payload->>'company'), 'فاتورة تاجر', tot, v_day);
end $$;
grant execute on function add_supplier_invoice(jsonb) to authenticated;
