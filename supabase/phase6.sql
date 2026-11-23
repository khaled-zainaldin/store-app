-- شغّله في SQL Editor (بعد phase4.sql): عدد القطع المباعة لكل منتج (صافي بعد المرتجعات)
create or replace view product_sales with (security_invoker = true) as
select p.id as product_id,
  coalesce((select sum(qty) from sale_items si where si.product_id = p.id), 0) as sold,
  coalesce((select sum(qty) from sale_return_items ri where ri.product_id = p.id), 0) as returned
from products p;
grant select on product_sales to authenticated;
