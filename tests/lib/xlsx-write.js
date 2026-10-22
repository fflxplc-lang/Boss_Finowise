/* A minimal .xlsx writer, for fixtures only.
 *
 * The suite has to feed the app a real workbook, not a stand-in: the whole
 * point of the reader in index.html is that it opens the file a platform
 * actually produces. So this builds one the way Excel does — a zip of XML
 * with a shared string table, a styles part with a date format, and
 * deflate-compressed entries — rather than something shaped to be easy to
 * read back.
 *
 * Node's zlib does the deflate; nothing is installed for this. */
const zlib = require('zlib');

const X = s => String(s == null ? '' : s)
  .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
  .replace(/"/g,'&quot;').replace(/'/g,'&apos;');

function colName(i){
  let s = '';
  for(i++; i > 0; i = Math.floor((i-1)/26)) s = String.fromCharCode(65 + ((i-1) % 26)) + s;
  return s;
}
/* yyyy-mm-dd → Excel's day count. 1900 is treated as a leap year by the
   format, hence the 30 December epoch. */
function dateSerial(iso){
  const [y,m,d] = iso.split('-').map(Number);
  return Math.round((Date.UTC(y, m-1, d) - Date.UTC(1899,11,30)) / 86400000);
}

/* rows: array of arrays. A cell is a string, a number, or {d:'2026-01-15'}
   for a real Excel date (stored as a serial under a date style). */
function sheetXml(rows, shared){
  const idx = v => {
    let i = shared.indexOf(v);
    if(i < 0){ shared.push(v); i = shared.length - 1; }
    return i;
  };
  const body = rows.map((row, r)=>{
    const cells = row.map((v, c)=>{
      if(v === null || v === undefined || v === '') return '';
      const ref = colName(c) + (r+1);
      if(typeof v === 'object' && v.d) return `<c r="${ref}" s="1"><v>${dateSerial(v.d)}</v></c>`;
      if(typeof v === 'number') return `<c r="${ref}"><v>${v}</v></c>`;
      return `<c r="${ref}" t="s"><v>${idx(String(v))}</v></c>`;
    }).filter(Boolean).join('');
    return `<row r="${r+1}">${cells}</row>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}

function zip(files){
  const chunks = [], central = [];
  let at = 0;
  const crcTable = (()=>{
    const t = new Int32Array(256);
    for(let n = 0; n < 256; n++){
      let c = n;
      for(let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })();
  const crc32 = buf => {
    let c = -1;
    for(let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
  for(const [name, text] of files){
    const raw = Buffer.from(text, 'utf8');
    const def = zlib.deflateRawSync(raw);
    const nm = Buffer.from(name, 'utf8');
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6);
    lh.writeUInt16LE(8, 8); lh.writeUInt32LE(0, 10);
    lh.writeUInt32LE(crc32(raw), 14); lh.writeUInt32LE(def.length, 18);
    lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(nm.length, 26); lh.writeUInt16LE(0, 28);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 8); cd.writeUInt16LE(8, 10); cd.writeUInt32LE(0, 12);
    cd.writeUInt32LE(crc32(raw), 16); cd.writeUInt32LE(def.length, 20);
    cd.writeUInt32LE(raw.length, 24); cd.writeUInt16LE(nm.length, 28);
    cd.writeUInt32LE(0, 30); cd.writeUInt32LE(0, 34); cd.writeUInt32LE(at, 42);
    central.push(Buffer.concat([cd, nm]));
    chunks.push(lh, nm, def);
    at += lh.length + nm.length + def.length;
  }
  const dir = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8); eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(dir.length, 12); eocd.writeUInt32LE(at, 16);
  return Buffer.concat([Buffer.concat(chunks), dir, eocd]);
}

/* One sheet, named, from a grid of rows. */
function xlsx(sheetName, rows){
  return xlsxBook([{name: sheetName, rows}]);
}
/* Several sheets, in the order given — which is how the workbook a firm
   actually uploads is shaped: the data on one sheet and the instructions
   on another, written by Excel, with one shared string table across
   both and every blank cell left out of the XML entirely. */
function xlsxBook(sheets){
  const shared = [];
  const parts = sheets.map(s=>sheetXml(s.rows, shared));
  const sst = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${shared.length}" uniqueCount="${shared.length}">${
    shared.map(s=>`<si><t xml:space="preserve">${X(s)}</t></si>`).join('')}</sst>`;
  /* Style 0 is general, style 1 is dd-mm-yyyy (numFmtId 164) — which is how
     the reader is meant to tell a date from a number. */
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="dd\\-mm\\-yyyy"/></numFmts>
<fonts count="1"><font><sz val="11"/></font></fonts>
<fills count="1"><fill><patternFill patternType="none"/></fill></fills>
<borders count="1"><border/></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>
</styleSheet>`;
  return zip([
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
${sheets.map((s, i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}
<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`],
    ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${sheets.map((s, i)=>`<sheet name="${X(s.name)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')}</sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${sheets.map((s, i)=>`<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')}
<Relationship Id="rIdS" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
<Relationship Id="rIdT" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`],
    ['xl/sharedStrings.xml', sst],
    ['xl/styles.xml', styles],
  ].concat(parts.map((xml, i)=>['xl/worksheets/sheet' + (i+1) + '.xml', xml])));
}

module.exports = {xlsx, xlsxBook, dateSerial};
