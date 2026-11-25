import { useEffect, useMemo, useState } from 'react'
import { supabase } from './lib/supabase'

const BUCKET = 'payments'
const money = n => Number(n || 0).toFixed(2)

// تصغير صورة الدفعة قبل الرفع (توفير إنترنت). لو فشل التصغير نرفع الأصل.
async function shrink(file) {
  try {
    const bmp = await createImageBitmap(file)
    const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height))
    const c = document.createElement('canvas')
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k)
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height)
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.82))
    return blob ? { body: blob, ext: 'jpg', type: 'image/jpeg' } : null
  } catch { return null }
}

export default function Suppliers() {
  const [invoices, setInvoices] = useState([])
  const [urls, setUrls] = useState({})
  const [q, setQ] = useState('')
  const [err, setErr] = useState('')
  const [flash, setFlash] = useState('')
  const [busy, setBusy] = useState('')
  const [phones, setPhones] = useState({})
  const [disc, setDisc] = useState({})

  async function load() {
    const { data, error } = await supabase.from('supplier_invoices')
      .select('id,company,day,total,subtotal,discount,supplier_phone,supplier_invoice_items(product_name,qty,buy_price,sell_price,old_buy_price,old_sell_price),supplier_payment_images(id,image_url,created_at)')
      .order('day', { ascending: false }).limit(300)
    if (error) { setErr('تعذر تحميل البيانات. شغّل ملف update_nov25.sql في Supabase أولاً.'); return }
    setErr(''); setInvoices(data || [])
    const paths = (data || []).flatMap(v => v.supplier_payment_images.map(i => i.image_url))
    if (!paths.length) return setUrls({})
    const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrls(paths, 3600)
    setUrls(Object.fromEntries((signed || []).filter(x => x.signedUrl).map(x => [x.path, x.signedUrl])))
  }
  useEffect(() => { load() }, [])

  const merchants = useMemo(() => {
    const m = new Map()
    invoices.forEach(v => {
      if (!m.has(v.company)) m.set(v.company, { company: v.company, phone: '', invoices: [] })
      const g = m.get(v.company)
      g.invoices.push(v)
      if (!g.phone && v.supplier_phone) g.phone = v.supplier_phone // الأحدث أولاً
    })
    const t = q.trim()
    return [...m.values()].filter(g => !t || g.company.includes(t) || g.phone.includes(t))
  }, [invoices, q])

  const say = t => { setFlash(t); setTimeout(() => setFlash(''), 4000) }

  async function savePhone(g) {
    const { error } = await supabase.rpc('set_supplier_phone', { p_company: g.company, p_phone: phones[g.company] ?? g.phone })
    if (error) return setErr('تعذر حفظ الرقم.')
    setErr(''); say('تم حفظ رقم التاجر'); load()
  }

  async function applyDiscount(v) {
    const val = Number(disc[v.id] ?? v.discount ?? 0) || 0
    const { error } = await supabase.rpc('set_supplier_invoice_extras', { p_id: String(v.id), p_discount: val, p_phone: null })
    if (error) return setErr(error.message || 'تعذر تطبيق الخصم.')
    setErr(''); setDisc(d => { const n = { ...d }; delete n[v.id]; return n }); say('تم تحديث إجمالي الفاتورة'); load()
  }

  async function uploadOne(v, file) {
    const s = await shrink(file)
    const ext = s?.ext || (file.name.split('.').pop() || 'jpg').toLowerCase()
    const path = `${v.id}/${crypto.randomUUID()}.${ext}`
    const { error } = await supabase.storage.from(BUCKET).upload(path, s?.body || file, { contentType: s?.type || file.type || 'image/jpeg' })
    if (error) throw error
    const { error: e2 } = await supabase.from('supplier_payment_images').insert({ invoice_id: v.id, image_url: path })
    if (e2) { await supabase.storage.from(BUCKET).remove([path]); throw e2 }
  }

  async function addImages(v, files) {
    if (!files.length) return
    setBusy(String(v.id)); setErr('')
    try { for (const f of files) await uploadOne(v, f); say('تمت إضافة الصورة') }
    catch { setErr('تعذر رفع الصورة. تأكد من الاتصال ومن تشغيل ملف update_nov25.sql.') }
    setBusy(''); load()
  }

  async function removeImage(img) {
    const { error } = await supabase.from('supplier_payment_images').delete().eq('id', img.id)
    if (error) return setErr('تعذر حذف الصورة.')
    await supabase.storage.from(BUCKET).remove([img.image_url])
  }
  async function delImage(img) {
    if (!confirm('حذف هذه الصورة؟')) return
    await removeImage(img); load()
  }
  async function replaceImage(v, img, file) {
    if (!file) return
    setBusy(String(v.id)); setErr('')
    try { await uploadOne(v, file); await removeImage(img); say('تم تبديل الصورة') }
    catch { setErr('تعذر تبديل الصورة.') }
    setBusy(''); load()
  }

  const subOf = v => (Number(v.subtotal) > 0 ? Number(v.subtotal) : Number(v.total) + Number(v.discount || 0))

  return (
    <div className="app">
      <h2>التجار</h2>
      <p className="empty">فواتير التجار تُضاف من صفحة «المصاريف» ثم «فاتورة تاجر». هنا رقم كل تاجر وفواتيره وصور دفعاته.</p>
      <input placeholder="ابحث باسم التاجر أو رقمه" value={q} onChange={e => setQ(e.target.value)} />
      {flash && <p className="notice">{flash}</p>}
      {err && <p className="error">{err}</p>}

      {merchants.map(g => (
        <section key={g.company} className="card">
          <div className="row2"><h3>{g.company}</h3><b>{money(g.invoices.reduce((s, v) => s + Number(v.total), 0))} ₪</b></div>
          <div className="row2">
            <input type="tel" inputMode="tel" placeholder="رقم التاجر" value={phones[g.company] ?? g.phone}
              onChange={e => setPhones({ ...phones, [g.company]: e.target.value })} />
            <button className="primary" onClick={() => savePhone(g)}>حفظ الرقم</button>
          </div>
          {g.phone && <p className="adv"><a href={`tel:${g.phone}`}>اتصال بالتاجر: {g.phone}</a></p>}

          <div className="cart">
            {g.invoices.map(v => (
              <details key={v.id} className="order">
                <summary>
                  <span>{v.day}{v.supplier_payment_images.length > 0 && ` · ${v.supplier_payment_images.length} صورة`}</span>
                  <b>{money(v.total)} ₪</b>
                </summary>

                {v.supplier_invoice_items.map((i, n) => (
                  <p key={n}>{i.product_name} × {i.qty} — شراء {money(i.buy_price)}{i.old_buy_price != null && Number(i.old_buy_price) !== Number(i.buy_price) ? ` (كان ${money(i.old_buy_price)})` : ''} / بيع {i.sell_price}{i.old_sell_price != null && Number(i.old_sell_price) !== Number(i.sell_price) ? ` (كان ${i.old_sell_price})` : ''}</p>
                ))}

                <div className="retform">
                  <div className="row2"><span>إجمالي الأصناف</span><b>{money(subOf(v))} ₪</b></div>
                  <label className="row2"><span>خصم مبلغ</span>
                    <input type="number" min="0" step="0.01" value={disc[v.id] ?? (Number(v.discount) || '')} placeholder="0"
                      onChange={e => setDisc({ ...disc, [v.id]: e.target.value })} /></label>
                  <button className="primary" onClick={() => applyDiscount(v)}>تطبيق الخصم</button>
                  <div className="row2"><span>الإجمالي بعد الخصم</span><b>{money(v.total)} ₪</b></div>
                </div>

                <div className="imgs">
                  {v.supplier_payment_images.map(img => (
                    <div key={img.id} className="thumb">
                      {urls[img.image_url]
                        ? <a href={urls[img.image_url]} target="_blank" rel="noreferrer"><img src={urls[img.image_url]} alt="صورة دفعة" loading="lazy" /></a>
                        : <div className="ph">…</div>}
                      <div className="acts">
                        <label className="link">تبديل
                          <input type="file" accept="image/*" hidden onChange={e => { replaceImage(v, img, e.target.files[0]); e.target.value = '' }} /></label>
                        <button className="link" onClick={() => delImage(img)}>حذف</button>
                      </div>
                    </div>
                  ))}
                </div>
                <label className="filebtn">{busy === String(v.id) ? 'جارٍ الرفع…' : '+ إضافة صورة دفعة'}
                  <input type="file" accept="image/*" multiple hidden disabled={busy === String(v.id)}
                    onChange={e => { addImages(v, [...e.target.files]); e.target.value = '' }} /></label>
              </details>
            ))}
          </div>
        </section>
      ))}
      {!merchants.length && !err && <p className="empty">ما في فواتير تجار بعد.</p>}
    </div>
  )
}
