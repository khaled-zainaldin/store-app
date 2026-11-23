-- شغّله في SQL Editor: المرتجعات
create table sale_returns (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references sales(id),
  note text,
  total numeric not null default 0,
  created_at timestamptz not null default now()
);
create table sale_return_items (
  id bigserial primary key,
  return_id uuid not null references sale_returns(id) on delete cascade,
  product_id uuid not null references products(id),
  qty numeric not null,
  price numeric not null
);
alter table sale_returns      enable row level security;
alter table sale_return_items enable row level security;
create policy "admin all" on sale_returns      for all using (is_admin()) with check (is_admin());
create policy "admin all" on sale_return_items for all using (is_admin()) with check (is_admin());
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- تنفيذ مرتجع: يتحقق من الكمية المباعة، يرجّع البضاعة للمخزون، ويحسب المبلغ بسعر البيع الأصلي
create or replace function process_return(payload jsonb) returns void
language plpgsql security definer as $$
declare
  rid uuid; it jsonb; v_sale uuid := (payload->>'sale_id')::uuid;
  v_pid uuid; v_qty numeric; v_sold numeric; v_ret numeric; v_price numeric; tot numeric := 0;
begin
  if not is_admin() then raise exception 'admin only'; end if;
  insert into sale_returns(sale_id, note) values (v_sale, nullif(payload->>'note','')) returning id into rid;

  for it in select * from jsonb_array_elements(payload->'items') loop
    v_qty := (it->>'qty')::numeric;
    v_pid := (it->>'product_id')::uuid;
    continue when v_qty <= 0;

    select coalesce(sum(qty),0), max(price) into v_sold, v_price
      from sale_items where sale_id = v_sale and product_id = v_pid;
    select coalesce(sum(ri.qty),0) into v_ret
      from sale_return_items ri join sale_returns r on r.id = ri.return_id
      where r.sale_id = v_sale and ri.product_id = v_pid;
    if v_qty > v_sold - v_ret then raise exception 'qty exceeds sold quantity'; end if;

    insert into sale_return_items(return_id, product_id, qty, price) values (rid, v_pid, v_qty, v_price);
    update products set stock = stock + v_qty where id = v_pid;
    tot := tot + v_qty * v_price;
  end loop;

  if tot = 0 then raise exception 'no items to return'; end if;
  update sale_returns set total = tot where id = rid;
end $$;
grant execute on function process_return(jsonb) to authenticated;
