import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import { fmt, weekStart, addDays } from './lib/dates'
import { fetchAll } from './lib/fetchAll'
import { itemProfit, METHOD } from './lib/reports'
import { Bars, Cols, groupSum } from './Charts.jsx'

const startOf = p => {
  const n = new Date()
  if (p === 'week') return weekStart(n)
  if (p === 'month') return new Date(n.getFullYear(), n.getMonth(), 1)
  return new Date(n.getFullYear(), n.getMonth(), n.getDate())
}
const num = v => Number(v) || 0
const sum = (a, f) => a.reduce((t, x) => t + f(x), 0)

export default function Dashboard() {
  const [p, setP] = useState('week')
  const [d, setD] = useState(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    let off = false
    const s = startOf(p), sISO = s.toISOString(), sDay = fmt(s), today = fmt(new Date())
    const lastWeek = fmt(addDays(weekStart(new Date()), -7))
    setD(null); setErr('')
    Promise.all([
      fetchAll(() => supabase.from('sales').select('id,total,payment_method,created_at,sale_items(qty,price,cost,products(name,cost))').gte('created_at', sISO).order('created_at').order('id')),
      fetchAll(() => supabase.from('expenses').select('id,kind,place,amount').gte('day', sDay).lte('day', today).order('id')),
      fetchAll(() => supabase.from('products').select('id,name,stock,cost,price,archived').order('id')),
      fetchAll(() => supabase.from('sale_returns').select('id,total,created_at,sale_return_items(qty,price,cost,products(cost))').gte('created_at', sISO).order('id')),
      supabase.from('product_losses').select('qty,cost').gte('day', sDay).lte('day', today),
      supabase.from('worker_payroll').select('earned').gte('week_end', sDay).lte('week_end', today),
      supabase.from('worker_payroll').select('id', { count: 'exact', head: true }).eq('week_start', lastWeek),
      supabase.from('workers').select('id', { count: 'exact', head: true }).eq('active', true)
    ]).then(([sales, exp, prodsAll, rets, lossRes, payRes, lastRes, wkRes]) => {
      if (off) return
      const prods = prodsAll.filter(x => !x.archived)
      const setupMissing = !!(lossRes.error || payRes.error)
      const losses = lossRes.data || [], payroll = payRes.data || []
      const items = sales.flatMap(x => x.sale_items)
      const retTotal = sum(rets, r => num(r.total))
      const retGross = sum(rets.flatMap(r => r.sale_return_items), itemProfit)
      const revenue = sum(sales, x => num(x.total)) - retTotal
      const gross = sum(items, itemProfit) - retGross
      const total = (kind, place) => sum(exp.filter(e => e.kind === kind && (!place || e.place === place)), e => num(e.amount))
      const shopExp = total('expense', 'shop')
      const homeAll = sum(exp.filter(e => e.place === 'home'), e => num(e.amount))
      const salaries = sum(payroll, x => num(x.earned))
      const lossTotal = sum(losses, l => num(l.qty) * num(l.cost))
      const netShop = gross - shopExp - salaries - lossTotal

      const byDay = {}
      sales.forEach(x => { const k = fmt(new Date(x.created_at)); byDay[k] = (byDay[k] || 0) + num(x.total) })
      rets.forEach(r => { const k = fmt(new Date(r.created_at)); byDay[k] = (byDay[k] || 0) - num(r.total) })
      const cols = []
      for (let t = new Date(s), n = 0; t <= new Date(); t = addDays(t, 1), n++) {
        const k = fmt(t)
        cols.push({ value: Math.max(0, byDay[k] || 0), title: k, label: p === 'month' && n % 5 ? '' : String(t.getDate()) })
      }

      const stocked = prods.filter(x => num(x.stock) > 0)
      setD({
        count: sales.length, retTotal, revenue, gross, shopExp, salaries, lossTotal, netShop,
        homeAll, afterHome: netShop - homeAll, cols, setupMissing,
        payrollDue: !wkRes.error && !lastRes.error && num(wkRes.count) > 0 && num(lastRes.count) === 0,
        capital: sum(stocked, x => num(x.stock) * num(x.cost)),
        capitalSell: sum(stocked, x => num(x.stock) * num(x.price)),
        noCost: stocked.filter(x => num(x.cost) <= 0).length,
        negStock: prods.filter(x => num(x.stock) < 0).length,
        pay: groupSum(sales, x => METHOD[x.payment_method] || x.payment_method, x => num(x.total)),
        top: groupSum(items, i => i.products?.name || '—', i => i.qty * i.price).slice(0, 5),
        exp: [
          { label: 'مصاريف المحل', value: shopExp }, { label: 'مصاريف البيت', value: homeAll },
          { label: 'رواتب العمال', value: salaries }, { label: 'خسائر التالف', value: lossTotal },
          { label: 'مشتريات المحل', value: total('purchase', 'shop') }
        ],
        low: prods.filter(x => num(x.stock) <= 5).sort((a, b) => num(a.stock) - num(b.stock)).slice(0, 8)
      })
    }).catch(() => !off && setErr('تعذر تحميل اللوحة. تأكد من الاتصال ومن تشغيل ملف store_full_setup.sql في Supabase.'))
    return () => { off = true }
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
      {err && <p className="error">{err}</p>}
      {!d && !err && <p className="empty">جارٍ التحميل…</p>}

      {d && <>
        {d.setupMissing && <p className="warnbox">لم تظهر الخسائر والرواتب لأن الجداول الجديدة غير موجودة. شغّل ملف store_full_setup.sql في Supabase.</p>}
        {d.payrollDue && <p className="warnbox">رواتب الأسبوع الماضي لم تُغلق بعد، فلم تُخصم من الأرباح. افتح صفحة «العمال» واضغط «إغلاق الأسبوع» للأسبوع الماضي.</p>}

        <div className="stats big">
          {kpi('عدد الفواتير', d.count, '', false)}
          {kpi('صافي المبيعات', d.revenue)}
          {kpi('ربح المبيعات', d.gross, 'good')}
          {kpi('مصاريف المحل', d.shopExp)}
          {kpi('رواتب العمال', d.salaries)}
          {kpi('خسائر التالف والمسروق', d.lossTotal, d.lossTotal > 0 ? 'bad' : '')}
          {kpi('صافي ربح المحل', d.netShop, d.netShop >= 0 ? 'good' : 'bad')}
          {kpi('مصاريف البيت', d.homeAll)}
          {kpi('المتبقي بعد مصاريف البيت', d.afterHome, d.afterHome >= 0 ? 'good' : 'bad')}
        </div>

        {d.retTotal > 0 && <p className="empty">الأرقام بعد خصم مرتجعات بقيمة {d.retTotal.toFixed(2)} ₪</p>}

        <section className="card"><h3>رأس مال البضاعة الموجودة</h3>
          <div className="row2"><span>بسعر الشراء (متوسط التكلفة × المخزون)</span><b>{d.capital.toFixed(2)} ₪</b></div>
          <div className="row2"><span>بسعر البيع المتوقع</span><b>{d.capitalSell.toFixed(2)} ₪</b></div>
          {d.noCost > 0 && <p className="sub neg">تنبيه: {d.noCost} منتج في المخزون بدون سعر تكلفة، فرأس المال أقل من الحقيقي.</p>}
          {d.negStock > 0 && <p className="sub neg">تنبيه: {d.negStock} منتج مخزونه بالسالب (بيع أكثر من المسجّل). صحّح مخزونها.</p>}
        </section>

        {p !== 'day' && <section className="card"><h3>المبيعات اليومية</h3><Cols items={d.cols} /></section>}
        <section className="card"><h3>أكثر المنتجات مبيعاً</h3><Bars items={d.top} /></section>
        <section className="card"><h3>طرق الدفع</h3><Bars items={d.pay} /></section>
        <section className="card"><h3>المصاريف والمشتريات</h3><Bars items={d.exp} /></section>
        {d.low.length > 0 && (
          <section className="card warn"><h3>مخزون منخفض</h3>
            {d.low.map(x => <p key={x.id} className="row2"><span>{x.name}</span><b>{x.stock}</b></p>)}
          </section>
        )}
        <p className="empty">
          صافي ربح المحل = ربح المبيعات − مصاريف المحل − رواتب العمال (الأسابيع المغلقة) − خسائر التالف والمسروق.
          مصاريف البيت تُعرض بشكل مستقل ولا تدخل في ربح المحل. مشتريات المحل (البضاعة) للعرض فقط لأن تكلفتها محسوبة داخل الربح.
        </p>
      </>}
    </div>
  )
}
