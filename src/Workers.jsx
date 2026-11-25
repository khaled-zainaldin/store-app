import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import { fmt, weekStart, addDays } from './lib/dates'

const NEXT = { undefined: 'present', present: 'absent', absent: null }
const MARK = { present: '✔', absent: '✖' }

export default function Workers() {
  const [start, setStart] = useState(weekStart(new Date()))
  const [workers, setWorkers] = useState([])
  const [att, setAtt] = useState([])
  const [adv, setAdv] = useState([])
  const [bon, setBon] = useState([])
  const [bonErr, setBonErr] = useState(false)
  const [nw, setNw] = useState({ name: '', weekly_salary: '' })
  const [amt, setAmt] = useState({})
  const [bamt, setBamt] = useState({})

  const days = [0, 1, 2, 3, 4, 5].map(i => addDays(start, i)) // السبت إلى الخميس
  const from = fmt(days[0]), to = fmt(days[5])

  async function load() {
    const [w, a, d, b] = await Promise.all([
      supabase.from('workers').select('*').order('name'),
      supabase.from('attendance').select('*').gte('day', from).lte('day', to),
      supabase.from('advances').select('*').gte('day', from).lte('day', to).order('day'),
      supabase.from('worker_bonuses').select('*').gte('day', from).lte('day', to).order('day')
    ])
    setWorkers(w.data || []); setAtt(a.data || []); setAdv(d.data || [])
    setBon(b.data || []); setBonErr(!!b.error)
  }
  useEffect(() => { load() }, [from])

  async function addWorker(e) {
    e.preventDefault()
    await supabase.from('workers').insert({ name: nw.name.trim(), weekly_salary: Number(nw.weekly_salary) })
    setNw({ name: '', weekly_salary: '' }); load()
  }
  async function toggle(w, day) {
    const cur = att.find(a => a.worker_id === w.id && a.day === day)?.status
    const next = NEXT[cur]
    if (next) await supabase.from('attendance').upsert({ worker_id: w.id, day, status: next }, { onConflict: 'worker_id,day' })
    else await supabase.from('attendance').delete().eq('worker_id', w.id).eq('day', day)
    load()
  }
  async function addAdvance(w) {
    const a = Number(amt[w.id])
    if (!a) return
    await supabase.from('advances').insert({ worker_id: w.id, amount: a, day: fmt(new Date()) })
    setAmt({ ...amt, [w.id]: '' }); load()
  }
  const delAdv = async id => { await supabase.from('advances').delete().eq('id', id); load() }
  async function addBonus(w) {
    const a = Number(bamt[w.id])
    if (!(a > 0)) return
    const { error } = await supabase.from('worker_bonuses').insert({ worker_id: w.id, amount: a, day: fmt(new Date()) })
    if (error) return setBonErr(true)
    setBamt({ ...bamt, [w.id]: '' }); load()
  }
  const delBonus = async id => { await supabase.from('worker_bonuses').delete().eq('id', id); load() }

  return (
    <div className="app">
      <h2>العمال</h2>
      <div className="row2">
        <button className="link" onClick={() => setStart(addDays(start, -7))}>→ الأسبوع السابق</button>
        <b>{from} إلى {to}</b>
        <button className="link" onClick={() => setStart(addDays(start, 7))}>الأسبوع التالي ←</button>
      </div>
      {bonErr && <p className="error">تعذر التعامل مع البونص. شغّل ملف update_nov25.sql في Supabase.</p>}
      <p className="empty">الدوام 6 أيام من السبت إلى الخميس. اضغط على اليوم لتبديله: حاضر ✔ ثم غائب ✖ ثم فارغ.</p>

      {workers.map(w => {
        const mine = adv.filter(a => a.worker_id === w.id)
        const absent = att.filter(a => a.worker_id === w.id && a.status === 'absent').length
        const present = att.filter(a => a.worker_id === w.id && a.status === 'present').length
        const daily = Number(w.weekly_salary) / 6
        const advTotal = mine.reduce((s, a) => s + Number(a.amount), 0)
        const myBon = bon.filter(b => b.worker_id === w.id)
        const bonTotal = myBon.reduce((s, b) => s + Number(b.amount), 0)
        const net = Number(w.weekly_salary) - absent * daily - advTotal + bonTotal
        return (
          <section key={w.id} className="cart worker">
            <div className="row2"><b>{w.name}</b><small>راتب أسبوعي {Number(w.weekly_salary).toFixed(2)}</small></div>
            <div className="week">
              {days.map(d => {
                const k = fmt(d), st = att.find(a => a.worker_id === w.id && a.day === k)?.status
                return <button key={k} className={'day ' + (st || '')} onClick={() => toggle(w, k)}>
                  <small>{d.toLocaleDateString('ar', { weekday: 'short' })}</small>{MARK[st] || '·'}
                </button>
              })}
            </div>
            <div className="row2">
              <input type="number" min="0" placeholder="مبلغ سلفة" value={amt[w.id] || ''} onChange={e => setAmt({ ...amt, [w.id]: e.target.value })} />
              <button className="primary" onClick={() => addAdvance(w)}>تسجيل سلفة</button>
            </div>
            {mine.map(a => <p key={a.id} className="adv">{a.day}: {Number(a.amount).toFixed(2)} <button className="link" onClick={() => delAdv(a.id)}>حذف</button></p>)}
            <div className="row2">
              <input type="number" min="0" step="0.01" placeholder="مبلغ بونص (إضافة للراتب)" value={bamt[w.id] || ''} onChange={e => setBamt({ ...bamt, [w.id]: e.target.value })} />
              <button className="primary" onClick={() => addBonus(w)}>إضافة بونص</button>
            </div>
            {myBon.map(b => <p key={b.id} className="adv pos">بونص {b.day}: +{Number(b.amount).toFixed(2)} <button className="link" onClick={() => delBonus(b.id)}>حذف</button></p>)}
            <div className="stats">
              <div><small>الراتب الأسبوعي</small><b>{Number(w.weekly_salary).toFixed(2)}</b></div>
              <div><small>حضور / غياب</small><b>{present} / {absent}</b></div>
              <div><small>خصم الغياب</small><b>{(absent * daily).toFixed(2)}</b></div>
              <div><small>السلف</small><b>{advTotal.toFixed(2)}</b></div>
              <div><small>البونص</small><b className="pos">{bonTotal.toFixed(2)}</b></div>
              <div><small>صافي الراتب</small><b>{net.toFixed(2)}</b></div>
            </div>
          </section>
        )
      })}

      <form className="meta" onSubmit={addWorker}>
        <input placeholder="اسم عامل جديد" required value={nw.name} onChange={e => setNw({ ...nw, name: e.target.value })} />
        <input placeholder="الراتب الأسبوعي" type="number" min="0" required value={nw.weekly_salary} onChange={e => setNw({ ...nw, weekly_salary: e.target.value })} />
        <button className="primary">إضافة عامل</button>
      </form>
    </div>
  )
}
