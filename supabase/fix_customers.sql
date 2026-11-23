-- شغّله في SQL Editor: يسجّل الزبون حتى لو أُدخل رقم الهاتف فقط
create or replace function submit_sale(payload jsonb) returns void
language plpgsql security definer as $$
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
    insert into sale_items(sale_id, product_id, qty, price)
    values ((payload->>'id')::uuid, (it->>'product_id')::uuid,
            (it->>'qty')::numeric, (it->>'price')::numeric);
    update products set stock = stock - (it->>'qty')::numeric
    where id = (it->>'product_id')::uuid;
  end loop;
end $$;
