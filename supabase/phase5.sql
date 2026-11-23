-- شغّله في SQL Editor: عدد القطع بالعبوة (الافتراضي 12)
alter table products add column if not exists pack_size numeric not null default 12;
create or replace view products_seller as select id, code, name, price, stock, pack_size from products;
grant select on products_seller to authenticated;
