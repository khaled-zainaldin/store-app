import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import { fmt } from './lib/dates'

const line = () => ({ name: '', code: '', packs: '', pieces: '', buyPack: '', buyPiece: '', sellPiece: '' })
const num = v => Number(v) || 0

// نموذج إضافة فاتورة تاجر (حسابات الأصناف مثل السابق بدون أي تغيير) + رقم التاجر + خصم مبلغ
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
      supabase.from('products').select('code,name,price,cost,pack_size'),
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
    if (p) { // تعبئة تلقائية لأسعار المنتج الموجود
      const z = Number(p.pack_size) || 12
      next.buyPack = String(+(p.cost * z).toFixed(4)); next.buyPiece = String(p.cost); next.sellPiece = String(p.price)
    }
    return next
  }))

  const total = lines.reduce((s, l) => s + cost(l), 0)
  const disc = num(discount)
  const badDiscount = disc < 0 || disc > total
  const finalTotal = total - (badDiscount ? 0 : disc)
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
    const name = company.trim()
    const idsNow = async () => {
      const { data } = await supabase.from('supplier_invoices').select('id').eq('company', name).eq('day', day)
      return (data || []).map(r => String(r.id))
    }
    const before = await idsNow()

    const { error } = await supabase.rpc('add_supplier_invoice', {
      payload: { company: name, day, items: lines.map(l => ({ name: l.name, code: l.code, qty: pieces(l), buy_price: avgBuy(l), sell_price: num(l.sellPiece) })) }
    })
    if (error) {
      setSaving(false)
      return setMsg({ type: 'error', text: 'تعذر حفظ الفاتورة. تأكد من الاتصال ومن تشغيل ملفات phase3 وphase3b.' })
    }

    // الفاتورة انحفظت. الآن نطبّق الخصم ورقم التاجر عليها (الخصم يُحسب من إجمالي الفاتورة المحفوظ فعلاً)
    let text = `تم حفظ الفاتورة. الإجمالي ${finalTotal.toFixed(2)} ₪`
    let type = 'ok'
    if (disc > 0 || phone.trim()) {
      const id = (await idsNow()).find(x => !before.includes(x))
      let e2 = null
      if (id) {
        const r = await supabase.rpc('set_supplier_invoice_extras', { p_id: id, p_discount: disc > 0 ? disc : null, p_phone: phone.trim() || null })
        e2 = r.error
        if (!e2 && r.data != null) text = `تم حفظ الفاتورة. الإجمالي بعد الخصم ${Number(r.data).toFixed(2)} ₪`
      }
      if (!id || e2) {
        type = 'error'
        text = 'تم حفظ الفاتورة لكن لم يُطبَّق الخصم/رقم التاجر. افتح صفحة «التجار» وعدّلهما من الفاتورة (وتأكد من تشغيل ملف update_nov25.sql).'
      }
    }
    setSaving(false)
    setMsg({ type, text })
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
