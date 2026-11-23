import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import { fmt, weekStart } from './lib/dates'
import { Bars, groupSum } from './Charts.jsx'

const today = () => fmt(new Date())
const RANGES = {
  day: () => [today(), today()],
  week: () => [fmt(weekStart(new Date())), today()],
  month: () => { const n = new Date(); return [fmt(new Date(n.getFullYear(), n.getMonth(), 1)), today()] },
  year: () => [`${new Date().getFullYear()}-01-01`, today()]
}
const KIND = { expense: 'مصروف', purchase: 'مشتريات' }
const PLACE = { shop: 'المحل', home: 'البيت' }

export default function ExpenseReport() {
  const [[from, to], setRange] = useState(RANGES.month())
  const [rows, setRows] = useState([])

  useEffect(() => {
    supabase.from('expenses').select('*').gte('day', from).lte('day', to)
      .order('day', { ascending: false }).then(({ data }) => setRows(data || []))
  }, [from, to])

  const total = rows.reduce((s, r) => s + Number(r.amount), 0)
  const by = (f, v) => rows.filter(f).reduce((s, r) => s + Number(r.amount), 0)
  const amt = r => Number(r.amount)

  return (
    <div className="app">
      <h2>تقرير المصاريف</h2>
      <div className="tabs inner">
        {[['day', 'اليوم'], ['week', 'الأسبوع'], ['month', 'الشهر'], ['year', 'السنة']].map(([k, l]) =>
          <button key={k} onClick={() => setRange(RANGES[k]())}>{l}</button>)}
      </div>
      <div className="row2">
        <label>من <input type="date" value={from} onChange={e => setRange([e.target.value, to])} /></label>
        <label>إلى <input type="date" value={to} onChange={e => setRange([from, e.target.value])} /></label>
      </div>

      <div className="stats big">
        <div className="kpi bad"><small>إجمالي الصرف</small><b>{total.toFixed(2)} ₪</b></div>
        <div className="kpi"><small>عدد السجلات</small><b>{rows.length}</b></div>
        <div className="kpi"><small>المحل</small><b>{by(r => r.place === 'shop').toFixed(2)} ₪</b></div>
        <div className="kpi"><small>البيت</small><b>{by(r => r.place === 'home').toFixed(2)} ₪</b></div>
      </div>

      <section className="card"><h3>حسب النوع والمكان</h3>
        <Bars items={groupSum(rows, r => `${KIND[r.kind]} — ${PLACE[r.place]}`, amt)} /></section>
      <section className="card"><h3>حسب الشخص الذي صرف</h3>
        <Bars items={groupSum(rows, r => r.who, amt)} /></section>
      <section className="card"><h3>حسب سبب الصرف</h3>
        <Bars items={groupSum(rows, r => r.reason, amt).slice(0, 8)} /></section>

      <section className="cart">
        {rows.map(r => (
          <div key={r.id} className="order">
            <div className="row2"><span>{r.day} · {KIND[r.kind]} · {PLACE[r.place]}</span><b>{amt(r).toFixed(2)} ₪</b></div>
            <p>{r.who} — {r.reason}</p>
          </div>
        ))}
        {!rows.length && <p className="empty">لا توجد سجلات بهذه الفترة.</p>}
      </section>
    </div>
  )
}
