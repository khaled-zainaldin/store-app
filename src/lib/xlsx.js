// كاتب ملفات Excel (xlsx) بدون أي مكتبة خارجية: أوراق متعددة، عربي، واتجاه من اليمين لليسار.
// الاستخدام: downloadXlsx('تقرير.xlsx', [{ name, rows: [[...], ...], widths: [..], money: [أعمدة] }])
// الصف الأول في كل ورقة هو العناوين. الخلية قد تكون قيمة، أو { v, b: true } للخط العريض.
const enc = new TextEncoder()

const CRC = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
const crc32 = bytes => {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

const concat = parts => {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0))
  let o = 0
  parts.forEach(p => { out.set(p, o); o += p.length })
  return out
}

// ZIP بدون ضغط (store) وهو صالح تماماً لملفات xlsx
function zip(files) {
  const local = [], central = []
  let offset = 0
  const d = new Date()
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  for (const f of files) {
    const name = enc.encode(f.name), crc = crc32(f.data), size = f.data.length
    const lh = new DataView(new ArrayBuffer(30))
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true)
    lh.setUint16(10, time, true); lh.setUint16(12, date, true); lh.setUint32(14, crc, true)
    lh.setUint32(18, size, true); lh.setUint32(22, size, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true)
    local.push(new Uint8Array(lh.buffer), name, f.data)

    const ch = new DataView(new ArrayBuffer(46))
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true)
    ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true); ch.setUint16(12, time, true); ch.setUint16(14, date, true)
    ch.setUint32(16, crc, true); ch.setUint32(20, size, true); ch.setUint32(24, size, true)
    ch.setUint16(28, name.length, true); ch.setUint16(30, 0, true); ch.setUint16(32, 0, true)
    ch.setUint16(34, 0, true); ch.setUint16(36, 0, true); ch.setUint32(38, 0, true); ch.setUint32(42, offset, true)
    central.push(new Uint8Array(ch.buffer), name)
    offset += 30 + name.length + size
  }
  const cd = concat(central)
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true); end.setUint16(4, 0, true); end.setUint16(6, 0, true)
  end.setUint16(8, files.length, true); end.setUint16(10, files.length, true)
  end.setUint32(12, cd.length, true); end.setUint32(16, offset, true); end.setUint16(20, 0, true)
  return concat([...local, cd, new Uint8Array(end.buffer)])
}

const esc = s => String(s)
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const col = i => { let s = ''; for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s }

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

// أنماط: 0 عادي | 1 عنوان | 2 رقم بمنزلتين | 3 عريض | 4 عريض + رقم بمنزلتين
const STYLES = XML + `<styleSheet xmlns="${NS}"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
  '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDDE6F5"/><bgColor indexed="64"/></patternFill></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +
  '<xf numFmtId="2" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
  '<xf numFmtId="2" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyNumberFormat="1"/></cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'

function sheetXml(sh, first) {
  const money = new Set(sh.money || [])
  const rows = sh.rows.map((r, ri) => {
    const cells = r.map((c, ci) => {
      if (c === null || c === undefined || c === '') return ''
      const o = typeof c === 'object' ? c : { v: c }
      const ref = col(ci) + (ri + 1)
      const head = ri === 0 && sh.header !== false
      const bold = head || o.b
      if (typeof o.v === 'number' && Number.isFinite(o.v)) {
        const m = !head && (o.money !== undefined ? o.money : money.has(ci))
        const s = head ? 1 : m ? (bold ? 4 : 2) : (bold ? 3 : 0)
        const v = m ? Math.round(o.v * 100) / 100 : o.v
        return `<c r="${ref}"${s ? ` s="${s}"` : ''}><v>${v}</v></c>`
      }
      const s = head ? 1 : bold ? 3 : 0
      return `<c r="${ref}" t="inlineStr"${s ? ` s="${s}"` : ''}><is><t xml:space="preserve">${esc(o.v)}</t></is></c>`
    }).join('')
    return `<row r="${ri + 1}">${cells}</row>`
  }).join('')
  const cols = (sh.widths || []).map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')
  return XML + `<worksheet xmlns="${NS}"><sheetViews><sheetView workbookViewId="0" rightToLeft="1"${first ? ' tabSelected="1"' : ''}/></sheetViews>` +
    (cols ? `<cols>${cols}</cols>` : '') + `<sheetData>${rows}</sheetData></worksheet>`
}

const safeName = (s, used) => {
  let n = String(s).replace(/[\[\]:*?/\\]/g, ' ').trim().slice(0, 31) || 'ورقة'
  let k = 2, base = n
  while (used.has(n)) n = base.slice(0, 28) + ' ' + k++
  used.add(n)
  return n
}

export function buildXlsx(sheets) {
  const used = new Set()
  const names = sheets.map(s => safeName(s.name, used))
  const files = [
    { name: '[Content_Types].xml', xml: XML + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>' },
    { name: '_rels/.rels', xml: XML + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: 'xl/workbook.xml', xml: XML + `<workbook xmlns="${NS}" xmlns:r="${REL}"><sheets>` +
      names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') + '</sheets></workbook>' },
    { name: 'xl/_rels/workbook.xml.rels', xml: XML + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
      `<Relationship Id="rId${sheets.length + 1}" Type="${REL}/styles" Target="styles.xml"/></Relationships>` },
    { name: 'xl/styles.xml', xml: STYLES },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, xml: sheetXml(s, i === 0) }))
  ].map(f => ({ name: f.name, data: enc.encode(f.xml) }))
  return zip(files)
}

export function downloadXlsx(filename, sheets) {
  const bytes = buildXlsx(sheets)
  const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.replace(/[\\/:*?"<>|]/g, '-')
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}
