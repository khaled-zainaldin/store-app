import { useEffect, useMemo, useState } from 'react'
import { enqueueSale, flushQueue, getQueue, loadProducts } from './lib/offline'

const METHODS = [
  ['cash', 'نقداً'],
  ['jawwal_pay', 'جوال بي'],
  ['bank_of_palestine', 'بنك فلسطين'],
  ['palpay', 'بال باي']
]

export default function Sales({ onLogout }) {
  const [products, setProducts] = useState([])
  const [q, setQ] = useState('')
  const [cart, setCart] = useState({})
  const [customer, setCustomer] = useState({ name: '', phone: '' })
  const [method, setMethod] = useState('cash')
  const [saving, setSaving] = useState(false)
  const [pending, setPending] = useState(0)
  const [online, setOnline] = useState(navigator.onLine)

  async function sync() {
    setPending(await flushQueue())
    setProducts(await loadProducts())
  }

  useEffect(() => {
    sync()
    const up = () => { setOnline(true); sync() }
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down) }
  }, [])

  const results = useMemo(() => {
    const t = q.trim()
    if (!t) return []
    return products.filter(p => p.code === t || p.name.includes(t) || p.code.includes(t)).slice(0, 6)
  }, [q, products])

  const lines = Object.values(cart)
  const total = lines.reduce((s, l) => s + l.qty * (Number(l.price) || 0), 0)

  const add = p => { setCart(c => ({ ...c, [p.id]: { ...p, qty: (c[p.id]?.qty || 0) + 1 } })); setQ('') }
  const setQty = (id, qty) => setCart(c => {
    const n = { ...c }
    if (qty <= 0) delete n[id]; else n[id] = { ...n[id], qty }
    return n
  })

  const setPrice = (id, price) => setCart(c => ({ ...c, [id]: { ...c[id], price: price === '' ? '' : Number(price) } }))

  async function save() {
    if (saving || !lines.length || lines.some(l => l.price === '')) return
    setSaving(true)
    await enqueueSale({
      id: crypto.randomUUID(),
      customer_name: customer.name,
      customer_phone: customer.phone,
      payment_method: method,
      total,
      items: lines.map(l => ({ product_id: l.id, qty: l.qty, price: Number(l.price) }))
    })
    setCart({}); setCustomer({ name: '', phone: '' }); setMethod('cash')
    setPending((await getQueue()).length)
    await sync()
    setSaving(false)
  }

  return (
    <div className="app">
      <header>
        <strong>بيع جديد</strong>
        <span className={online ? 'badge ok' : 'badge off'}>{online ? 'متصل' : 'بدون إنترنت'}</span>
        {pending > 0 && <span className="badge wait">بانتظار الرفع: {pending}</span>}
        <button className="link" onClick={onLogout}>خروج</button>
      </header>

      <input className="search" placeholder="ابحث بالكود أو اسم المنتج" value={q} onChange={e => setQ(e.target.value)} />
      {results.map(p => (
        <button key={p.id} className="result" onClick={() => add(p)}>
          <span>{p.name} <small>{p.code}</small></span>
          <span>{p.price} ₪</span>
        </button>
      ))}

      <section className="cart">
        {lines.map(l => (
          <div key={l.id} className="line">
            <span>{l.name}</span>
            <div className="qty">
              <button onClick={() => setQty(l.id, l.qty - 1)}>−</button>
              <b>{l.qty}</b>
              <button onClick={() => setQty(l.id, l.qty + 1)}>+</button>
            </div>
            <input className="price" type="number" inputMode="decimal" min="0" step="0.01"
              aria-label="سعر البيع" value={l.price} onChange={e => setPrice(l.id, e.target.value)} />
            <span>{(l.qty * (Number(l.price) || 0)).toFixed(2)}</span>
          </div>
        ))}
        {!lines.length && <p className="empty">ابحث عن منتج وأضفه للفاتورة.</p>}
      </section>

      <section className="meta">
        <input placeholder="اسم الزبون (اختياري)" value={customer.name} onChange={e => setCustomer({ ...customer, name: e.target.value })} />
        <input placeholder="رقم الهاتف" inputMode="tel" value={customer.phone} onChange={e => setCustomer({ ...customer, phone: e.target.value })} />
        <select value={method} onChange={e => setMethod(e.target.value)}>
          {METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </section>

      <footer>
        <div className="total">الإجمالي <b>{total.toFixed(2)} ₪</b></div>
        <button className="primary" disabled={saving || !lines.length} onClick={save}>
          {saving ? 'جارٍ الحفظ…' : 'حفظ الفاتورة'}
        </button>
      </footer>
    </div>
  )
}
