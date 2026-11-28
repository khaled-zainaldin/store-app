import { supabase } from './supabase'
import { fmt } from './dates'
import { fetchAll } from './fetchAll'
import { downloadXlsx } from './xlsx'

export const METHOD = { cash: 'نقداً', jawwal_pay: 'جوال بي', bank_of_palestine: 'بنك فلسطين', palpay: 'بال باي' }
export const REASON = { damaged: 'تالف', stolen: 'مسروق', expired: 'منتهي الصلاحية', other: 'أخرى' }
export const KIND = { expense: 'مصروف', purchase: 'مشتريات' }
export const PLACE = { shop: 'المحل', home: 'البيت' }

const n = v => Number(v) || 0
const sum = (a, f) => a.reduce((t, x) => t + f(x), 0)
export const round2 = v => Math.round(v * 100) / 100

// تكلفة البند وقت البيع (محفوظة داخل البند). للفواتير القديمة جداً نرجع لتكلفة المنتج الحالية.
export const costOf = i => n(i.cost ?? i.products?.cost)
export const itemProfit = i => n(i.qty) * (n(i.price) - costOf(i))
export const saleProfit = s => sum(s.sale_items || [], itemProfit)
export const returnProfit = r => sum(r.sale_return_items || [], itemProfit)

const parse = s => { const [y, m, d] = s.split('-').map(Number); return [y, m - 1, d] }
const dayStart = s => { const [y, m, d] = parse(s); return new Date(y, m, d) }
const nextDay = s => { const [y, m, d] = parse(s); return new Date(y, m, d + 1) }

// كل بيانات الفترة (من يوم إلى يوم، شاملة) + الملخص المحاسبي
export async function loadPeriod(from, to) {
  const a = dayStart(from).toISOString(), b = nextDay(to).toISOString()
  const [sales, returns, expenses, losses, payroll, invoices] = await Promise.all([
    fetchAll(() => supabase.from('sales')
      .select('id,total,payment_method,created_at,profiles(name),customers(name,phone),sale_items(qty,price,cost,products(cost))')
      .gte('created_at', a).lt('created_at', b).order('created_at').order('id')),
    fetchAll(() => supabase.from('sale_returns')
      .select('id,total,note,created_at,sale_return_items(qty,price,cost,products(cost))')
      .gte('created_at', a).lt('created_at', b).order('id')),
    fetchAll(() => supabase.from('expenses')
      .select('id,kind,place,who,reason,amount,day,invoice_id')
      .gte('day', from).lte('day', to).order('day').order('id')),
    fetchAll(() => supabase.from('product_losses')
      .select('id,qty,reason,cost,note,day,products(name,code)')
      .gte('day', from).lte('day', to).order('day').order('id')),
    fetchAll(() => supabase.from('worker_payroll')
      .select('*,workers(name)')
      .gte('week_end', from).lte('week_end', to).order('week_end').order('id')),
    fetchAll(() => supabase.from('supplier_invoices')
      .select('id,company,day,total,subtotal,discount,supplier_phone,supplier_invoice_items(product_name,qty,buy_price,sell_price)')
      .gte('day', from).lte('day', to).order('day').order('id'))
  ])

  const shop = expenses.filter(e => e.place === 'shop')
  const home = expenses.filter(e => e.place === 'home')
  const salesTotal = sum(sales, s => n(s.total))
  const returnsTotal = sum(returns, r => n(r.total))
  const gross = sum(sales, saleProfit) - sum(returns, returnProfit)
  const shopExp = sum(shop.filter(e => e.kind === 'expense'), e => n(e.amount))
  const shopBuy = sum(shop.filter(e => e.kind === 'purchase'), e => n(e.amount))
  const homeTotal = sum(home, e => n(e.amount))
  const salaries = sum(payroll, p => n(p.earned))
  const lossTotal = sum(losses, l => n(l.qty) * n(l.cost))
  const netShop = gross - shopExp - salaries - lossTotal
  const sm = {
    count: sales.length, salesTotal, returnsTotal, revenue: salesTotal - returnsTotal, gross,
    shopExp, shopBuy, homeTotal, salaries, lossTotal, netShop, afterHome: netShop - homeTotal
  }
  return { from, to, sales, returns, expenses, losses, payroll, invoices, sm }
}

// ملف Excel شامل للفترة: ملخص الأرباح + مصاريف المحل + مصاريف البيت + فواتير التجار + المبيعات + التالف + الرواتب
export async function buildFullReport(from, to, preloaded) {
  const d = preloaded && preloaded.from === from && preloaded.to === to ? preloaded : await loadPeriod(from, to)
  const { sm } = d
  const B = (v, money = true) => ({ v, b: true, money })

  const summary = {
    name: 'ملخص الأرباح', widths: [44, 18], money: [1],
    rows: [
      ['البند', 'القيمة'],
      ['الفترة', `${from}  إلى  ${to}`],
      ['عدد الفواتير', { v: sm.count, money: false }],
      ['إجمالي المبيعات', sm.salesTotal],
      ['المرتجعات', sm.returnsTotal],
      [B('صافي المبيعات', false), B(sm.revenue)],
      [B('ربح المبيعات (سعر البيع − التكلفة)', false), B(sm.gross)],
      ['مصاريف المحل', sm.shopExp],
      ['رواتب العمال (الأسابيع المغلقة)', sm.salaries],
      ['خسائر التالف والمسروق', sm.lossTotal],
      [B('صافي ربح المحل', false), B(sm.netShop)],
      ['مصاريف البيت', sm.homeTotal],
      [B('المتبقي بعد مصاريف البيت', false), B(sm.afterHome)],
      [],
      ['مشتريات المحل (للعرض فقط، تكلفتها محسوبة داخل الربح)', sm.shopBuy],
      [],
      ['صافي ربح المحل = ربح المبيعات − مصاريف المحل − رواتب العمال − خسائر التالف'],
      ['مصاريف البيت لا تُخصم من ربح المحل، وتُعرض بشكل مستقل.']
    ]
  }

  const expRows = place => {
    const list = d.expenses.filter(e => e.place === place)
    return [
      ['التاريخ', 'النوع', 'الشخص', 'السبب', 'المبلغ'],
      ...list.map(e => [e.day, KIND[e.kind] || e.kind, e.who, e.reason, n(e.amount)]),
      [{ v: 'مصاريف (تُخصم من الربح)', b: true }, '', '', '', B(sum(list.filter(e => e.kind === 'expense'), e => n(e.amount)))],
      [{ v: 'مشتريات (للعرض فقط)', b: true }, '', '', '', B(sum(list.filter(e => e.kind === 'purchase'), e => n(e.amount)))],
      [{ v: 'الإجمالي', b: true }, '', '', '', B(sum(list, e => n(e.amount)))]
    ]
  }

  // ملخص كل تاجر
  const byCo = {}
  d.invoices.forEach(v => {
    const g = (byCo[v.company] ??= { phone: '', count: 0, sub: 0, disc: 0, total: 0 })
    g.count += 1
    g.sub += n(v.subtotal) > 0 ? n(v.subtotal) : n(v.total) + n(v.discount)
    g.disc += n(v.discount)
    g.total += n(v.total)
    if (!g.phone && v.supplier_phone) g.phone = v.supplier_phone
  })
  const coRows = Object.entries(byCo).sort((x, y) => y[1].total - x[1].total)
  const suppliersSum = {
    name: 'ملخص التجار', widths: [28, 16, 12, 16, 14, 16], money: [3, 4, 5],
    rows: [
      ['التاجر', 'الهاتف', 'عدد الفواتير', 'إجمالي الأصناف', 'الخصم', 'الإجمالي بعد الخصم'],
      ...coRows.map(([c, g]) => [c, g.phone, g.count, g.sub, g.disc, g.total]),
      [{ v: 'الإجمالي', b: true }, '', '', B(sum(coRows, ([, g]) => g.sub)), B(sum(coRows, ([, g]) => g.disc)), B(sum(coRows, ([, g]) => g.total))]
    ]
  }
  const invRows = [['التاجر', 'تاريخ الفاتورة', 'المنتج', 'الكمية (قطع)', 'سعر الشراء للقطعة', 'سعر البيع للقطعة', 'إجمالي السطر', 'إجمالي الفاتورة بعد الخصم']]
  d.invoices.slice().sort((x, y) => x.company.localeCompare(y.company, 'ar') || x.day.localeCompare(y.day)).forEach(v => {
    const items = v.supplier_invoice_items || []
    if (!items.length) invRows.push([v.company, v.day, '', '', '', '', '', n(v.total)])
    items.forEach((i, k) => invRows.push([v.company, v.day, i.product_name, n(i.qty), n(i.buy_price), n(i.sell_price), n(i.qty) * n(i.buy_price), k === 0 ? n(v.total) : '']))
  })
  const suppliersDet = { name: 'تفاصيل فواتير التجار', widths: [24, 14, 28, 14, 16, 16, 14, 18], money: [4, 5, 6, 7], rows: invRows }

  const salesRows = [['التاريخ والوقت', 'الزبون', 'الهاتف', 'الموظف', 'طريقة الدفع', 'قيمة الفاتورة', 'الربح']]
  d.sales.forEach(s => salesRows.push([
    new Date(s.created_at).toLocaleString('en-GB'), s.customers?.name || '', s.customers?.phone || '',
    s.profiles?.name || '', METHOD[s.payment_method] || s.payment_method, n(s.total), saleProfit(s)
  ]))
  salesRows.push([{ v: 'الإجمالي', b: true }, '', '', '', '', B(sm.salesTotal), B(sum(d.sales, saleProfit))])
  if (d.returns.length) {
    salesRows.push([])
    salesRows.push([{ v: 'المرتجعات في الفترة', b: true }])
    d.returns.forEach(r => salesRows.push([new Date(r.created_at).toLocaleString('en-GB'), '', '', '', r.note || 'مرتجع', -n(r.total), -returnProfit(r)]))
  }

  const lossRows = [['التاريخ', 'المنتج', 'الكود', 'الكمية', 'السبب', 'تكلفة القطعة', 'الخسارة', 'ملاحظة'],
    ...d.losses.map(l => [l.day, l.products?.name || '', l.products?.code || '', n(l.qty), REASON[l.reason] || l.reason, n(l.cost), n(l.qty) * n(l.cost), l.note || '']),
    [{ v: 'الإجمالي', b: true }, '', '', '', '', '', B(sm.lossTotal)]]

  const payRows = [['الأسبوع (من)', 'الأسبوع (إلى)', 'العامل', 'الراتب الأسبوعي', 'أيام الغياب', 'خصم الغياب', 'البونص', 'المستحق (يُخصم من الأرباح)', 'السلف', 'صافي التسليم'],
    ...d.payroll.map(p => [p.week_start, p.week_end, p.workers?.name || '', n(p.weekly_salary), n(p.absent_days), n(p.absence_deduction), n(p.bonus), n(p.earned), n(p.advances), n(p.net_pay)]),
    [{ v: 'الإجمالي', b: true }, '', '', '', '', '', '', B(sm.salaries), B(sum(d.payroll, p => n(p.advances))), B(sum(d.payroll, p => n(p.net_pay)))]]

  downloadXlsx(`تقرير المتجر ${from} إلى ${to}.xlsx`, [
    summary,
    { name: 'مصاريف المحل', widths: [14, 12, 20, 32, 14], money: [4], rows: expRows('shop') },
    { name: 'مصاريف البيت', widths: [14, 12, 20, 32, 14], money: [4], rows: expRows('home') },
    suppliersSum,
    suppliersDet,
    { name: 'المبيعات', widths: [22, 20, 16, 16, 16, 16, 14], money: [5, 6], rows: salesRows },
    { name: 'التالف والمسروق', widths: [14, 28, 14, 10, 16, 14, 14, 28], money: [5, 6], rows: lossRows },
    { name: 'رواتب العمال', widths: [14, 14, 20, 14, 12, 12, 12, 22, 12, 14], money: [3, 5, 6, 7, 8, 9], rows: payRows }
  ])
}

// إحصائيات المنتجات (مبيعات، مرتجع، إيراد، ربح، تالف) من تاريخ معيّن أو منذ البداية (sinceISO = null)
export async function loadProductStats(sinceISO) {
  const sinceDay = sinceISO ? fmt(new Date(sinceISO)) : null
  const [items, rets, losses] = await Promise.all([
    fetchAll(() => {
      let q = supabase.from('sale_items').select(sinceISO ? 'id,product_id,qty,price,cost,sales!inner(created_at)' : 'id,product_id,qty,price,cost')
      if (sinceISO) q = q.gte('sales.created_at', sinceISO)
      return q.order('id')
    }),
    fetchAll(() => {
      let q = supabase.from('sale_return_items').select(sinceISO ? 'id,product_id,qty,price,cost,sale_returns!inner(created_at)' : 'id,product_id,qty,price,cost')
      if (sinceISO) q = q.gte('sale_returns.created_at', sinceISO)
      return q.order('id')
    }),
    fetchAll(() => {
      let q = supabase.from('product_losses').select('id,product_id,qty,cost,reason,note,day,products(name,code)')
      if (sinceDay) q = q.gte('day', sinceDay)
      return q.order('day').order('id')
    })
  ])
  const map = {}
  const get = id => (map[id] ??= { sold: 0, returned: 0, revenue: 0, profit: 0, lossQty: 0, lossCost: 0 })
  items.forEach(i => { const s = get(i.product_id); s.sold += n(i.qty); s.revenue += n(i.qty) * n(i.price); s.profit += n(i.qty) * (n(i.price) - n(i.cost)) })
  rets.forEach(i => { const s = get(i.product_id); s.returned += n(i.qty); s.revenue -= n(i.qty) * n(i.price); s.profit -= n(i.qty) * (n(i.price) - n(i.cost)) })
  losses.forEach(l => { const s = get(l.product_id); s.lossQty += n(l.qty); s.lossCost += n(l.qty) * n(l.cost) })
  return { map, losses }
}

// تقرير شامل مفصّل لكل منتج
export function buildProductsReport(products, stats, label) {
  const B = (v, money = true) => ({ v, b: true, money })
  const z = { sold: 0, returned: 0, revenue: 0, profit: 0, lossQty: 0, lossCost: 0 }
  const list = products.map(p => ({ p, s: stats.map[p.id] || z })).sort((a, b) => (b.s.sold - b.s.returned) - (a.s.sold - a.s.returned))
  const rows = [['الكود', 'المنتج', 'سعر البيع', 'التكلفة (متوسط)', 'المخزون الحالي', 'قيمة المخزون (بالتكلفة)', 'المباع', 'المرتجع', 'صافي المباع', 'الإيراد', 'الربح', 'تالف/مسروق (قطع)', 'خسارة التالف']]
  list.forEach(({ p, s }) => rows.push([p.code, p.name, n(p.price), n(p.cost), n(p.stock), Math.max(n(p.stock), 0) * n(p.cost),
    s.sold, s.returned, s.sold - s.returned, s.revenue, s.profit, s.lossQty, s.lossCost]))
  rows.push([{ v: 'الإجمالي', b: true }, '', '', '', B(sum(list, x => n(x.p.stock)), false), B(sum(list, x => Math.max(n(x.p.stock), 0) * n(x.p.cost))),
    B(sum(list, x => x.s.sold), false), B(sum(list, x => x.s.returned), false), B(sum(list, x => x.s.sold - x.s.returned), false),
    B(sum(list, x => x.s.revenue)), B(sum(list, x => x.s.profit)), B(sum(list, x => x.s.lossQty), false), B(sum(list, x => x.s.lossCost))])

  const lossRows = [['التاريخ', 'المنتج', 'الكود', 'الكمية', 'السبب', 'تكلفة القطعة', 'الخسارة', 'ملاحظة'],
    ...stats.losses.map(l => [l.day, l.products?.name || '', l.products?.code || '', n(l.qty), REASON[l.reason] || l.reason, n(l.cost), n(l.qty) * n(l.cost), l.note || ''])]

  downloadXlsx(`تقرير المنتجات ${label} ${fmt(new Date())}.xlsx`, [
    { name: 'المنتجات', widths: [12, 30, 12, 14, 12, 18, 10, 10, 12, 14, 14, 14, 14], money: [2, 3, 5, 9, 10, 12], rows },
    { name: 'التالف والمسروق', widths: [14, 28, 12, 10, 16, 14, 14, 28], money: [5, 6], rows: lossRows }
  ])
}
