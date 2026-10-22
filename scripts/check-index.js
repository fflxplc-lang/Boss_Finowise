/* The SPA's inline script, checked for syntax the way node --check checks
   a .js file. node --check server.js says nothing at all about index.html,
   which is where every change in this app actually lands. */
const fs = require('fs'), vm = require('vm'), path = require('path');
const file = path.join(__dirname, '..', 'public', 'index.html');
const html = fs.readFileSync(file, 'utf8');
const blocks = [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)];
let n = 0, bad = 0;
blocks.forEach((m, i) => {
  const code = m[1];
  if(!code.trim()) return;
  n++;
  const line = html.slice(0, m.index).split('\n').length;
  try { new vm.Script(code, {filename: 'index.html:script' + i}); }
  catch (e) { bad++; console.log('SYNTAX ERROR in script starting at line ' + line + ': ' + e.message); }
});
console.log(bad ? bad + ' of ' + n + ' inline scripts failed to parse' : n + ' inline scripts parse cleanly');
process.exit(bad ? 1 : 0);
