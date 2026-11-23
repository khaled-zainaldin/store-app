import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'

const empty = { code: '', name: '', price: '', cost: '', stock: '' }

export default function Products() {
  const [rows, setRows] = useState([])
  const [f, setF] = useState(empty)
  const [msg, setMsg] = useState('')

  const load = async () => {
    const { data } = await supabase.from('products').select('*').order('name')
    setRows(data || [])
  }
  useEffect(() => { load() }, [])

  async function add(e) {
    e.preventDefault()
    const { error } = await supabase.from('products').insert({
      code: f.code.trim(), name: f.name.trim(),
      price: Number(f.price), cost: Number(f.cost) || 0, stock: Number(f.stock) || 0
    })
    if (error) return setMsg(error.message.includes('duplicate') ? 'هذا الكود مستخدم لمنتج آخر' : 'تعذر حفظ المنتج')
    setF(empty); setMsg(''); load()
  }

  async function update(id, field, value) {
    await supabase.from('products').update({ [field]: Number(value) }).eq('id', id)
    load()
  }

  const bind = k => ({ value: f[k], onChange: e => setF({ ...f, [k]: e.target.value }) })

  return (
    <div className="app">
      <h2>المنتجات</h2>
      <form className="meta" onSubmit={add}>
        <input placeholder="كود المنتج" required {...bind('code')} />
        <input placeholder="اسم المنتج" required {...bind('name')} />
        <input placeholder="سعر البيع" type="number" step="0.01" required {...bind('price')} />
        <input placeholder="سعر التكلفة" type="number" step="0.01" {...bind('cost')} />
        <input placeholder="الكمية بالمخزون" type="number" {...bind('stock')} />
        {msg && <p className="error">{msg}</p>}
        <button className="primary">إضافة منتج</button>
      </form>

      <section className="cart">
        {rows.map(p => (
          <div key={p.id + p.price + p.cost + p.stock} className="prow">
            <b>{p.name} <small>{p.code}</small></b>
            {[['price', 'البيع'], ['cost', 'التكلفة'], ['stock', 'المخزون']].map(([k, l]) => (
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
