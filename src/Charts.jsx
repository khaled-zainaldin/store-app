export function Bars({ items }) {
  const max = Math.max(1, ...items.map(i => i.value))
  return (
    <div className="bars">
      {items.map(i => (
        <div key={i.label} className="bar">
          <span>{i.label}</span>
          <div className="track"><i style={{ width: (i.value / max * 100) + '%' }} /></div>
          <b>{Number(i.value).toFixed(2)}</b>
        </div>
      ))}
      {!items.length && <p className="empty">لا توجد بيانات بهذه الفترة.</p>}
    </div>
  )
}

export function Cols({ items }) {
  const max = Math.max(1, ...items.map(i => i.value))
  return (
    <div className="cols">
      {items.map((i, n) => (
        <div key={n} className="col" title={`${i.title || i.label}: ${i.value.toFixed(2)}`}>
          <i style={{ height: (i.value / max * 100) + '%' }} />
          <small>{i.label}</small>
        </div>
      ))}
    </div>
  )
}

export const groupSum = (rows, key, val) => {
  const m = {}
  rows.forEach(r => { const k = key(r); m[k] = (m[k] || 0) + val(r) })
  return Object.entries(m).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value)
}
