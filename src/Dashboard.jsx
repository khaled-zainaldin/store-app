import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import { fmt, weekStart } from './lib/dates'

const startOf = p => {
  const n = new Date()
  if (p === 'week') return weekStart(n)
  if (p === 'month') return new Date(n.getFullYear(), n.getMonth(), 1)
  return new Date(n.getFullYear(), n.getMonth(), n.getDate())
}

export default function Dashboard() {
  const [p, setP] = useState('day')
  const [d, setD] = useState(null)

  useEffect(() => {
    const s = startOf(p)
    Promise.all([
      supabase.from('sales').select('total,sale_items(qty,price,products(cost))').gte('created_at', s.toISOString()),
      supabase.from('expenses').select('kind,place,amount').gte('day', fmt(s))
    ]).then(([sa, ex]) => {
      const sales = sa.data || [], exp = ex.data || []
      const revenue = sales.reduce((t, x) => t + Number(x.total), 0)
      const gross = sales.reduce((t, x) => t + x.sale_items.reduce((u, i) => u + i.qty * (i.price - (i.products?.cost || 0)), 0), 0)
      const sum = (kind, place) => exp.filter(e => e.kind === kind && e.place === place).reduce((t, e) => t + Number(e.amount), 0)
      setD({ count: sales.length, revenue, gross, shopExp: sum('expense', 'shop'), homeExp: sum('expense', 'home'),
        shopBuy: sum('purchase', 'shop'), homeBuy: sum('purchase', 'home') })
    })
  }, [p])

  const c = (l, v, cls = '') => <div className={cls}><small>{l}</small><b>{Number(v).toFixed(2)}</b></div>

  return (
    <div className="app">
      <h2>اللوحة الرئيسية</h2>
      <div className="tabs inner">
        {[['day', 'اليوم'], ['week', 'الأسبوع'], ['month', 'الشهر']].map(([k, l]) =>
          <button key={k} className={p === k ? 'on' : ''} onClick={() => setP(k)}>{l}</button>)}
      </div>
      {d && <>
        <div className="stats big">
          <div><small>عدد الفواتير</small><b>{d.count}</b></div>
          {c('المبيعات', d.revenue)}
          {c('ربح المبيعات', d.gross, 'good')}
          {c('صافي بعد مصاريف المحل', d.gross - d.shopExp, d.gross - d.shopExp >= 0 ? 'good' : 'bad')}
        </div>
        <div className="stats">
          {c('مصاريف المحل', d.shopExp)}{c('مصاريف البيت', d.homeExp)}
          {c('مشتريات المحل', d.shopBuy)}{c('مشتريات البيت', d.homeBuy)}
        </div>
        <p className="empty">ربح المبيعات = سعر البيع − سعر التكلفة. الصافي هنا قبل رواتب العمال، والمشتريات معروضة للمعرفة ولا تُخصم لأن تكلفتها محسوبة بالفعل.</p>
      </>}
    </div>
  )
}
