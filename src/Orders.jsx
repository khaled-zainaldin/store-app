import { useEffect, useMemo, useState } from 'react'
import { supabase } from './lib/supabase'
import { weekStart } from './lib/dates'

const PERIODS = [['day', 'اليوم'], ['week', 'الأسبوع'], ['month', 'الشهر']]
const startOf = p => {
  const n = new Date()
  if (p === 'week') return weekStart(n)
  if (p === 'month') return new Date(n.getFullYear(), n.getMonth(), 1)
  return new Date(n.getFullYear(), n.getMonth(), n.getDate())
}

const METHOD = { cash: 'نقداً', jawwal_pay: 'جوال بي', bank_of_palestine: 'بنك فلسطين', palpay: 'بال باي' }

export default function Orders() {
  const [rows, setRows] = useState([])
  const [view, setView] = useState('sales')
  const [q, setQ] = useState('')
  const [period, setPeriod] = useState('day')

  useEffect(() => {
    supabase.from('sales')
      .select('id,total,payment_method,created_at,profiles(name),customers(name,phone),sale_items(qty,price,products(name))')
      .gte('created_at', startOf(period).toISOString())
      .order('created_at', { ascending: false })
      .then(({ data }) => setRows(data || []))
  }, [period])

  const periodTotal = rows.reduce((s, r) => s + Number(r.total), 0)

  const match = r => {
    const t = q.trim()
    return !t || (r.customers?.name || '').includes(t) || (r.customers?.phone || '').includes(t)
  }

  // تجميع المشتريات لكل زبون (بحسب الهاتف، وإن لم يوجد فبالاسم)
  const customers = useMemo(() => {
    const m = {}
    rows.filter(r => r.customers).forEach(r => {
      const c = r.customers, k = c.phone || c.name
      m[k] ??= { name: c.name, phone: c.phone, total: 0, orders: [] }
      m[k].total += Number(r.total)
      m[k].orders.push(r)
    })
    return Object.values(m).filter(c => match({ customers: c })).sort((a, b) => b.total - a.total)
  }, [rows, q])

  const items = r => r.sale_items.map((i, n) => (
    <p key={n}>{i.products?.name} × {i.qty} بسعر {i.price}</p>
  ))

  return (
    <div className="app">
      <h2>المبيعات</h2>
      <div className="tabs inner">
        {PERIODS.map(([k, l]) => (
          <button key={k} className={period === k ? 'on' : ''} onClick={() => setPeriod(k)}>{l}</button>
        ))}
      </div>
      <div className="stats">
        <div><small>عدد الفواتير</small><b>{rows.length}</b></div>
        <div><small>إجمالي المبيعات</small><b>{periodTotal.toFixed(2)} ₪</b></div>
      </div>
      <div className="tabs inner">
        <button className={view === 'sales' ? 'on' : ''} onClick={() => setView('sales')}>الفواتير</button>
        <button className={view === 'cust' ? 'on' : ''} onClick={() => setView('cust')}>الزبائن</button>
      </div>
      <input placeholder="ابحث باسم الزبون أو رقمه" value={q} onChange={e => setQ(e.target.value)} />

      <section className="cart">
        {view === 'sales' && rows.filter(match).map(r => (
          <details key={r.id} className="order">
            <summary>
              <span>{new Date(r.created_at).toLocaleDateString('ar')} · {r.customers?.name || 'زبون غير مسجل'}{r.customers?.phone ? ` · ${r.customers.phone}` : ''}</span>
              <b>{Number(r.total).toFixed(2)} ₪</b>
            </summary>
            <p>الموظف: {r.profiles?.name || '—'} · الدفع: {METHOD[r.payment_method] || r.payment_method}</p>
            {items(r)}
          </details>
        ))}

        {view === 'cust' && customers.map(c => (
          <details key={c.phone || c.name} className="order">
            <summary>
              <span>{c.name}{c.phone ? ` · ${c.phone}` : ' · بدون رقم'}</span>
              <b>{c.total.toFixed(2)} ₪</b>
            </summary>
            {c.orders.map(r => (
              <div key={r.id}>
                <p><b>{new Date(r.created_at).toLocaleDateString('ar')}</b> — {Number(r.total).toFixed(2)} ₪</p>
                {items(r)}
              </div>
            ))}
          </details>
        ))}

        {!rows.length && <p className="empty">ما في مبيعات بهذه الفترة.</p>}
      </section>
    </div>
  )
}
