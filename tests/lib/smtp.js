/* A MAIL SERVER THAT ONLY REMEMBERS.

   The CRM speaks SMTP over a plain socket, with no library behind it
   (server.js — "no new dependency; this deployment forbids anything that
   compiles at install time"). So the way to find out what a letter actually
   said is to answer it: this is enough of an SMTP server to accept one and
   keep it.

   Plain TCP, no STARTTLS offered and no credentials wanted — which is
   precisely the path server.js takes when the connector carries no password,
   so nothing has to be stubbed and nothing has to hold a certificate. Tell
   the CRM about it with connector(port) below.

   Everything it is handed lands in .received, newest last:
     {from, to:[…], body, subject, text}
*/
const net = require('net');

function headerOf(head, name){
  const re = new RegExp('^' + name + ':[ \\t]*([\\s\\S]*?)(?=\\r\\n[^ \\t]|$)', 'im');
  const m = re.exec(head);
  return m ? m[1].replace(/\r\n[ \t]+/g, ' ').trim() : '';
}

/* A body arrives encoded more often than not — base64 for anything the
   transport might mangle, quoted-printable for the rest. A suite looking for
   a sentence in a letter should not have to know which. */
function decodeBody(body, enc){
  const e = String(enc || '').toLowerCase();
  if(e === 'base64'){
    try { return Buffer.from(body.replace(/\s+/g, ''), 'base64').toString('utf8'); }
    catch(err){ return body; }
  }
  if(e === 'quoted-printable'){
    return body.replace(/=\r?\n/g, '')
               .replace(/=([0-9A-F]{2})/gi, (m, h) => String.fromCharCode(parseInt(h, 16)));
  }
  return body;
}

function parse(raw){
  const sep = raw.indexOf('\r\n\r\n');
  const head = sep < 0 ? raw : raw.slice(0, sep);
  let body = sep < 0 ? '' : raw.slice(sep + 4);
  const ctype = headerOf(head, 'Content-Type');
  let text;

  const boundary = (/boundary="?([^";\r\n]+)"?/i.exec(ctype) || [])[1];
  if(boundary){
    /* An attachment turns the letter into a multipart, and the words are in
       the first text part. The parts after it are the files, which a suite
       can still reach through .body if it wants them. */
    const parts = body.split('--' + boundary);
    const wanted = parts.find(p => /content-type:\s*text\/plain/i.test(p)) || parts[1] || '';
    const i = wanted.indexOf('\r\n\r\n');
    const ph = i < 0 ? '' : wanted.slice(0, i);
    const pb = i < 0 ? wanted : wanted.slice(i + 4);
    text = decodeBody(pb, headerOf(ph, 'Content-Transfer-Encoding'));
  } else {
    text = decodeBody(body, headerOf(head, 'Content-Transfer-Encoding'));
  }

  // `to` stays the envelope's (RCPT TO) list, which is who it really went
  // to; the To: header is kept separately as what the letter displays.
  return {head, text, subject: decodeHeader(headerOf(head, 'Subject')), toHeader: headerOf(head, 'To')};
}

/* Subjects with anything but plain ASCII travel MIME-encoded. A test that
   looks for a word in a subject should not have to know that. */
function decodeHeader(v){
  return String(v || '').replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g, (all, charset, enc, data)=>{
    try {
      if(/b/i.test(enc)) return Buffer.from(data, 'base64').toString('utf8');
      return data.replace(/_/g, ' ').replace(/=([0-9A-F]{2})/gi, (m,h)=>String.fromCharCode(parseInt(h,16)));
    } catch(e){ return all; }
  });
}

function start(port){
  const received = [];
  const server = net.createServer(sock => {
    let buf = '', inData = false, data = '', env = {from:'', to:[]};
    const say = s => { try { sock.write(s + '\r\n'); } catch(e){} };
    say('220 finowise-test ESMTP ready');
    sock.setEncoding('utf8');
    sock.on('error', ()=>{});
    sock.on('data', chunk => {
      buf += chunk;
      let i;
      while((i = buf.indexOf('\r\n')) > -1){
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        if(inData){
          if(line === '.'){
            inData = false;
            const parsed = parse(data);
            received.push(Object.assign({from: env.from, to: env.to.slice(), body: data}, parsed));
            data = ''; env = {from:'', to:[]};
            say('250 2.0.0 Ok: queued');
          } else {
            // a line of body starting with a dot arrives doubled
            data += (line.startsWith('..') ? line.slice(1) : line) + '\r\n';
          }
          continue;
        }
        const up = line.toUpperCase();
        if(up.startsWith('EHLO') || up.startsWith('HELO')){
          // No STARTTLS in the list: with no password configured the CRM is
          // happy to carry on in the clear, which is the path under test.
          say('250-finowise-test'); say('250-8BITMIME'); say('250 SIZE 10485760');
        }
        else if(up.startsWith('MAIL FROM')){ env.from = (/<([^>]*)>/.exec(line)||[])[1] || ''; say('250 2.1.0 Ok'); }
        else if(up.startsWith('RCPT TO')){ env.to.push((/<([^>]*)>/.exec(line)||[])[1] || ''); say('250 2.1.5 Ok'); }
        else if(up === 'DATA'){ inData = true; say('354 End data with <CR><LF>.<CR><LF>'); }
        else if(up === 'RSET'){ env = {from:'', to:[]}; say('250 2.0.0 Ok'); }
        else if(up === 'QUIT'){ say('221 2.0.0 Bye'); sock.end(); }
        else if(up === 'NOOP'){ say('250 2.0.0 Ok'); }
        else say('250 2.0.0 Ok');
      }
    });
  });
  const ready = new Promise(res => server.listen(port, '127.0.0.1', res));
  return {
    received,
    ready,
    port,
    clear(){ received.length = 0; },
    /* Every letter whose subject or body mentions this. */
    matching(re){ return received.filter(m => re.test(m.subject) || re.test(m.text) || re.test(m.body)); },
    close(){ return new Promise(res => server.close(res)); },
  };
}

/* What to write into the CRM's connector store so it posts here. Shaped the
   way the app saves it from Setup → Developer Hub → Connections. */
function connector(port){
  return {host:'127.0.0.1', port, secure:false, username:'',
          fromName:'Finowise Test', fromEmail:'crm@finowise.test'};
}

module.exports = {start, connector};
