import { supabase } from './supabase'
import { fmt, addDays } from './dates'

const parse = s => new Date(s + 'T00:00:00')

// بداية ونهاية الفترة كنص ISO (النهاية غير شاملة)
export const dayRange = (from, to) => [parse(from).toISOString(), addDays(parse(to), 1).toISOString()]

// صافي راتب عامل في فترة [from, to] (نصوص YYYY-MM-DD):
// أيام الدوام (كل الأيام ما عدا الجمعة) × الأجر اليومي − خصم الغياب − السلف + البونص
// الأجر اليومي = الراتب الأسبوعي ÷ 6. العامل الموقوف لا يُحسب له راتب من يوم الإيقاف.
export function workerNet(w, att, adv, bon, from, to) {
  const stop = w.stopped_at || (w.active === false ? '0000-00-00' : null)
  const daily = Number(w.weekly_salary) / 6
  let workdays = 0
  for (let d = parse(from); fmt(d) <= to; d = addDays(d, 1)) {
    if (d.getDay() !== 5 && (!stop || fmt(d) < stop)) workdays++
  }
  const mine = x => x.worker_id === w.id && x.day >= from && x.day <= to
  const absent = att.filter(a => mine(a) && a.status === 'absent' && (!stop || a.day < stop)).length
  const advTotal = adv.filter(mine).reduce((s, a) => s + Number(a.amount), 0)
  const bonTotal = bon.filter(mine).reduce((s, b) => s + Number(b.amount), 0)
  return { daily, workdays, absent, advTotal, bonTotal, net: daily * workdays - absent * daily - advTotal + bonTotal }
}

// كل أرقام اللوحة الرئيسية وتقرير Excel من مكان واحد حتى لا تختلف
export async function loadSummary(from, to) {
  const [a, b] = dayRange(from, to)
  const [sa, ex, lo, rt, ws, at, ad, bo, ls, pr] = await Promise.all([
    supabase.from('sales').select('total,payment_method,created_at,sale_items(qty,price,products(name,cost))').gte('created_at', a).lt('created_at', b),
    supabase.from('expenses').select('kind,place,amount').gte('day', from).lte('day', to),
    supabase.from('products').select('name,stock').lte('stock', 5).order('stock').limit(8),
    supabase.from('sale_returns').select('total,created_at,sale_return_items(qty,price,products(cost))').gte('created_at', a).lt('created_at', b),
    supabase.from('workers').select('*'),
    supabase.from('attendance').select('*').gte('day', from).lte('day', to),
    supabase.from('advances').select('*').gte('day', from).lte('day', to),
    supabase.from('worker_bonuses').select('*').gte('day', from).lte('day', to),
    supabase.from('product_losses').select('loss').gte('day', from).lte('day', to),
    supabase.from('products').select('cost,stock')
  ])

  const sales = sa.data || [], exp = ex.data || [], rets = rt.data || []
  const items = sales.flatMap(x => x.sale_items)
  const retTotal = rets.reduce((t, r) => t + Number(r.total), 0)
  const retGross = rets.flatMap(r => r.sale_return_items).reduce((t, i) => t + i.qty * (i.price - (i.products?.cost || 0)), 0)
  const revenue = sales.reduce((t, x) => t + Number(x.total), 0) - retTotal
  const gross = items.reduce((t, i) => t + i.qty * (i.price - (i.products?.cost || 0)), 0) - retGross
  const sum = (kind, place) => exp.filter(e => e.kind === kind && e.place === place).reduce((t, e) => t + Number(e.amount), 0)

  const shopExp = sum('expense', 'shop'), homeExp = sum('expense', 'home')
  const salaries = (ws.data || []).reduce((t, w) => t + workerNet(w, at.data || [], ad.data || [], bo.data || [], from, to).net, 0)
  const losses = (ls.data || []).reduce((t, x) => t + Number(x.loss), 0)
  const capital = (pr.data || []).reduce((t, p) => t + Number(p.cost || 0) * Math.max(0, Number(p.stock) || 0), 0)

  const net = gross - shopExp - salaries - losses   // صافي ربح المحل
  const left = net - homeExp                         // المتبقي بعد مصاريف البيت

  const byDay = {}
  sales.forEach(x => { const k = fmt(new Date(x.created_at)); byDay[k] = (byDay[k] || 0) + Number(x.total) })
  rets.forEach(r => { const k = fmt(new Date(r.created_at)); byDay[k] = (byDay[k] || 0) - Number(r.total) })

  return {
    count: sales.length, sales, items, retTotal, revenue, gross,
    shopExp, homeExp, purchShop: sum('purchase', 'shop'), purchHome: sum('purchase', 'home'),
    salaries, losses, net, left, capital, byDay, low: lo.data || []
  }
}
