import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import { fmt } from './lib/dates'

const line = () => ({ name: '', code: '', packs: '', pieces: '', buyPack: '', buyPiece: '', sellPiece: '' })
const num = v => Number(v) || 0

// نموذج فاتورة تاجر: سعر الشراء الجديد يدخل بمتوسط مرجّح مع المخزون الحالي، والخصم يوزَّع على الأصناف
export default function SupplierInvoiceForm() {
  const [products, setProducts] = useState([])
  const [companies, setCompanies] = useState([])
  const [company, setCompany] = useState('')
  const [phone, setPhone] = useState('')
  const [day, setDay] = useState(fmt(new Date()))
  const [lines, setLines] = useState([line()])
  const [discount, setDiscount] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState({ type: '', text: '' })

  async function load() {
    const [p, i] = await Promise.all([
      supabase.from('products').select('code,name,price,cost,stock,pack_size'),
      supabase.from('supplier_invoices').select('company,supplier_phone,day').order('day', { ascending: false }).limit(300)
    ])
    setProducts(p.data || [])
    const m = new Map()
    ;(i.data || []).forEach(r => {
      if (!m.has(r.company) || (!m.get(r.company) && r.supplier_phone)) m.set(r.company, r.supplier_phone || '')
    })
    setCompanies([...m].map(([c, ph]) => ({ company: c, phone: ph })))
  }
  useEffect(() => { load() }, [])

  const known = n => products.find(p => p.name === n.trim())
  const size = l => Number(known(l.name)?.pack_size) || 12
  const pieces = l => num(l.packs) * size(l) + num(l.pieces)
  const cost = l => num(l.packs) * num(l.buyPack) + num(l.pieces) * num(l.buyPiece)
  const avgBuy = l => (pieces(l) ? cost(l) / pieces(l) : 0)

  const pickCompany = v => {
    setCompany(v)
    const hit = companies.find(c => c.company === v.trim())
    if (hit) setPhone(hit.phone)
  }

  const set = (i, k, v) => setLines(ls => ls.map((l, n) => {
    if (n !== i) return l
    const next = { ...l, [k]: v }
    const p = k === 'name' && known(v)
    if (p) { // تعبئة تلقائية بأسعار المنتج الموجود (التكلفة هنا هي المتوسط الحالي)
      const z = Number(p.pack_size) || 12
      next.buyPack = String(+(p.cost * z).toFixed(4)); next.buyPiece = String(+Number(p.cost).toFixed(4)); next.sellPiece = String(p.price)
    }
    return next
  }))

  const total = lines.reduce((s, l) => s + cost(l), 0)
  const disc = num(discount)
  const badDiscount = disc < 0 || disc > total
  const finalTotal = total - (badDiscount ? 0 : disc)
  const factor = total > 0 && !badDiscount ? finalTotal / total : 1 // نسبة الخصم الموزَّعة على الأصناف

  // التكلفة الجديدة للقطعة = متوسط مرجّح بين المخزون الحالي (بتكلفته) والكمية الجديدة (بعد الخصم)
  const newAvg = l => {
    const pcs = pieces(l)
    if (!pcs) return null
    const net = avgBuy(l) * factor
    const p = known(l.name)
    if (!p) return { net, avg: net, stock: 0 }
    const s = Math.max(Number(p.stock) || 0, 0)
    return { net, avg: (s * Number(p.cost) + pcs * net) / (s + pcs), stock: Number(p.stock) || 0 }
  }
  const diffOf = l => {
    const p = known(l.name)
    return p && pieces(l) > 0 && l.sellPiece !== '' ? { p, buy: avgBuy(l) - Number(p.cost), sell: num(l.sellPiece) - Number(p.price) } : null
  }
  const costDiff = lines.reduce((s, l) => { const d = diffOf(l); return s + (d ? d.buy * pieces(l) : 0) }, 0)
  const sign = n => (n > 0 ? '+' : '') + n.toFixed(2)
  const ready = company.trim() && !badDiscount && lines.every(l => l.name.trim() && pieces(l) > 0 && l.sellPiece !== ''
    && (num(l.packs) === 0 || l.buyPack !== '') && (num(l.pieces) === 0 || l.buyPiece !== ''))

  async function save(e) {
    e.preventDefault()
    if (saving || !ready) return
    setSaving(true); setMsg({ type: '', text: '' })
    const { data, error } = await supabase.rpc('add_supplier_invoice', {
      payload: {
        company: company.trim(), day, discount: disc, phone: phone.trim(),
        items: lines.map(l => ({
          name: l.name, code: l.code, qty: pieces(l), buy_price: avgBuy(l),
          line_total: +cost(l).toFixed(4), sell_price: num(l.sellPiece)
        }))
      }
    })
    setSaving(false)
    if (error) return setMsg({ type: 'error', text: `تعذر حفظ الفاتورة. ${error.message || ''} تأكد من الاتصال ومن تشغيل ملف store_full_setup.sql.` })
    const t = Number(data?.total ?? finalTotal)
    setMsg({ type: 'ok', text: disc > 0 ? `تم حفظ الفاتورة. الإجمالي بعد الخصم ${t.toFixed(2)} ₪` : `تم حفظ الفاتورة. الإجمالي ${t.toFixed(2)} ₪` })
    setCompany(''); setPhone(''); setDiscount(''); setLines([line()]); load()
  }

  const inp = (i, k, label, step = 'any') => (
    <label><small>{label}</small>
      <input type="number" min="0" step={step} value={lines[i][k]} onChange={e => set(i, k, e.target.value)} /></label>
  )

  return (
    <>
      <datalist id="prods">{products.map(p => <option key={p.code} value={p.name} />)}</datalist>
      <datalist id="comps">{companies.map(c => <option key={c.company} value={c.company} />)}</datalist>
      <form className="meta" onSubmit={save}>
        <input list="comps" placeholder="اسم الشركة" required value={company} onChange={e => pickCompany(e.target.value)} />
        <input type="tel" inputMode="tel" placeholder="رقم التاجر (اختياري)" value={phone} onChange={e => setPhone(e.target.value)} />
        <input type="date" required value={day} onChange={e => setDay(e.target.value)} />

        {lines.map((l, i) => {
          const d = diffOf(l), a = newAvg(l)
          return (
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
              {d && (d.buy !== 0 || d.sell !== 0) && (
                <div className="diffs">
                  <span>شراء القطعة: كان {Number(d.p.cost).toFixed(2)} ← الفرق <b className={d.buy > 0 ? 'neg' : d.buy < 0 ? 'pos' : ''}>{sign(d.buy)}</b></span>
                  <span>بيع القطعة: كان {Number(d.p.price).toFixed(2)} ← الفرق <b className={d.sell > 0 ? 'pos' : d.sell < 0 ? 'neg' : ''}>{sign(d.sell)}</b></span>
                </div>
              )}
              {a && (
                <div className="diffs">
                  {known(l.name)
                    ? <span>متوسط التكلفة النهائي للقطعة: <b>{a.avg.toFixed(2)}</b> (المخزون الحالي {Math.max(a.stock, 0)} + الجديد {pieces(l)})</span>
                    : <span>تكلفة القطعة للمنتج الجديد: <b>{a.net.toFixed(2)}</b></span>}
                  {factor < 1 && <span>بعد توزيع الخصم، سعر شراء القطعة الفعلي {a.net.toFixed(2)}</span>}
                </div>
              )}
              {lines.length > 1 && <button type="button" className="link" onClick={() => setLines(lines.filter((_, n) => n !== i))}>حذف هذا المنتج</button>}
            </div>
          )
        })}
        <button type="button" onClick={() => setLines([...lines, line()])}>+ إضافة منتج آخر للفاتورة</button>

        <div className="row2"><span>إجمالي الشراء</span><b>{total.toFixed(2)} ₪</b></div>
        <label><small>خصم مبلغ (اختياري)</small>
          <input type="number" min="0" step="0.01" placeholder="0" value={discount} onChange={e => setDiscount(e.target.value)} /></label>
        {badDiscount && <p className="error">الخصم يجب أن يكون بين 0 وإجمالي الفاتورة.</p>}
        <div className="row2"><span>الإجمالي بعد الخصم</span><b>{finalTotal.toFixed(2)} ₪</b></div>
        <div className="row2"><span>فرق التكلفة مقابل آخر سعر شراء</span><b className={costDiff > 0 ? 'neg' : costDiff < 0 ? 'pos' : ''}>{sign(costDiff)} ₪</b></div>
        {msg.text && <p className={msg.type === 'error' ? 'error' : 'notice'}>{msg.text}</p>}
        <button className="primary" disabled={saving || !ready}>{saving ? 'جارٍ الحفظ…' : 'حفظ الفاتورة'}</button>
      </form>
    </>
  )
}
