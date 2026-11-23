import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'

const empty = { code: '', name: '', price: '', cost: '', stock: '', pack_size: '12' }

export default function Products() {
  const [rows, setRows] = useState([])
  const [f, setF] = useState(empty)
  const [msg, setMsg] = useState('')
  const [sold, setSold] = useState({})
  const [bySold, setBySold] = useState(false)

  const load = async () => {
    const [{ data }, { data: sales }] = await Promise.all([
      supabase.from('products').select('*').order('name'),
      supabase.from('product_sales').select('product_id,sold,returned')
    ])
    setRows(data || [])
    setSold(Object.fromEntries((sales || []).map(x => [x.product_id, Number(x.sold) - Number(x.returned)])))
  }
  useEffect(() => { load() }, [])

  async function add(e) {
    e.preventDefault()
    const { error } = await supabase.from('products').insert({
      code: f.code.trim(), name: f.name.trim(),
      price: Number(f.price), cost: Number(f.cost) || 0, stock: Number(f.stock) || 0, pack_size: Number(f.pack_size) || 12
    })
    if (error) return setMsg(error.message.includes('duplicate') ? 'هذا الكود مستخدم لمنتج آخر' : 'تعذر حفظ المنتج')
    setF(empty); setMsg(''); load()
  }

  async function update(id, field, value) {
    await supabase.from('products').update({ [field]: Number(value) }).eq('id', id)
    load()
  }

  const soldOf = p => sold[p.id] || 0
  const view = bySold ? [...rows].sort((a, b) => soldOf(b) - soldOf(a)) : rows
  const soldProducts = rows.filter(p => soldOf(p) > 0).length
  const soldTotal = rows.reduce((t, p) => t + soldOf(p), 0)

  const bind = k => ({ value: f[k], onChange: e => setF({ ...f, [k]: e.target.value }) })

  return (
    <div className="app">
      <h2>المنتجات</h2>
      <form className="meta" onSubmit={add}>
        <input placeholder="كود المنتج" required {...bind('code')} />
        <input placeholder="اسم المنتج" required {...bind('name')} />
        <input placeholder="سعر بيع القطعة" type="number" step="0.01" required {...bind('price')} />
        <input placeholder="سعر تكلفة القطعة" type="number" step="0.01" {...bind('cost')} />
        <input placeholder="الكمية بالمخزون (بالقطع)" type="number" {...bind('stock')} />
        <input placeholder="عدد القطع بالعبوة (مثلاً 12)" type="number" min="1" {...bind('pack_size')} />
        {msg && <p className="error">{msg}</p>}
        <button className="primary">إضافة منتج</button>
      </form>

      <div className="stats">
        <div><small>منتجات تم بيعها</small><b>{soldProducts} من {rows.length}</b></div>
        <div><small>إجمالي القطع المباعة</small><b>{soldTotal}</b></div>
      </div>
      <button className="link" onClick={() => setBySold(!bySold)}>{bySold ? 'ترتيب بالاسم' : 'ترتيب حسب الأكثر مبيعاً'}</button>

      <section className="cart">
        {view.map(p => (
          <div key={p.id + p.price + p.cost + p.stock + p.pack_size} className="prow">
            <b>{p.name} <small>{p.code}</small></b>
            <small className="soldline">تم بيع {soldOf(p)} قطعة</small>
            {[['price', 'بيع القطعة'], ['cost', 'تكلفة القطعة'], ['stock', 'المخزون'], ['pack_size', 'قطع بالعبوة']].map(([k, l]) => (
              <label key={k}>{l}
                <input type="number" step="0.01" defaultValue={p[k]}
                  onBlur={e => e.target.value !== String(p[k]) && update(p.id, k, e.target.value)} />
              </label>
            ))}
          </div>
        ))}
        {!rows.length && <p className="empty">ما في منتجات بعد. أضف أول منتج من الأعلى.</p>}
      </section>
    </div>
  )
}
