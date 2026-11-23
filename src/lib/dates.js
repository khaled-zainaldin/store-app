export const fmt = d => {
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
// بداية الأسبوع يوم السبت
export const weekStart = d => {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  x.setDate(x.getDate() - ((x.getDay() + 1) % 7))
  return x
}
export const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }
