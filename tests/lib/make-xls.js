/* Real .xls / .html / SpreadsheetML fixtures for the reader tests.
 *
 * The .xls is produced by LibreOffice rather than written here. That
 * matters: a parser tested only against a file its own author wrote
 * proves the two agree, not that either is right. LibreOffice writes
 * genuine BIFF8 — the same records Excel writes, including a shared
 * string table split across CONTINUE records once the file is big
 * enough, which is the join nearly every hand-rolled reader gets wrong.
 *
 * If LibreOffice is not installed the suite says so and skips those
 * steps rather than quietly passing.
 */
const {execFileSync} = require('child_process');
const fs = require('fs');
const path = require('path');
const {xlsx} = require('./xlsx-write');

function haveLibreOffice(){
  try { execFileSync('which', ['libreoffice'], {stdio:'ignore'}); return true; }
  catch(e){ return false; }
}
/* rows → a real .xls, via a real converter. */
function makeXls(dir, name, sheetName, rows, to){
  const src = path.join(dir, name + '.xlsx');
  fs.writeFileSync(src, xlsx(sheetName, rows));
  execFileSync('libreoffice', ['--headless', '--convert-to', to || 'xls', '--outdir', dir, src],
    {stdio:'ignore', timeout: 180000});
  const out = path.join(dir, name + '.' + (to === 'html' ? 'html' : (to || 'xls')));
  if(!fs.existsSync(out)) throw new Error('the converter produced no ' + out);
  return out;
}
/* Excel's 2003 XML, written here because LibreOffice will not emit it
   headlessly. It is a simple enough format to write honestly. */
function makeSpreadsheetMl(dir, name, sheetName, rows){
  const X = s => String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const cell = v => {
    if(v === null || v === undefined || v === '') return '<Cell/>';
    if(typeof v === 'object' && v.d)
      return '<Cell><Data ss:Type="DateTime">' + v.d + 'T00:00:00.000</Data></Cell>';
    if(typeof v === 'number') return '<Cell><Data ss:Type="Number">' + v + '</Data></Cell>';
    return '<Cell><Data ss:Type="String">' + X(v) + '</Data></Cell>';
  };
  const xml = '<?xml version="1.0"?>\n'
    + '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"\n'
    + ' xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">\n'
    + '<Worksheet ss:Name="' + X(sheetName) + '"><Table>\n'
    + rows.map(r=>'<Row>' + r.map(cell).join('') + '</Row>').join('\n')
    + '\n</Table></Worksheet></Workbook>';
  const out = path.join(dir, name + '.xls');        // named .xls, as a platform would
  fs.writeFileSync(out, xml, 'utf8');
  return out;
}
module.exports = {haveLibreOffice, makeXls, makeSpreadsheetMl};
