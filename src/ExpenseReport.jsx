import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import { fmt, weekStart } from './lib/dates'
import { Bars, groupSum } from './Charts.jsx'
import { loadPeriod, buildFullReport } from './lib/reports'

const today = () => fmt(new Date())
const RANGES = {
  day: () => [today(), today()],
  week: () => [fmt(weekStart(new Date())), today()],
  month: () => { const n = new Date(); return [fmt(new Date(n.getFullYear(), n.getMonth(), 1)), today()] },
  year: () => [`${new Date().getFullYear()}-01-01`, today()]
}
const KIND = { expense: 'مصروف', purchase: 'مشتريات' }
const PLACE = { shop: 'المحل', home: 'البيت' }
const m2 = v => Number(v || 0).toFixed(2)

export default function ExpenseReport() {
  const [[from, to], setRange] = useState(RANGES.month())
  const [rows, setRows] = useState([])
  const [data, setData] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    let off = false
    supabase.from('expenses').select('*').gte('day', from).lte('day', to)
      .order('day', { ascending: false }).then(({ data }) => !off && setRows(data || []))
    setData(null); setErr('')
    loadPeriod(from, to).then(d => !off && setData(d))
      .catch(() => !off && setErr('تعذر حساب الأرباح للفترة. تأكد من تشغيل ملف store_full_setup.sql.'))
    return () => { off = true }
  }, [from, to])

  async function download() {
    setBusy(true); setErr('')
    try { await buildFullReport(from, to, data) } catch { setErr('تعذر إنشاء الملف.') }
    setBusy(false)
  }

  const total = rows.reduce((s, r) => s + Number(r.amount), 0)
  const by = (f, v) => rows.filter(f).reduce((s, r) => s + Number(r.amount), 0)
  const amt = r => Number(r.amount)
  const sm = data?.sm

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
      {err && <p className="error">{err}</p>}
      <button className="primary" disabled={busy || !data} onClick={download}>{busy ? 'جارٍ التجهيز…' : 'تنزيل التقرير الشامل (Excel)'}</button>
      <p className="sub">الملف يشمل: ملخص الأرباح، مصاريف المحل، مصاريف البيت، فواتير كل تاجر، المبيعات، التالف والمسروق، ورواتب العمال.</p>

      {sm && (
        <section className="card"><h3>ملخص الفترة</h3>
          <div className="row2"><span>صافي المبيعات ({sm.count} فاتورة)</span><b>{m2(sm.revenue)} ₪</b></div>
          <div className="row2"><span>ربح المبيعات</span><b className="pos">{m2(sm.gross)} ₪</b></div>
          <div className="row2"><span>مصاريف المحل</span><b>{m2(sm.shopExp)} ₪</b></div>
          <div className="row2"><span>رواتب العمال</span><b>{m2(sm.salaries)} ₪</b></div>
          <div className="row2"><span>خسائر التالف والمسروق</span><b>{m2(sm.lossTotal)} ₪</b></div>
          <div className="row2"><span><b>صافي ربح المحل</b></span><b className={sm.netShop >= 0 ? 'pos' : 'neg'}>{m2(sm.netShop)} ₪</b></div>
          <div className="row2"><span>مصاريف البيت</span><b>{m2(sm.homeTotal)} ₪</b></div>
          <div className="row2"><span><b>المتبقي بعد مصاريف البيت</b></span><b className={sm.afterHome >= 0 ? 'pos' : 'neg'}>{m2(sm.afterHome)} ₪</b></div>
        </section>
      )}

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
