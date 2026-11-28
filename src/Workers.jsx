import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import { fmt, weekStart, addDays } from './lib/dates'

const NEXT = { undefined: 'present', present: 'absent', absent: null }
const MARK = { present: '✔', absent: '✖' }
const m2 = v => Number(v || 0).toFixed(2)

export default function Workers() {
  const [start, setStart] = useState(weekStart(new Date()))
  const [workers, setWorkers] = useState([])
  const [att, setAtt] = useState([])
  const [adv, setAdv] = useState([])
  const [bon, setBon] = useState([])
  const [pay, setPay] = useState([])
  const [notes, setNotes] = useState([])
  const [setupErr, setSetupErr] = useState(false)
  const [msg, setMsg] = useState({ type: '', text: '' })
  const [showStopped, setShowStopped] = useState(false)
  const [nw, setNw] = useState({ name: '', weekly_salary: '', phone: '' })
  const [amt, setAmt] = useState({})
  const [bamt, setBamt] = useState({})
  const [phones, setPhones] = useState({})
  const [nnote, setNnote] = useState({})

  const days = [0, 1, 2, 3, 4, 5].map(i => addDays(start, i)) // السبت إلى الخميس
  const from = fmt(days[0]), to = fmt(days[5])

  async function load() {
    const [w, a, d, b, p, n] = await Promise.all([
      supabase.from('workers').select('*').order('name'),
      supabase.from('attendance').select('*').gte('day', from).lte('day', to),
      supabase.from('advances').select('*').gte('day', from).lte('day', to).order('day'),
      supabase.from('worker_bonuses').select('*').gte('day', from).lte('day', to).order('day'),
      supabase.from('worker_payroll').select('*').eq('week_start', from),
      supabase.from('worker_notes').select('*').order('created_at', { ascending: false }).limit(300)
    ])
    setWorkers(w.data || []); setAtt(a.data || []); setAdv(d.data || [])
    setBon(b.data || []); setPay(p.data || []); setNotes(n.data || [])
    setSetupErr(!!(b.error || p.error || n.error || w.error))
  }
  useEffect(() => { load() }, [from])

  const say = (type, text) => { setMsg({ type, text }); setTimeout(() => setMsg({ type: '', text: '' }), 6000) }
  const closed = Object.fromEntries(pay.map(p => [p.worker_id, p]))
  const stoppedBefore = w => w.active === false && !(w.stopped_at && w.stopped_at >= from)
  const visible = workers.filter(w => showStopped || !stoppedBefore(w))

  // الحساب الحي لكل عامل (قبل الإغلاق)
  const calc = w => {
    const absent = att.filter(a => a.worker_id === w.id && a.status === 'absent').length
    const present = att.filter(a => a.worker_id === w.id && a.status === 'present').length
    const daily = Number(w.weekly_salary) / 6
    const advTotal = adv.filter(a => a.worker_id === w.id).reduce((s, a) => s + Number(a.amount), 0)
    const bonTotal = bon.filter(b => b.worker_id === w.id).reduce((s, b) => s + Number(b.amount), 0)
    const ded = absent * daily
    const earned = Number(w.weekly_salary) - ded + bonTotal // المستحق: هو الذي يُخصم من الأرباح
    return { absent, present, ded, advTotal, bonTotal, earned, net: earned - advTotal }
  }

  const pending = visible.filter(w => w.active !== false && !closed[w.id] && (!w.started_on || w.started_on <= to))
    .concat(visible.filter(w => w.active === false && !closed[w.id] && w.stopped_at && w.stopped_at >= from))
  const pendingSum = pending.reduce((s, w) => s + calc(w).earned, 0)
  const closedSum = pay.reduce((s, p) => s + Number(p.earned), 0)

  async function addWorker(e) {
    e.preventDefault()
    const { error } = await supabase.from('workers').insert({
      name: nw.name.trim(), weekly_salary: Number(nw.weekly_salary), phone: nw.phone.trim() || null, started_on: fmt(new Date())
    })
    if (error) return say('error', 'تعذر إضافة العامل. تأكد من تشغيل ملف store_full_setup.sql.')
    setNw({ name: '', weekly_salary: '', phone: '' }); load()
  }
  async function toggle(w, day) {
    if (closed[w.id]) return
    const cur = att.find(a => a.worker_id === w.id && a.day === day)?.status
    const next = NEXT[cur]
    if (next) await supabase.from('attendance').upsert({ worker_id: w.id, day, status: next }, { onConflict: 'worker_id,day' })
    else await supabase.from('attendance').delete().eq('worker_id', w.id).eq('day', day)
    load()
  }
  async function addAdvance(w) {
    const a = Number(amt[w.id])
    if (!a || closed[w.id]) return
    await supabase.from('advances').insert({ worker_id: w.id, amount: a, day: fmt(new Date()) })
    setAmt({ ...amt, [w.id]: '' }); load()
  }
  const delAdv = async id => { await supabase.from('advances').delete().eq('id', id); load() }
  async function addBonus(w) {
    const a = Number(bamt[w.id])
    if (!(a > 0) || closed[w.id]) return
    const { error } = await supabase.from('worker_bonuses').insert({ worker_id: w.id, amount: a, day: fmt(new Date()) })
    if (error) return setSetupErr(true)
    setBamt({ ...bamt, [w.id]: '' }); load()
  }
  const delBonus = async id => { await supabase.from('worker_bonuses').delete().eq('id', id); load() }

  async function savePhone(w) {
    const { error } = await supabase.from('workers').update({ phone: (phones[w.id] ?? w.phone ?? '').trim() || null }).eq('id', w.id)
    if (error) return say('error', 'تعذر حفظ الرقم.')
    say('ok', 'تم حفظ رقم العامل'); load()
  }
  async function addNote(w) {
    const t = (nnote[w.id] || '').trim()
    if (!t) return
    const { error } = await supabase.from('worker_notes').insert({ worker_id: w.id, note: t, day: fmt(new Date()) })
    if (error) return say('error', 'تعذر حفظ الملاحظة. تأكد من تشغيل ملف store_full_setup.sql.')
    setNnote({ ...nnote, [w.id]: '' }); load()
  }
  async function delNote(id) {
    if (!confirm('حذف هذه الملاحظة؟')) return
    await supabase.from('worker_notes').delete().eq('id', id); load()
  }

  async function stopWorker(w) {
    if (!confirm(`تحذير: سيتم إيقاف العامل «${w.name}» ويختفي من القائمة.\nسجلاته (الحضور والسلف والرواتب المغلقة) تبقى محفوظة، ويمكنك إعادة تفعيله لاحقاً.\n\nهل أنت متأكد؟`)) return
    const { error } = await supabase.from('workers').update({ active: false, stopped_at: fmt(new Date()) }).eq('id', w.id)
    if (error) return say('error', 'تعذر إيقاف العامل. تأكد من تشغيل ملف store_full_setup.sql.')
    say('ok', `تم إيقاف ${w.name}`); load()
  }
  async function reactivate(w) {
    const { error } = await supabase.from('workers').update({ active: true, stopped_at: null }).eq('id', w.id)
    if (error) return say('error', 'تعذر إعادة التفعيل.')
    load()
  }

  async function closeWeek() {
    const unfinished = fmt(new Date()) <= to
    const ok = confirm(
      `إغلاق أسبوع ${from} إلى ${to}\n\n` +
      `سيتم خصم رواتب ${pending.length} عامل بقيمة ${m2(pendingSum)} ₪ من أرباح هذا الأسبوع وتثبيتها.\n` +
      `(الراتب المستحق بعد خصم الغياب مع البونص، قبل السلف)\n` +
      (unfinished ? '\nتنبيه: الأسبوع لم ينتهِ بعد.\n' : '') +
      '\nبعد الإغلاق لا يمكن تعديل الحضور والسلف إلا بإعادة فتح الأسبوع. متابعة؟')
    if (!ok) return
    const { error } = await supabase.rpc('close_week', { p_week_start: from })
    if (error) return say('error', 'تعذر إغلاق الأسبوع. تأكد من تشغيل ملف store_full_setup.sql.')
    say('ok', 'تم إغلاق الأسبوع وخصم الرواتب من الأرباح'); load()
  }
  async function reopenWeek() {
    if (!confirm(`إعادة فتح أسبوع ${from} إلى ${to}؟\nسيُلغى خصم رواتبه من الأرباح حتى تغلقه مرة أخرى.`)) return
    const { error } = await supabase.rpc('reopen_week', { p_week_start: from })
    if (error) return say('error', 'تعذر إعادة الفتح.')
    say('ok', 'تمت إعادة فتح الأسبوع'); load()
  }

  return (
    <div className="app">
      <h2>العمال</h2>
      <div className="row2">
        <button className="link" onClick={() => setStart(addDays(start, -7))}>→ الأسبوع السابق</button>
        <b>{from} إلى {to}</b>
        <button className="link" onClick={() => setStart(addDays(start, 7))}>الأسبوع التالي ←</button>
      </div>
      {setupErr && <p className="error">تعذر تحميل بعض بيانات العمال (البونص أو الرواتب أو الملاحظات). شغّل ملف store_full_setup.sql كاملاً في Supabase.</p>}
      {msg.text && <p className={msg.type === 'error' ? 'error' : 'notice'}>{msg.text}</p>}
      <p className="empty">الدوام 6 أيام من السبت إلى الخميس. اضغط على اليوم لتبديله: حاضر ✔ ثم غائب ✖ ثم فارغ.</p>

      <section className="card"><h3>إغلاق الأسبوع وخصم الرواتب من الأرباح</h3>
        {closedSum > 0 && <div className="row2"><span>رواتب مغلقة ومخصومة ({pay.length} عامل)</span><b className="pos">{m2(closedSum)} ₪</b></div>}
        {pending.length > 0 && <div className="row2"><span>رواتب لم تُخصم بعد ({pending.length} عامل)</span><b className="neg">{m2(pendingSum)} ₪</b></div>}
        {pending.length > 0 && <button className="primary" onClick={closeWeek}>إغلاق الأسبوع وخصم الرواتب</button>}
        {pay.length > 0 && <button className="link" onClick={reopenWeek}>إعادة فتح الأسبوع</button>}
        <p className="sub">المخصوم من الأرباح هو الراتب المستحق (الراتب − خصم الغياب + البونص). السلف جزء من دفع الراتب ولا تُخصم مرة ثانية.</p>
      </section>

      {visible.map(w => {
        const live = calc(w), snap = closed[w.id]
        const isStopped = w.active === false
        const mine = adv.filter(a => a.worker_id === w.id)
        const myBon = bon.filter(b => b.worker_id === w.id)
        const myNotes = notes.filter(n => n.worker_id === w.id)
        const v = snap
          ? { absent: snap.absent_days, present: live.present, ded: Number(snap.absence_deduction), advTotal: Number(snap.advances), bonTotal: Number(snap.bonus), earned: Number(snap.earned), net: Number(snap.net_pay) }
          : live
        const locked = !!snap
        return (
          <section key={w.id} className={'cart worker' + (isStopped ? ' stopped' : '')}>
            <div className="row2">
              <b>{w.name} {isStopped && <small className="sub">(موقوف)</small>} {locked && <small className="pos">(الأسبوع مغلق)</small>}</b>
              <small>راتب أسبوعي {m2(w.weekly_salary)}</small>
            </div>

            <div className="row2">
              <input type="tel" inputMode="tel" placeholder="رقم هاتف العامل" value={phones[w.id] ?? w.phone ?? ''}
                onChange={e => setPhones({ ...phones, [w.id]: e.target.value })} />
              <button className="primary" onClick={() => savePhone(w)}>حفظ الرقم</button>
            </div>
            {w.phone && <p className="adv"><a href={`tel:${w.phone}`}>اتصال بالعامل: {w.phone}</a></p>}

            <div className="week">
              {days.map(d => {
                const k = fmt(d), st = att.find(a => a.worker_id === w.id && a.day === k)?.status
                return <button key={k} disabled={locked} className={'day ' + (st || '')} onClick={() => toggle(w, k)}>
                  <small>{d.toLocaleDateString('ar', { weekday: 'short' })}</small>{MARK[st] || '·'}
                </button>
              })}
            </div>

            {!locked && <>
              <div className="row2">
                <input type="number" min="0" placeholder="مبلغ سلفة" value={amt[w.id] || ''} onChange={e => setAmt({ ...amt, [w.id]: e.target.value })} />
                <button className="primary" onClick={() => addAdvance(w)}>تسجيل سلفة</button>
              </div>
            </>}
            {mine.map(a => <p key={a.id} className="adv">{a.day}: {m2(a.amount)} {!locked && <button className="link" onClick={() => delAdv(a.id)}>حذف</button>}</p>)}
            {!locked && (
              <div className="row2">
                <input type="number" min="0" step="0.01" placeholder="مبلغ بونص (إضافة للراتب)" value={bamt[w.id] || ''} onChange={e => setBamt({ ...bamt, [w.id]: e.target.value })} />
                <button className="primary" onClick={() => addBonus(w)}>إضافة بونص</button>
              </div>
            )}
            {myBon.map(b => <p key={b.id} className="adv pos">بونص {b.day}: +{m2(b.amount)} {!locked && <button className="link" onClick={() => delBonus(b.id)}>حذف</button>}</p>)}

            <div className="stats">
              <div><small>الراتب الأسبوعي</small><b>{m2(w.weekly_salary)}</b></div>
              <div><small>حضور / غياب</small><b>{v.present} / {v.absent}</b></div>
              <div><small>خصم الغياب</small><b>{m2(v.ded)}</b></div>
              <div><small>السلف</small><b>{m2(v.advTotal)}</b></div>
              <div><small>البونص</small><b className="pos">{m2(v.bonTotal)}</b></div>
              <div><small>المستحق (يُخصم من الأرباح)</small><b>{m2(v.earned)}</b></div>
              <div><small>صافي التسليم (بعد السلف)</small><b>{m2(v.net)}</b></div>
            </div>

            <details>
              <summary>ملاحظات ({myNotes.length})</summary>
              <div className="panel">
                <textarea rows="2" placeholder="اكتب ملاحظة عن العامل" value={nnote[w.id] || ''} onChange={e => setNnote({ ...nnote, [w.id]: e.target.value })} />
                <button className="primary" onClick={() => addNote(w)}>إضافة ملاحظة</button>
                {myNotes.map(n => <p key={n.id} className="adv">{n.day}: {n.note} <button className="link" onClick={() => delNote(n.id)}>حذف</button></p>)}
              </div>
            </details>

            {isStopped
              ? <button className="link" onClick={() => reactivate(w)}>إعادة تفعيل العامل</button>
              : <button className="link neg" onClick={() => stopWorker(w)}>إيقاف العامل (استقالة)</button>}
          </section>
        )
      })}
      {!visible.length && <p className="empty">لا يوجد عمال.</p>}

      <button className="link" onClick={() => setShowStopped(!showStopped)}>{showStopped ? 'إخفاء الموقوفين' : 'إظهار العمال الموقوفين'}</button>

      <form className="meta" onSubmit={addWorker}>
        <input placeholder="اسم عامل جديد" required value={nw.name} onChange={e => setNw({ ...nw, name: e.target.value })} />
        <input placeholder="الراتب الأسبوعي" type="number" min="0" required value={nw.weekly_salary} onChange={e => setNw({ ...nw, weekly_salary: e.target.value })} />
        <input placeholder="رقم الهاتف (اختياري)" type="tel" inputMode="tel" value={nw.phone} onChange={e => setNw({ ...nw, phone: e.target.value })} />
        <button className="primary">إضافة عامل</button>
      </form>
    </div>
  )
}
