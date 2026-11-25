import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'

const fmtDate = d => new Date(d).toLocaleString('ar-u-nu-latn', { dateStyle: 'medium', timeStyle: 'short' })

function ReturnForm({ sale, onDone }) {
  const [qty, setQty] = useState({})
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const lines = sale.items
    .map(i => ({ ...i, left: Number(i.sold) - Number(i.returned) }))
    .filter(i => i.left > 0)
  const refund = lines.reduce((s, i) => s + (Number(qty[i.product_id]) || 0) * Number(i.price), 0)

  async function submit() {
    if (saving || refund <= 0) return
    setSaving(true); setErr('')
    const items = lines
      .map(i => ({ product_id: i.product_id, qty: Number(qty[i.product_id]) || 0 }))
      .filter(i => i.qty > 0)
    const { data, error } = await supabase.rpc('submit_return', { payload: { sale_id: sale.id, note, items } })
    setSaving(false)
    if (error) return setErr(error.message || 'تعذر تنفيذ المرتجع. تأكد من الاتصال بالإنترنت.')
    onDone(Number(data?.total ?? refund))
  }

  if (!lines.length) return <p>كل أصناف هذه الفاتورة مرتجعة بالكامل.</p>
  return (
    <div className="retform">
      {lines.map(i => (
        <label key={i.product_id} className="row2">
          <span>{i.name} (المتاح للإرجاع {i.left} بسعر {Number(i.price).toFixed(2)})</span>
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

export default function Returns({ onLogout }) {
  const [q, setQ] = useState('')
  const [sales, setSales] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const t = q.trim()
    if (t.length < 2) { setSales([]); setLoading(false); setError(''); return }
    let cancelled = false
    setLoading(true)
    const h = setTimeout(async () => {
      const { data, error } = await supabase.rpc('find_sales_for_return', { q: t })
      if (cancelled) return
      setLoading(false)
      if (error) return setError('تعذر البحث. تأكد من اتصال الإنترنت.')
      setError(''); setSales(data || [])
    }, 350)
    return () => { cancelled = true; clearTimeout(h) }
  }, [q, tick])

  return (
    <div className="app">
      <header>
        <strong>إرجاع منتجات</strong>
        <button className="link" onClick={onLogout}>خروج</button>
      </header>

      <input className="search" placeholder="ابحث باسم الزبون أو رقم هاتفه" value={q}
        onChange={e => { setQ(e.target.value); setDone('') }} />
      {done && <p className="notice">{done}</p>}
      {error && <p className="error">{error}</p>}
      {loading && <p className="empty">جارٍ البحث…</p>}
      {!loading && !error && q.trim().length >= 2 && !sales.length && (
        <p className="empty">لا توجد فواتير بهذا الاسم. يظهر فقط الزبائن الذين كُتب اسمهم وقت البيع.</p>
      )}

      <section className="cart">
        {sales.map(s => (
          <details key={s.id} className="order">
            <summary>
              <span>{s.customer_name}{s.customer_phone ? ` · ${s.customer_phone}` : ''} · {fmtDate(s.created_at)}</span>
              <b>{Number(s.total).toFixed(2)} ₪</b>
            </summary>
            <ReturnForm key={s.id + ':' + s.items.map(i => i.returned).join(',')} sale={s} onDone={total => { setDone(`تم تسجيل المرتجع، قيمة الإرجاع ${total.toFixed(2)} ₪`); setTick(t => t + 1) }} />
          </details>
        ))}
      </section>
    </div>
  )
}
