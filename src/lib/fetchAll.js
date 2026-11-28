// Supabase يحدّ الطلب الواحد بـ 1000 صف. هذه الدالة تجلب كل الصفوف على دفعات.
// make: دالة تُرجع استعلاماً جديداً في كل مرة، ويجب أن يتضمن ترتيباً ثابتاً (يفضّل order('id') في آخره).
export async function fetchAll(make, size = 1000) {
  const out = []
  for (let from = 0; ; from += size) {
    const { data, error } = await make().range(from, from + size - 1)
    if (error) throw error
    out.push(...(data || []))
    if (!data || data.length < size) break
  }
  return out
}
