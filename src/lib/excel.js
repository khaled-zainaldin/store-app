// تحميل مكتبة xlsx عند أول تنزيل فقط حتى لا تثقل الصفحة (npm i xlsx)
export async function downloadWorkbook(filename, sheets) {
  const XLSX = await import('xlsx')
  const wb = XLSX.utils.book_new()
  wb.Workbook = { Views: [{ RTL: true }] }
  const used = new Set()
  sheets.forEach(({ name, rows }) => {
    const data = rows.length ? rows : [{ 'لا توجد بيانات': '' }]
    const ws = XLSX.utils.json_to_sheet(data)
    const keys = Object.keys(data[0])
    ws['!cols'] = keys.map(k => ({
      wch: Math.min(40, Math.max(String(k).length, ...data.map(r => String(r[k] ?? '').length)) + 2)
    }))
    let n = name.replace(/[:\\/?*[\]]/g, ' ').slice(0, 31)
    while (used.has(n)) n = n.slice(0, 28) + '_' + used.size
    used.add(n)
    XLSX.utils.book_append_sheet(wb, ws, n)
  })
  XLSX.writeFile(wb, filename)
}
