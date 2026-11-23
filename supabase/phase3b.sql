-- شغّله بعد phase3.sql: يحفظ السعر القديم مع كل بند لحساب الفروق
alter table supplier_invoice_items add column if not exists old_buy_price numeric;
alter table supplier_invoice_items add column if not exists old_sell_price numeric;

create or replace function add_supplier_invoice(payload jsonb) returns void
language plpgsql security definer as $$
declare inv uuid; it jsonb; pid uuid; v_name text; v_code text; tot numeric := 0; v_day date;
        o_cost numeric; o_price numeric;
begin
  if not is_admin() then raise exception 'admin only'; end if;
  v_day := coalesce(nullif(payload->>'day','')::date, current_date);
  insert into supplier_invoices(company, day) values (trim(payload->>'company'), v_day) returning id into inv;

  for it in select * from jsonb_array_elements(payload->'items') loop
    v_name := trim(it->>'name');
    o_cost := null; o_price := null;
    select id, cost, price into pid, o_cost, o_price from products
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
    insert into supplier_invoice_items(invoice_id, product_id, product_name, qty, buy_price, sell_price, old_buy_price, old_sell_price)
    values (inv, pid, v_name, (it->>'qty')::numeric, (it->>'buy_price')::numeric, (it->>'sell_price')::numeric, o_cost, o_price);
    tot := tot + (it->>'qty')::numeric * (it->>'buy_price')::numeric;
  end loop;

  update supplier_invoices set total = tot where id = inv;
  insert into expenses(kind, place, who, reason, amount, day)
  values ('purchase', 'shop', trim(payload->>'company'), 'فاتورة تاجر', tot, v_day);
end $$;
