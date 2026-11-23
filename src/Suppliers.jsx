import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import { fmt } from './lib/dates'

const line = () => ({ name: '', code: '', packs: '', pieces: '', buyPack: '', buyPiece: '', sellPiece: '' })
const num = v => Number(v) || 0

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
      supabase.from('products').select('code,name,price,cost,pack_size'),
      supabase.from('supplier_invoices')
        .select('id,company,day,total,supplier_invoice_items(product_name,qty,buy_price,sell_price,old_buy_price,old_sell_price)')
        .order('day', { ascending: false }).limit(50)
    ])
    setProducts(p.data || []); setInvoices(i.data || [])
  }
  useEffect(() => { load() }, [])

  const known = n => products.find(p => p.name === n.trim())
  const size = l => Number(known(l.name)?.pack_size) || 12
  const pieces = l => num(l.packs) * size(l) + num(l.pieces)
  const cost = l => num(l.packs) * num(l.buyPack) + num(l.pieces) * num(l.buyPiece)
  const avgBuy = l => (pieces(l) ? cost(l) / pieces(l) : 0)

  const set = (i, k, v) => setLines(ls => ls.map((l, n) => {
    if (n !== i) return l
    const next = { ...l, [k]: v }
    const p = k === 'name' && known(v)
    if (p) { // تعبئة تلقائية لأسعار المنتج الموجود
      const z = Number(p.pack_size) || 12
      next.buyPack = String(+(p.cost * z).toFixed(4)); next.buyPiece = String(p.cost); next.sellPiece = String(p.price)
    }
    return next
  }))

  const total = lines.reduce((s, l) => s + cost(l), 0)
  const diffOf = l => {
    const p = known(l.name)
    return p && pieces(l) > 0 && l.sellPiece !== '' ? { p, buy: avgBuy(l) - Number(p.cost), sell: num(l.sellPiece) - Number(p.price) } : null
  }
  const costDiff = lines.reduce((s, l) => { const d = diffOf(l); return s + (d ? d.buy * pieces(l) : 0) }, 0)
  const sign = n => (n > 0 ? '+' : '') + n.toFixed(2)
  const ready = company.trim() && lines.every(l => l.name.trim() && pieces(l) > 0 && l.sellPiece !== ''
    && (num(l.packs) === 0 || l.buyPack !== '') && (num(l.pieces) === 0 || l.buyPiece !== ''))

  async function save(e) {
    e.preventDefault()
    if (saving || !ready) return
    setSaving(true); setMsg('')
    const { error } = await supabase.rpc('add_supplier_invoice', {
      payload: { company, day, items: lines.map(l => ({ name: l.name, code: l.code, qty: pieces(l), buy_price: avgBuy(l), sell_price: num(l.sellPiece) })) }
    })
    setSaving(false)
    if (error) return setMsg('تعذر حفظ الفاتورة. تأكد من الاتصال ومن تشغيل ملفات phase3 وphase3b.')
    setCompany(''); setLines([line()]); load()
  }

  const inp = (i, k, label, step = 'any') => (
    <label><small>{label}</small>
      <input type="number" min="0" step={step} value={lines[i][k]} onChange={e => set(i, k, e.target.value)} /></label>
  )

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
            <div className="duo">
              {inp(i, 'packs', `عدد العبوات (${size(l)} قطعة)`)}
              {inp(i, 'pieces', 'عدد القطع المنفردة')}
            </div>
            <div className="trio">
              {inp(i, 'buyPack', 'شراء العبوة', '0.01')}
              {inp(i, 'buyPiece', 'شراء القطعة', '0.01')}
              {inp(i, 'sellPiece', 'بيع القطعة', '0.01')}
            </div>
            {pieces(l) > 0 && <small className="diffs">المجموع {pieces(l)} قطعة — تكلفة السطر {cost(l).toFixed(2)} ₪</small>}
            {(() => {
              const d = diffOf(l)
              return d && (d.buy !== 0 || d.sell !== 0) ? (
                <div className="diffs">
                  <span>شراء القطعة: كان {Number(d.p.cost).toFixed(2)} ← الفرق <b className={d.buy > 0 ? 'neg' : d.buy < 0 ? 'pos' : ''}>{sign(d.buy)}</b></span>
                  <span>بيع القطعة: كان {Number(d.p.price).toFixed(2)} ← الفرق <b className={d.sell > 0 ? 'pos' : d.sell < 0 ? 'neg' : ''}>{sign(d.sell)}</b></span>
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
              <p key={n}>{i.product_name} × {i.qty} — شراء {Number(i.buy_price).toFixed(2)}{i.old_buy_price != null && Number(i.old_buy_price) !== Number(i.buy_price) ? ` (كان ${Number(i.old_buy_price).toFixed(2)})` : ''} / بيع {i.sell_price}{i.old_sell_price != null && Number(i.old_sell_price) !== Number(i.sell_price) ? ` (كان ${i.old_sell_price})` : ''}</p>
            ))}
          </details>
        ))}
        {!invoices.length && <p className="empty">ما في فواتير تجار بعد.</p>}
      </section>
    </div>
  )
}
