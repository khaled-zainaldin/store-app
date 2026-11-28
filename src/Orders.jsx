import { useEffect, useMemo, useState } from 'react'
import { supabase } from './lib/supabase'
import { fmt, weekStart } from './lib/dates'
import { fetchAll } from './lib/fetchAll'
import { METHOD, saleProfit, returnProfit } from './lib/reports'

const PERIODS = [['day', 'اليوم'], ['week', 'الأسبوع'], ['month', 'الشهر']]
const startOf = p => {
  const n = new Date()
  if (p === 'week') return weekStart(n)
  if (p === 'month') return new Date(n.getFullYear(), n.getMonth(), 1)
  return new Date(n.getFullYear(), n.getMonth(), n.getDate())
}

const retQty = (r, pid) => r.sale_returns.flatMap(x => x.sale_return_items)
  .filter(i => i.product_id === pid).reduce((s, i) => s + Number(i.qty), 0)
const retTotal = r => r.sale_returns.reduce((s, x) => s + Number(x.total), 0)
const netTotal = r => Number(r.total) - retTotal(r)
// ربح الفاتورة بعد خصم ما أُرجع منها (بتكلفة وقت البيع)
const profitOf = r => saleProfit(r) - r.sale_returns.reduce((s, x) => s + returnProfit(x), 0)

function ReturnForm({ sale, onDone }) {
  const [qty, setQty] = useState({})
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const lines = sale.sale_items.map(i => ({ ...i, left: Number(i.qty) - retQty(sale, i.product_id) })).filter(i => i.left > 0)
  const refund = lines.reduce((s, i) => s + (Number(qty[i.product_id]) || 0) * Number(i.price), 0)

  async function submit() {
    if (saving || refund <= 0) return
    setSaving(true); setErr('')
    const { error } = await supabase.rpc('submit_return', {
      payload: { sale_id: sale.id, note, items: lines.map(i => ({ product_id: i.product_id, qty: Number(qty[i.product_id]) || 0 })) }
    })
    setSaving(false)
    if (error) return setErr('تعذر تنفيذ المرتجع. تأكد من الكميات ومن تشغيل ملف store_full_setup.sql.')
    onDone()
  }

  if (!lines.length) return <p>كل أصناف هذه الفاتورة مرتجعة بالكامل.</p>
  return (
    <div className="retform">
      {lines.map(i => (
        <label key={i.product_id} className="row2">
          <span>{i.products?.name} (المتاح للإرجاع {i.left} بسعر {i.price})</span>
          <input type="number" min="0" max={i.left} step="any" placeholder="0" value={qty[i.product_id] || ''}
            onChange={e => setQty({ ...qty, [i.product_id]: Math.min(i.left, Math.max(0, Number(e.target.value))) || '' })} />
        </label>
      ))}
      <input placeholder="سبب الإرجاع (اختياري)" value={note} onChange={e => setNote(e.target.value)} />
      <div className="row2"><span>المبلغ المسترد للزبون</span><b>{refund.toFixed(2)} ₪</b></div>
      {err && <p className="error">{err}</p>}
      <button className="primary" disabled={saving || refund <= 0} onClick={submit}>{saving ? 'جارٍ الحفظ…' : 'تأكيد الإرجاع'}</button>
    </div>
  )
}

export default function Orders() {
  const [rows, setRows] = useState([])
  const [view, setView] = useState('sales')
  const [q, setQ] = useState('')
  const [period, setPeriod] = useState('day')
  const [dateVal, setDateVal] = useState('')
  const [open, setOpen] = useState(null)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)

  // الفترة: اليوم/الأسبوع/الشهر، أو يوم محدد من التقويم
  const range = () => {
    if (period === 'date' && dateVal) {
      const [y, m, d] = dateVal.split('-').map(Number)
      return [new Date(y, m - 1, d), new Date(y, m - 1, d + 1)]
    }
    return [startOf(period), null]
  }

  const load = () => {
    const [s, e] = range()
    setLoading(true); setErr('')
    return fetchAll(() => {
      let qy = supabase.from('sales')
        .select('id,total,payment_method,created_at,profiles(name),customers(name,phone),sale_items(product_id,qty,price,cost,products(name,cost)),sale_returns(total,created_at,note,sale_return_items(product_id,qty,price,cost,products(cost)))')
        .gte('created_at', s.toISOString())
      if (e) qy = qy.lt('created_at', e.toISOString())
      return qy.order('created_at', { ascending: false }).order('id')
    }).then(setRows).catch(() => setErr('تعذر تحميل المبيعات. تأكد من الاتصال ومن تشغيل ملف store_full_setup.sql.'))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [period, dateVal])

  const pickPeriod = k => { setDateVal(''); setPeriod(k) }
  const pickDate = v => { setDateVal(v); setPeriod(v ? 'date' : 'day') }

  const match = r => {
    const t = q.trim()
    return !t || (r.customers?.name || '').includes(t) || (r.customers?.phone || '').includes(t)
  }
  const periodTotal = rows.reduce((s, r) => s + netTotal(r), 0)
  const periodReturns = rows.reduce((s, r) => s + retTotal(r), 0)
  const periodProfit = rows.reduce((s, r) => s + profitOf(r), 0)

  // الربح اليومي: مبيعات وربح كل يوم ضمن الفترة
  const days = useMemo(() => {
    const m = {}
    rows.forEach(r => {
      const k = fmt(new Date(r.created_at))
      const g = (m[k] ??= { day: k, count: 0, net: 0, profit: 0 })
      g.count += 1; g.net += netTotal(r); g.profit += profitOf(r)
    })
    return Object.values(m).sort((a, b) => b.day.localeCompare(a.day))
  }, [rows])

  const customers = useMemo(() => {
    const m = {}
    rows.filter(r => r.customers).forEach(r => {
      const c = r.customers, k = c.phone || c.name
      m[k] ??= { name: c.name, phone: c.phone, total: 0, orders: [] }
      m[k].total += netTotal(r)
      m[k].orders.push(r)
    })
    return Object.values(m).filter(c => match({ customers: c })).sort((a, b) => b.total - a.total)
  }, [rows, q])

  const items = r => r.sale_items.map((i, n) => {
    const back = retQty(r, i.product_id)
    return <p key={n}>{i.products?.name} × {i.qty} بسعر {i.price}{back > 0 && <b className="neg"> (مرتجع {back})</b>}</p>
  })

  return (
    <div className="app">
      <h2>المبيعات</h2>
      <div className="tabs inner">
        {PERIODS.map(([k, l]) => <button key={k} className={period === k ? 'on' : ''} onClick={() => pickPeriod(k)}>{l}</button>)}
      </div>
      <label className="row2">
        <span>بحث بتاريخ محدد</span>
        <input type="date" value={dateVal} max={fmt(new Date())} onChange={e => pickDate(e.target.value)} />
      </label>
      {err && <p className="error">{err}</p>}
      <div className="stats big">
        <div className="kpi"><small>عدد الفواتير</small><b>{rows.length}</b></div>
        <div className="kpi"><small>صافي المبيعات</small><b>{periodTotal.toFixed(2)} ₪</b></div>
        <div className={'kpi ' + (periodProfit >= 0 ? 'good' : 'bad')}><small>ربح المبيعات</small><b>{periodProfit.toFixed(2)} ₪</b></div>
        <div className="kpi"><small>المرتجعات</small><b>{periodReturns.toFixed(2)} ₪</b></div>
      </div>

      {days.length > 0 && (
        <section className="card"><h3>الربح اليومي</h3>
          {days.map(g => (
            <div key={g.day} className="row2">
              <span>{g.day} · {g.count} فاتورة · مبيعات {g.net.toFixed(2)}</span>
              <b className={g.profit >= 0 ? 'pos' : 'neg'}>{g.profit.toFixed(2)} ₪</b>
            </div>
          ))}
        </section>
      )}
      <p className="sub">الربح = سعر البيع − تكلفة القطعة وقت البيع، بعد خصم المرتجعات. هذه قبل مصاريف المحل والرواتب (انظر «الرئيسية»).</p>

      <div className="tabs inner">
        <button className={view === 'sales' ? 'on' : ''} onClick={() => setView('sales')}>الفواتير</button>
        <button className={view === 'cust' ? 'on' : ''} onClick={() => setView('cust')}>الزبائن</button>
      </div>
      <input placeholder="ابحث باسم الزبون أو رقمه" value={q} onChange={e => setQ(e.target.value)} />

      <section className="cart">
        {view === 'sales' && rows.filter(match).map(r => (
          <details key={r.id} className="order">
            <summary>
              <span>{new Date(r.created_at).toLocaleDateString('ar')} · {r.customers?.name || 'زبون غير مسجل'}{r.customers?.phone ? ` · ${r.customers.phone}` : ''}{retTotal(r) > 0 && ' · فيها مرتجع'}</span>
              <b>{netTotal(r).toFixed(2)} ₪</b>
            </summary>
            <p>الموظف: {r.profiles?.name || '—'} · الدفع: {METHOD[r.payment_method] || r.payment_method}</p>
            {items(r)}
            <p>ربح الفاتورة: <b className={profitOf(r) >= 0 ? 'pos' : 'neg'}>{profitOf(r).toFixed(2)} ₪</b></p>
            {r.sale_returns.map((x, n) => <p key={n} className="neg">مرتجع {Number(x.total).toFixed(2)} ₪ بتاريخ {new Date(x.created_at).toLocaleDateString('ar')}{x.note ? ` — ${x.note}` : ''}</p>)}
            {open === r.id
              ? <ReturnForm sale={r} onDone={() => { setOpen(null); load() }} />
              : <button className="link" onClick={() => setOpen(r.id)}>إرجاع بضاعة</button>}
          </details>
        ))}

        {view === 'cust' && customers.map(c => (
          <details key={c.phone || c.name} className="order">
            <summary><span>{c.name}{c.phone ? ` · ${c.phone}` : ' · بدون رقم'}</span><b>{c.total.toFixed(2)} ₪</b></summary>
            {c.orders.map(r => (
              <div key={r.id}>
                <p><b>{new Date(r.created_at).toLocaleDateString('ar')}</b> — {netTotal(r).toFixed(2)} ₪</p>
                {items(r)}
              </div>
            ))}
          </details>
        ))}
        {loading && <p className="empty">جارٍ التحميل…</p>}
        {!loading && !rows.length && !err && <p className="empty">ما في مبيعات بهذه الفترة.</p>}
      </section>
    </div>
  )
}
