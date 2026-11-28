import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import { fmt, weekStart } from './lib/dates'
import { fetchAll } from './lib/fetchAll'
import { Bars, groupSum } from './Charts.jsx'
import { loadProductStats, buildProductsReport, REASON } from './lib/reports'

const PAGE = 20
const num = v => Number(v) || 0
const money = v => num(v).toFixed(2)
const emptyNew = { code: '', name: '', price: '', cost: '', stock: '', pack_size: '12' }
const PERIODS = [['all', 'الكل'], ['month', 'هذا الشهر'], ['week', 'هذا الأسبوع']]
const sinceOf = p => {
  const n = new Date()
  if (p === 'week') return weekStart(n).toISOString()
  if (p === 'month') return new Date(n.getFullYear(), n.getMonth(), 1).toISOString()
  return null
}

/* ------------------------------ بطاقة منتج ------------------------------ */
function ProductCard({ p, sold, reload, say }) {
  const [f, setF] = useState({ name: p.name, code: p.code, price: String(p.price), cost: String(p.cost), stock: String(p.stock), pack_size: String(p.pack_size) })
  const [add, setAdd] = useState({ qty: '', buy: '', sell: '' })
  const [loss, setLoss] = useState({ qty: '', reason: 'damaged', note: '' })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const oldStock = Math.max(num(p.stock), 0)
  const qty = num(add.qty), buy = num(add.buy)
  const newCost = qty > 0 && add.buy !== '' ? (oldStock * num(p.cost) + qty * buy) / (oldStock + qty) : null
  const lossQty = num(loss.qty)

  async function run(fn, okText) {
    if (busy) return
    setBusy(true); setErr('')
    try { const r = await fn(); if (r?.error) throw r.error; say(okText(r?.data)); await reload() }
    catch (e) { setErr(e?.message?.includes('duplicate') ? 'هذا الكود مستخدم لمنتج آخر' : (e?.message || 'تعذر تنفيذ العملية')) }
    setBusy(false)
  }

  const saveEdit = () => {
    if (!f.name.trim() || !f.code.trim() || f.price === '') return setErr('الاسم والكود وسعر البيع مطلوبة')
    return run(() => supabase.from('products').update({
      name: f.name.trim(), code: f.code.trim(), price: num(f.price), cost: num(f.cost), stock: num(f.stock), pack_size: num(f.pack_size) || 12
    }).eq('id', p.id), () => `تم حفظ تعديلات «${f.name.trim()}»`)
  }
  const addStock = () => {
    if (qty <= 0 || add.buy === '') return setErr('اكتب الكمية الجديدة وسعر شراء القطعة')
    return run(() => supabase.rpc('add_stock', { p_product: p.id, p_qty: qty, p_buy: buy, p_sell: add.sell === '' ? null : num(add.sell) }),
      d => `تمت إضافة ${qty} قطعة. متوسط التكلفة الجديد ${money(d?.new_cost ?? newCost)} ₪`)
  }
  const removeProduct = () => {
    if (!confirm(`حذف المنتج «${p.name}»؟\n\nإذا كان له مبيعات أو فواتير أو سجلات سابقة فلن يُحذف نهائياً، بل يُخفى من القوائم والبيع وتبقى تقاريره القديمة سليمة.\nويُحذف نهائياً فقط إذا لم يكن له أي سجل.\n\nمتابعة؟`)) return
    return run(() => supabase.rpc('delete_product', { p_id: p.id }),
      d => d?.deleted ? `تم حذف «${p.name}» نهائياً` : `«${p.name}» له سجلات سابقة، فتم إخفاؤه بدل الحذف (يمكنك استرجاعه من «إظهار المخفية»)`)
  }
  const restore = () => run(() => supabase.from('products').update({ archived: false }).eq('id', p.id), () => `تم استرجاع «${p.name}»`)
  const recordLoss = () => {
    if (lossQty <= 0) return setErr('اكتب كمية التالف/المسروق')
    if (!confirm(`تسجيل ${lossQty} قطعة من «${p.name}» (${REASON[loss.reason]}) وخصمها من المخزون؟ الخسارة ${money(lossQty * num(p.cost))} ₪`)) return
    return run(() => supabase.rpc('record_loss', { p_product: p.id, p_qty: lossQty, p_reason: loss.reason, p_note: loss.note.trim() || null }),
      d => `تم تسجيل الخسارة: ${money(d?.loss ?? lossQty * num(p.cost))} ₪`)
  }

  const bind = k => ({ value: f[k], onChange: e => setF({ ...f, [k]: e.target.value }) })

  return (
    <details className="order">
      <summary>
        <span>{p.name} <small className="sub">{p.code}</small>{p.archived && <small className="neg"> (مخفي)</small>}</span>
        <b>{num(p.stock)} قطعة</b>
      </summary>
      <p>بيع {money(p.price)} · تكلفة {money(p.cost)} · قيمة المخزون {money(Math.max(num(p.stock), 0) * num(p.cost))} ₪ · تم بيع {sold} قطعة</p>
      {err && <p className="error">{err}</p>}

      <div className="panel">
        <b>تعديل بيانات المنتج</b>
        <input placeholder="اسم المنتج" {...bind('name')} />
        <div className="duo">
          <label><small>الكود</small><input {...bind('code')} /></label>
          <label><small>قطع بالعبوة</small><input type="number" min="1" {...bind('pack_size')} /></label>
        </div>
        <div className="trio">
          <label><small>سعر البيع</small><input type="number" step="0.01" min="0" {...bind('price')} /></label>
          <label><small>التكلفة</small><input type="number" step="0.01" min="0" {...bind('cost')} /></label>
          <label><small>المخزون</small><input type="number" step="any" {...bind('stock')} /></label>
        </div>
        <small className="sub">هنا تصحيح مباشر للأرقام بدون حساب متوسط. للشراء الجديد استخدم «إضافة كمية» أدناه.</small>
        <button className="primary" disabled={busy} onClick={saveEdit}>حفظ التعديلات</button>
      </div>

      <div className="panel">
        <b>إضافة كمية بسعر شراء جديد</b>
        <div className="trio">
          <label><small>الكمية (قطع)</small><input type="number" min="0" step="any" value={add.qty} onChange={e => setAdd({ ...add, qty: e.target.value })} /></label>
          <label><small>شراء القطعة</small><input type="number" min="0" step="0.01" value={add.buy} onChange={e => setAdd({ ...add, buy: e.target.value })} /></label>
          <label><small>بيع القطعة (اختياري)</small><input type="number" min="0" step="0.01" value={add.sell} onChange={e => setAdd({ ...add, sell: e.target.value })} /></label>
        </div>
        {newCost !== null && (
          <div className="diffs">
            <span>التكلفة الحالية {money(p.cost)} ← سعر الشراء الجديد {money(buy)} (الفرق <b className={buy > num(p.cost) ? 'neg' : buy < num(p.cost) ? 'pos' : ''}>{(buy - num(p.cost) > 0 ? '+' : '') + (buy - num(p.cost)).toFixed(2)}</b>)</span>
            <span>المتوسط الجديد للتكلفة: <b>{money(newCost)}</b> · المخزون بعد الإضافة {num(p.stock) + qty}</span>
            {num(p.stock) < 0 && <span className="neg">المخزون الحالي بالسالب، وحُسب المتوسط على أنه صفر.</span>}
          </div>
        )}
        <button className="primary" disabled={busy} onClick={addStock}>إضافة للمخزون</button>
      </div>

      <div className="panel">
        <b>تسجيل تالف / مسروق</b>
        <div className="duo">
          <label><small>الكمية (قطع)</small><input type="number" min="0" step="any" value={loss.qty} onChange={e => setLoss({ ...loss, qty: e.target.value })} /></label>
          <label><small>السبب</small>
            <select value={loss.reason} onChange={e => setLoss({ ...loss, reason: e.target.value })}>
              {Object.entries(REASON).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select></label>
        </div>
        <input placeholder="ملاحظة (اختياري)" value={loss.note} onChange={e => setLoss({ ...loss, note: e.target.value })} />
        {lossQty > 0 && <small className="neg">الخسارة المتوقعة: {money(lossQty * num(p.cost))} ₪ (الكمية × التكلفة)</small>}
        <button className="primary" disabled={busy} onClick={recordLoss}>تسجيل وخصم من المخزون</button>
      </div>

      {p.archived
        ? <button className="primary" disabled={busy} onClick={restore}>استرجاع المنتج (إظهاره)</button>
        : <button className="link neg" disabled={busy} onClick={removeProduct}>حذف المنتج</button>}
    </details>
  )
}

/* ------------------------------ تبويب المنتجات ------------------------------ */
function ListTab({ rows, sold, reload, say }) {
  const [f, setF] = useState(emptyNew)
  const [msg, setMsg] = useState('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(0)
  const [bySold, setBySold] = useState(false)
  const [showHidden, setShowHidden] = useState(false)

  async function add(e) {
    e.preventDefault()
    const { error } = await supabase.from('products').insert({
      code: f.code.trim(), name: f.name.trim(),
      price: Number(f.price), cost: Number(f.cost) || 0, stock: Number(f.stock) || 0, pack_size: Number(f.pack_size) || 12
    })
    if (error) return setMsg(error.message.includes('duplicate') ? 'هذا الكود مستخدم لمنتج آخر' : 'تعذر حفظ المنتج')
    setF(emptyNew); setMsg(''); say('تمت إضافة المنتج'); reload()
  }

  const soldOf = p => sold[p.id] || 0
  const t = q.trim().toLowerCase()
  const found = rows.filter(p => (showHidden || !p.archived) && (!t || p.name.toLowerCase().includes(t) || p.code.toLowerCase().includes(t)))
  const list = bySold ? [...found].sort((a, b) => soldOf(b) - soldOf(a)) : found
  const pages = Math.max(1, Math.ceil(list.length / PAGE))
  const cur = Math.min(page, pages - 1)
  const shown = list.slice(cur * PAGE, cur * PAGE + PAGE)
  const soldProducts = rows.filter(p => !p.archived && soldOf(p) > 0).length
  const soldTotal = rows.reduce((s, p) => s + soldOf(p), 0)

  const bind = k => ({ value: f[k], onChange: e => setF({ ...f, [k]: e.target.value }) })

  return (
    <>
      <details className="order">
        <summary><b>+ إضافة منتج جديد</b></summary>
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
      </details>

      <div className="stats">
        <div><small>منتجات تم بيعها</small><b>{soldProducts} من {rows.filter(p => !p.archived).length}</b></div>
        <div><small>إجمالي القطع المباعة</small><b>{soldTotal}</b></div>
      </div>

      <input placeholder="ابحث باسم المنتج أو كوده" value={q} onChange={e => { setQ(e.target.value); setPage(0) }} />
      <div className="row2">
        <button className="link" onClick={() => { setBySold(!bySold); setPage(0) }}>{bySold ? 'ترتيب بالاسم' : 'ترتيب حسب الأكثر مبيعاً'}</button>
        <button className="link" onClick={() => { setShowHidden(!showHidden); setPage(0) }}>{showHidden ? 'إخفاء المنتجات المخفية' : 'إظهار المنتجات المخفية'}</button>
        <small className="sub">{list.length} منتج</small>
      </div>

      <section className="cart">
        {shown.map(p => (
          <ProductCard key={[p.id, p.name, p.code, p.price, p.cost, p.stock, p.pack_size, p.archived].join('|')} p={p} sold={soldOf(p)} reload={reload} say={say} />
        ))}
        {!rows.length && <p className="empty">ما في منتجات بعد. أضف أول منتج من الأعلى.</p>}
        {!!rows.length && !list.length && <p className="empty">لا يوجد منتج بهذا الاسم أو الكود.</p>}
      </section>

      {pages > 1 && (
        <div className="pager">
          <button disabled={cur === 0} onClick={() => setPage(cur - 1)}>→ السابق</button>
          <span>صفحة {cur + 1} من {pages}</span>
          <button disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)}>التالي ←</button>
        </div>
      )}
    </>
  )
}

/* ------------------------------ تبويب التقرير والرسوم ------------------------------ */
function ReportTab({ rows }) {
  const [period, setPeriod] = useState('month')
  const [stats, setStats] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    let off = false
    setStats(null); setErr('')
    loadProductStats(sinceOf(period)).then(s => !off && setStats(s))
      .catch(() => !off && setErr('تعذر تحميل الإحصائيات. تأكد من تشغيل ملف store_full_setup.sql.'))
    return () => { off = true }
  }, [period])

  const label = PERIODS.find(x => x[0] === period)[1]
  const z = { sold: 0, returned: 0, revenue: 0, profit: 0 }
  const list = stats ? rows.map(p => ({ name: p.name, net: Math.max(0, (stats.map[p.id] || z).sold - (stats.map[p.id] || z).returned) })) : []
  const top = [...list].sort((a, b) => b.net - a.net).filter(x => x.net > 0).slice(0, 8)
  const worst = [...list].sort((a, b) => a.net - b.net).slice(0, 8)
  const revenue = stats ? Object.values(stats.map).reduce((s, x) => s + x.revenue, 0) : 0
  const profit = stats ? Object.values(stats.map).reduce((s, x) => s + x.profit, 0) : 0
  const capital = rows.filter(p => !p.archived).reduce((s, p) => s + Math.max(num(p.stock), 0) * num(p.cost), 0)

  async function download() {
    setBusy(true)
    try { buildProductsReport(rows, stats, label) } catch { setErr('تعذر إنشاء الملف.') }
    setBusy(false)
  }

  return (
    <>
      <div className="tabs inner">
        {PERIODS.map(([k, l]) => <button key={k} className={period === k ? 'on' : ''} onClick={() => setPeriod(k)}>{l}</button>)}
      </div>
      {err && <p className="error">{err}</p>}
      {!stats && !err && <p className="empty">جارٍ التحميل…</p>}
      {stats && <>
        <div className="stats">
          <div><small>إيراد المنتجات ({label})</small><b>{money(revenue)} ₪</b></div>
          <div><small>ربح المنتجات ({label})</small><b className="pos">{money(profit)} ₪</b></div>
          <div><small>رأس مال المخزون</small><b>{money(capital)} ₪</b></div>
          <div><small>عدد المنتجات</small><b>{rows.length}</b></div>
        </div>
        <section className="card"><h3>الأكثر مبيعاً (بالقطع)</h3><Bars items={top.map(x => ({ label: x.name, value: x.net }))} /></section>
        <section className="card"><h3>الأقل مبيعاً (بالقطع)</h3><Bars items={worst.map(x => ({ label: x.name, value: x.net }))} /></section>
        <button className="primary" disabled={busy} onClick={download}>{busy ? 'جارٍ التجهيز…' : 'تنزيل تقرير شامل لكل منتج (Excel)'}</button>
        <p className="sub">التقرير يشمل لكل منتج: سعر البيع، التكلفة، المخزون، قيمته، المباع، المرتجع، الإيراد، الربح، التالف والمسروق وخسارته (للفترة المختارة).</p>
      </>}
    </>
  )
}

/* ------------------------------ تبويب التالف والمسروق ------------------------------ */
function LossTab({ rows, reload, say }) {
  const [period, setPeriod] = useState('month')
  const [losses, setLosses] = useState([])
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [f, setF] = useState({ name: '', qty: '', reason: 'damaged', note: '', day: fmt(new Date()) })

  const load = () => {
    const since = sinceOf(period)
    return fetchAll(() => {
      let q = supabase.from('product_losses').select('id,product_id,qty,reason,cost,note,day,products(name,code)')
      if (since) q = q.gte('day', fmt(new Date(since)))
      return q.order('day', { ascending: false }).order('id')
    }).then(d => { setLosses(d); setErr('') })
      .catch(() => setErr('تعذر تحميل السجل. شغّل ملف store_full_setup.sql في Supabase.'))
  }
  useEffect(() => { load() }, [period])

  const product = rows.find(p => p.name === f.name.trim())
  const qty = num(f.qty)
  const total = losses.reduce((s, l) => s + num(l.qty) * num(l.cost), 0)
  const label = PERIODS.find(x => x[0] === period)[1]

  async function submit(e) {
    e.preventDefault()
    if (busy) return
    if (!product) return setErr('اختر منتجاً من القائمة (اكتب الاسم واختره من الاقتراحات)')
    if (qty <= 0) return setErr('اكتب الكمية')
    setBusy(true); setErr('')
    const { data, error } = await supabase.rpc('record_loss', { p_product: product.id, p_qty: qty, p_reason: f.reason, p_note: f.note.trim() || null, p_day: f.day || null })
    setBusy(false)
    if (error) return setErr(error.message || 'تعذر التسجيل')
    say(`تم تسجيل الخسارة: ${money(data?.loss)} ₪`)
    setF({ ...f, name: '', qty: '', note: '' })
    await load(); reload()
  }

  async function del(l) {
    if (!confirm(`حذف هذا السجل؟ سيُرجَع ${num(l.qty)} قطعة من «${l.products?.name}» إلى المخزون.`)) return
    const { error } = await supabase.rpc('delete_loss', { p_id: l.id })
    if (error) return setErr('تعذر حذف السجل.')
    await load(); reload()
  }

  return (
    <>
      <datalist id="lossprods">{rows.filter(p => !p.archived).map(p => <option key={p.id} value={p.name} />)}</datalist>
      <form className="meta" onSubmit={submit}>
        <input list="lossprods" placeholder="اسم المنتج" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} />
        <div className="duo">
          <label><small>الكمية (قطع)</small><input type="number" min="0" step="any" value={f.qty} onChange={e => setF({ ...f, qty: e.target.value })} /></label>
          <label><small>السبب</small>
            <select value={f.reason} onChange={e => setF({ ...f, reason: e.target.value })}>
              {Object.entries(REASON).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select></label>
        </div>
        <input type="date" value={f.day} max={fmt(new Date())} onChange={e => setF({ ...f, day: e.target.value })} />
        <input placeholder="ملاحظة (اختياري)" value={f.note} onChange={e => setF({ ...f, note: e.target.value })} />
        {product && qty > 0 && <small className="neg">الخسارة المتوقعة: {money(qty * num(product.cost))} ₪ · المخزون الحالي {num(product.stock)}</small>}
        {err && <p className="error">{err}</p>}
        <button className="primary" disabled={busy}>تسجيل وخصم من المخزون</button>
      </form>

      <div className="tabs inner">
        {PERIODS.map(([k, l]) => <button key={k} className={period === k ? 'on' : ''} onClick={() => setPeriod(k)}>{l}</button>)}
      </div>
      <div className="stats">
        <div className="kpi bad"><small>إجمالي الخسارة ({label})</small><b>{money(total)} ₪</b></div>
        <div className="kpi"><small>عدد السجلات</small><b>{losses.length}</b></div>
      </div>
      {losses.length > 0 && (
        <section className="card"><h3>الخسارة حسب السبب</h3>
          <Bars items={groupSum(losses, l => REASON[l.reason] || l.reason, l => num(l.qty) * num(l.cost))} /></section>
      )}
      <section className="cart">
        {losses.map(l => (
          <div key={l.id} className="order">
            <div className="row2"><span>{l.day} · {l.products?.name} · {REASON[l.reason] || l.reason}</span><b className="neg">{money(num(l.qty) * num(l.cost))} ₪</b></div>
            <p>{num(l.qty)} قطعة × {money(l.cost)}{l.note ? ` — ${l.note}` : ''} <button className="link" onClick={() => del(l)}>حذف</button></p>
          </div>
        ))}
        {!losses.length && <p className="empty">لا توجد سجلات بهذه الفترة.</p>}
      </section>
    </>
  )
}

/* ------------------------------ الصفحة ------------------------------ */
export default function Products() {
  const [tab, setTab] = useState('list')
  const [rows, setRows] = useState([])
  const [sold, setSold] = useState({})
  const [flash, setFlash] = useState('')
  const [err, setErr] = useState('')

  const load = async () => {
    try {
      const [data, sales] = await Promise.all([
        fetchAll(() => supabase.from('products').select('*').order('name').order('id')),
        fetchAll(() => supabase.from('product_sales').select('product_id,sold,returned').order('product_id'))
      ])
      setRows(data)
      setSold(Object.fromEntries(sales.map(x => [x.product_id, Number(x.sold) - Number(x.returned)])))
      setErr('')
    } catch { setErr('تعذر تحميل المنتجات. تأكد من الاتصال.') }
  }
  useEffect(() => { load() }, [])

  const say = t => { setFlash(t); setTimeout(() => setFlash(''), 5000) }

  return (
    <div className="app">
      <h2>المنتجات</h2>
      <div className="tabs inner">
        {[['list', 'المنتجات'], ['report', 'التقرير والرسوم'], ['loss', 'التالف والمسروق']].map(([k, l]) =>
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {flash && <p className="notice">{flash}</p>}
      {err && <p className="error">{err}</p>}
      {tab === 'list' && <ListTab rows={rows} sold={sold} reload={load} say={say} />}
      {tab === 'report' && <ReportTab rows={rows} />}
      {tab === 'loss' && <LossTab rows={rows} reload={load} say={say} />}
    </div>
  )
}
