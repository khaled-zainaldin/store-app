import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import { fmt } from './lib/dates'

const line = () => ({ name: '', code: '', qty: '', buy: '', sell: '' })

export default function Suppliers() {
  const [products, setProducts] = useState([])
  const [invoices, setInvoices] = useState([])
  const [company, setCompany] = useState('')
  const [day, setDay] = useState(fmt(new Date()))
  const [lines, setLines] = useState([line()])
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  async function load() {
    const [p, i] = await Promise.all([
      supabase.from('products').select('code,name,price,cost'),
      supabase.from('supplier_invoices')
        .select('id,company,day,total,supplier_invoice_items(product_name,qty,buy_price,sell_price,old_buy_price,old_sell_price)')
        .order('day', { ascending: false }).limit(50)
    ])
    setProducts(p.data || []); setInvoices(i.data || [])
  }
  useEffect(() => { load() }, [])

  const known = n => products.find(p => p.name === n.trim())
  const set = (i, k, v) => setLines(ls => ls.map((l, n) => {
    if (n !== i) return l
    const next = { ...l, [k]: v }
    const p = k === 'name' && known(v)
    if (p) { next.buy = String(p.cost); next.sell = String(p.price) } // تعبئة تلقائية للمنتج الموجود
    return next
  }))

  const total = lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.buy) || 0), 0)
  const diffOf = l => {
    const p = known(l.name)
    return p && l.buy !== '' && l.sell !== '' ? { p, buy: Number(l.buy) - Number(p.cost), sell: Number(l.sell) - Number(p.price) } : null
  }
  const costDiff = lines.reduce((s, l) => { const d = diffOf(l); return s + (d ? d.buy * (Number(l.qty) || 0) : 0) }, 0)
  const sign = n => (n > 0 ? '+' : '') + n.toFixed(2)
  const ready = company.trim() && lines.every(l => l.name.trim() && Number(l.qty) > 0 && l.buy !== '' && l.sell !== '')

  async function save(e) {
    e.preventDefault()
    if (saving || !ready) return
    setSaving(true); setMsg('')
    const { error } = await supabase.rpc('add_supplier_invoice', {
      payload: { company, day, items: lines.map(l => ({ name: l.name, code: l.code, qty: Number(l.qty), buy_price: Number(l.buy), sell_price: Number(l.sell) })) }
    })
    setSaving(false)
    if (error) return setMsg('تعذر حفظ الفاتورة. تأكد من الاتصال ومن تشغيل ملف phase3.sql.')
    setCompany(''); setLines([line()]); load()
  }

  return (
    <div className="app">
      <h2>فواتير التجار</h2>
      <datalist id="prods">{products.map(p => <option key={p.code} value={p.name} />)}</datalist>
      <form className="meta" onSubmit={save}>
        <input placeholder="اسم الشركة" required value={company} onChange={e => setCompany(e.target.value)} />
        <input type="date" required value={day} onChange={e => setDay(e.target.value)} />

        {lines.map((l, i) => (
          <div key={i} className="sline">
            <input list="prods" placeholder="اسم المنتج" value={l.name} onChange={e => set(i, 'name', e.target.value)} />
            {l.name.trim() && !known(l.name) && (
              <input placeholder="كود المنتج الجديد (اختياري)" value={l.code} onChange={e => set(i, 'code', e.target.value)} />
            )}
            <div className="trio">
              <input type="number" min="0" step="any" placeholder="العدد" value={l.qty} onChange={e => set(i, 'qty', e.target.value)} />
              <input type="number" min="0" step="0.01" placeholder="سعر الشراء" value={l.buy} onChange={e => set(i, 'buy', e.target.value)} />
              <input type="number" min="0" step="0.01" placeholder="سعر البيع" value={l.sell} onChange={e => set(i, 'sell', e.target.value)} />
            </div>
            {(() => {
              const d = diffOf(l)
              return d && (d.buy !== 0 || d.sell !== 0) ? (
                <div className="diffs">
                  <span>الشراء: كان {Number(d.p.cost).toFixed(2)} ← الفرق <b className={d.buy > 0 ? 'neg' : d.buy < 0 ? 'pos' : ''}>{sign(d.buy)}</b></span>
                  <span>البيع: كان {Number(d.p.price).toFixed(2)} ← الفرق <b className={d.sell > 0 ? 'pos' : d.sell < 0 ? 'neg' : ''}>{sign(d.sell)}</b></span>
                </div>
              ) : null
            })()}
            {lines.length > 1 && <button type="button" className="link" onClick={() => setLines(lines.filter((_, n) => n !== i))}>حذف هذا المنتج</button>}
          </div>
        ))}
        <button type="button" onClick={() => setLines([...lines, line()])}>+ إضافة منتج آخر للفاتورة</button>

        <div className="row2"><span>إجمالي الشراء</span><b>{total.toFixed(2)} ₪</b></div>
        <div className="row2"><span>فرق التكلفة مقابل آخر سعر شراء</span><b className={costDiff > 0 ? 'neg' : costDiff < 0 ? 'pos' : ''}>{sign(costDiff)} ₪</b></div>
        {msg && <p className="error">{msg}</p>}
        <button className="primary" disabled={saving || !ready}>{saving ? 'جارٍ الحفظ…' : 'حفظ الفاتورة'}</button>
      </form>

      <section className="cart">
        {invoices.map(v => (
          <details key={v.id} className="order">
            <summary><span>{v.day} · {v.company}</span><b>{Number(v.total).toFixed(2)} ₪</b></summary>
            {v.supplier_invoice_items.map((i, n) => (
              <p key={n}>{i.product_name} × {i.qty} — شراء {i.buy_price}{i.old_buy_price != null && Number(i.old_buy_price) !== Number(i.buy_price) ? ` (كان ${i.old_buy_price})` : ''} / بيع {i.sell_price}{i.old_sell_price != null && Number(i.old_sell_price) !== Number(i.sell_price) ? ` (كان ${i.old_sell_price})` : ''}</p>
            ))}
          </details>
        ))}
        {!invoices.length && <p className="empty">ما في فواتير تجار بعد.</p>}
      </section>
    </div>
  )
}
