// المتوسط المرجّح للتكلفة:
// (الكمية القديمة × التكلفة القديمة + الكمية الجديدة × التكلفة الجديدة) ÷ إجمالي الكمية
// لو المخزون القديم صفر أو سالب نعتمد التكلفة الجديدة مباشرة.
export function weightedCost(oldQty, oldCost, newQty, newCost) {
  const q = Math.max(0, Number(oldQty) || 0)
  const nq = Number(newQty) || 0
  const nc = Number(newCost) || 0
  const total = q + nq
  if (total <= 0) return nc
  return Math.round(((q * (Number(oldCost) || 0) + nq * nc) / total) * 10000) / 10000
}
