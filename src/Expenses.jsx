import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import { fmt } from './lib/dates'
import SupplierInvoiceForm from './SupplierInvoiceForm.jsx'
import { buildFullReport } from './lib/reports'

const empty = () => ({ kind: 'expense', place: 'shop', who: '', reason: '', amount: '', day: fmt(new Date()) })

export default function Expenses() {
  const [mode, setMode] = useState('exp')
  const [rows, setRows] = useState([])
  const [f, setF] = useState(empty())
  const [busy, setBusy] = useState(false)
  const load = async () => {
    const { data } = await supabase.from('expenses').select('*').order('day', { ascending: false }).limit(100)
    setRows(data || [])
  }
  useEffect(() => { load() }, [])

  async function add(e) {
    e.preventDefault()
    await supabase.from('expenses').insert({ ...f, amount: Number(f.amount) })
    setF(empty()); load()
  }
  const del = async id => { if (confirm('حذف هذا السجل؟')) { await supabase.from('expenses').delete().eq('id', id); load() } }
  async function download() {
    setBusy(true)
    try {
      const n = new Date()
      await buildFullReport(fmt(new Date(n.getFullYear(), n.getMonth(), 1)), fmt(n))
    } catch { alert('تعذر إنشاء التقرير. تأكد من الاتصال ومن تشغيل ملف store_full_setup.sql.') }
    setBusy(false)
  }
  const bind = k => ({ value: f[k], onChange: e => setF({ ...f, [k]: e.target.value }) })
  const sum = (kind, place) => rows.filter(r => r.kind === kind && r.place === place).reduce((s, r) => s + Number(r.amount), 0)

  return (
    <div className="app">
      <h2>المشتريات والمصاريف</h2>
      <div className="tabs inner">
        <button className={mode === 'exp' ? 'on' : ''} onClick={() => setMode('exp')}>مصروف / مشتريات</button>
        <button className={mode === 'inv' ? 'on' : ''} onClick={() => setMode('inv')}>فاتورة تاجر</button>
      </div>

      {mode === 'inv' ? <SupplierInvoiceForm /> : (
        <>
          <form className="meta" onSubmit={add}>
            <select {...bind('kind')}><option value="expense">مصروف (كهرباء، تصليحات…)</option><option value="purchase">مشتريات</option></select>
            <select {...bind('place')}><option value="shop">المحل</option><option value="home">البيت</option></select>
            <input placeholder="اسم الشخص الذي صرف" required {...bind('who')} />
            <input placeholder="سبب الصرف" required {...bind('reason')} />
            <input placeholder="المبلغ" type="number" step="0.01" min="0" required {...bind('amount')} />
            <input type="date" required {...bind('day')} />
            <button className="primary">حفظ</button>
          </form>
          <button className="primary" disabled={busy} onClick={download}>{busy ? 'جارٍ التجهيز…' : 'تنزيل تقرير هذا الشهر (Excel): المصاريف والأرباح والمبيعات والتجار'}</button>
          <p className="sub">لفترة أخرى استخدم صفحة «تقرير المصاريف» واختر التاريخ ثم اضغط التنزيل.</p>
          <div className="stats">
            <div><small>مصاريف المحل</small><b>{sum('expense', 'shop').toFixed(2)}</b></div>
            <div><small>مصاريف البيت</small><b>{sum('expense', 'home').toFixed(2)}</b></div>
            <div><small>مشتريات المحل</small><b>{sum('purchase', 'shop').toFixed(2)}</b></div>
            <div><small>مشتريات البيت</small><b>{sum('purchase', 'home').toFixed(2)}</b></div>
          </div>
          <section className="cart">
            {rows.map(r => (
              <div key={r.id} className="order">
                <div className="row2"><span>{r.day} · {r.kind === 'purchase' ? 'مشتريات' : 'مصروف'} · {r.place === 'shop' ? 'المحل' : 'البيت'}</span><b>{Number(r.amount).toFixed(2)} ₪</b></div>
                <p>{r.who} — {r.reason} {r.invoice_id ? <small>(تابع لفاتورة تاجر)</small> : <button className="link" onClick={() => del(r.id)}>حذف</button>}</p>
              </div>
            ))}
            {!rows.length && <p className="empty">ما في سجلات بعد.</p>}
          </section>
        </>
      )}
    </div>
  )
}
