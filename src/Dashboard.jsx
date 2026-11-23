import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import { fmt, weekStart, addDays } from './lib/dates'
import { Bars, Cols, groupSum } from './Charts.jsx'

const METHOD = { cash: 'نقداً', jawwal_pay: 'جوال بي', bank_of_palestine: 'بنك فلسطين', palpay: 'بال باي' }
const startOf = p => {
  const n = new Date()
  if (p === 'week') return weekStart(n)
  if (p === 'month') return new Date(n.getFullYear(), n.getMonth(), 1)
  return new Date(n.getFullYear(), n.getMonth(), n.getDate())
}

export default function Dashboard() {
  const [p, setP] = useState('week')
  const [d, setD] = useState(null)

  useEffect(() => {
    const s = startOf(p)
    Promise.all([
      supabase.from('sales').select('total,payment_method,created_at,sale_items(qty,price,products(name,cost))').gte('created_at', s.toISOString()),
      supabase.from('expenses').select('kind,place,amount').gte('day', fmt(s)),
      supabase.from('products').select('name,stock').lte('stock', 5).order('stock').limit(8),
      supabase.from('sale_returns').select('total,created_at,sale_return_items(qty,price,products(cost))').gte('created_at', s.toISOString())
    ]).then(([sa, ex, lo, rt]) => {
      const sales = sa.data || [], exp = ex.data || []
      const items = sales.flatMap(x => x.sale_items)
      const rets = rt.data || []
      const retTotal = rets.reduce((t, r) => t + Number(r.total), 0)
      const retGross = rets.flatMap(r => r.sale_return_items).reduce((t, i) => t + i.qty * (i.price - (i.products?.cost || 0)), 0)
      const revenue = sales.reduce((t, x) => t + Number(x.total), 0) - retTotal
      const gross = items.reduce((t, i) => t + i.qty * (i.price - (i.products?.cost || 0)), 0) - retGross
      const sum = (kind, place) => exp.filter(e => e.kind === kind && e.place === place).reduce((t, e) => t + Number(e.amount), 0)
      const shopExp = sum('expense', 'shop')

      const byDay = {}
      sales.forEach(x => { const k = fmt(new Date(x.created_at)); byDay[k] = (byDay[k] || 0) + Number(x.total) })
      rets.forEach(r => { const k = fmt(new Date(r.created_at)); byDay[k] = (byDay[k] || 0) - Number(r.total) })
      const cols = []
      for (let t = new Date(s), n = 0; t <= new Date(); t = addDays(t, 1), n++) {
        const k = fmt(t)
        cols.push({ value: Math.max(0, byDay[k] || 0), title: k, label: p === 'month' && n % 5 ? '' : String(t.getDate()) })
      }

      setD({
        count: sales.length, retTotal, revenue, gross, shopExp, net: gross - shopExp, cols,
        pay: groupSum(sales, x => METHOD[x.payment_method] || x.payment_method, x => Number(x.total)),
        top: groupSum(items, i => i.products?.name || '—', i => i.qty * i.price).slice(0, 5),
        exp: [
          { label: 'مصاريف المحل', value: shopExp }, { label: 'مصاريف البيت', value: sum('expense', 'home') },
          { label: 'مشتريات المحل', value: sum('purchase', 'shop') }, { label: 'مشتريات البيت', value: sum('purchase', 'home') }
        ],
        low: lo.data || []
      })
    })
  }, [p])

  const kpi = (l, v, cls = '', money = true) => (
    <div className={'kpi ' + cls}><small>{l}</small><b>{money ? Number(v).toFixed(2) + ' ₪' : v}</b></div>
  )

  return (
    <div className="app">
      <h2>اللوحة الرئيسية</h2>
      <div className="tabs inner">
        {[['day', 'اليوم'], ['week', 'الأسبوع'], ['month', 'الشهر']].map(([k, l]) =>
          <button key={k} className={p === k ? 'on' : ''} onClick={() => setP(k)}>{l}</button>)}
      </div>

      {d && <>
        <div className="stats big">
          {kpi('عدد الفواتير', d.count, '', false)}
          {kpi('صافي المبيعات', d.revenue)}
          {kpi('ربح المبيعات', d.gross, 'good')}
          {kpi('الصافي بعد مصاريف المحل', d.net, d.net >= 0 ? 'good' : 'bad')}
        </div>

        {d.retTotal > 0 && <p className="empty">الأرقام بعد خصم مرتجعات بقيمة {d.retTotal.toFixed(2)} ₪</p>}
        {p !== 'day' && <section className="card"><h3>المبيعات اليومية</h3><Cols items={d.cols} /></section>}
        <section className="card"><h3>أكثر المنتجات مبيعاً</h3><Bars items={d.top} /></section>
        <section className="card"><h3>طرق الدفع</h3><Bars items={d.pay} /></section>
        <section className="card"><h3>المصاريف والمشتريات</h3><Bars items={d.exp} /></section>
        {d.low.length > 0 && (
          <section className="card warn"><h3>مخزون منخفض</h3>
            {d.low.map(x => <p key={x.name} className="row2"><span>{x.name}</span><b>{x.stock}</b></p>)}
          </section>
        )}
        <p className="empty">ربح المبيعات = سعر البيع − سعر التكلفة. الصافي قبل رواتب العمال، والمشتريات للعرض فقط لأن تكلفة البضاعة محسوبة بالربح.</p>
      </>}
    </div>
  )
}
