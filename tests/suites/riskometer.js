/* TWO RISKOMETERS: ONE PER SCHEME, ONE FOR THE PORTFOLIO.

   SEBI's riskometer belongs to a scheme, and the Scheme Master
   carries each one. A client holding four of them has no single
   official figure — there is no such instrument — so the portfolio
   band is the firm's own view: the schemes' own bands weighted by
   the money going into each.

   What has to hold: the blend is the weighted one and not a plain
   average; a line whose scheme has no band is left OUT of it and
   counted rather than quietly averaged in; and the document says in
   words that the portfolio reading is the firm's and not a
   regulator's. */
const {suite} = require('../lib/harness');

const SHEET = (lines)=>({id:'REC-ZZRISK', clientId:'', status:'Draft', attachments:[],
  productCategory:'Mutual Fund', investmentMode:'Lumpsum', schemes:lines,
  createdAt:new Date().toISOString()});

suite(async t => {
  await t.home();
  await t.eval(src => { window.SHEET_FN = eval('(' + src + ')'); }, String(SHEET));

  t.section('the blend is weighted by the money');

  await t.step('the money decides the band, not the count of lines', async () => {
    const r = await t.eval(()=>{
      const mk = (amount, riskLevel) => ({schemeName:'ZZ', amount:String(amount), riskLevel});
      const bands = allocRiskBands();
      /* Nine lakh at Low against one lakh at Very High is a low
         portfolio, however even the line count looks. */
      const lowHeavy = allocPortfolioRisk({schemes:[mk(900000,'Low'), mk(100000,'Very High')]});
      const highHeavy = allocPortfolioRisk({schemes:[mk(100000,'Low'), mk(900000,'Very High')]});
      const even = allocPortfolioRisk({schemes:[mk(500000,'Low'), mk(500000,'Very High')]});
      return {bands, low: lowHeavy.band, lowIdx: lowHeavy.index,
              high: highHeavy.band, highIdx: highHeavy.index,
              even: even.band, evenIdx: even.index};
    });
    if(r.lowIdx !== 1) throw new Error('9L Low + 1L Very High read ' + r.low + ' (' + r.lowIdx + ')');
    /* 1:9 toward Very High reads 4.5, and a reading between two
       bands goes to the HIGHER one: a risk disclosure should never
       round in the portfolio's favour. */
    if(r.highIdx !== 5) throw new Error('1L Low + 9L Very High read ' + r.high + ' (' + r.highIdx + ')');
    if(r.evenIdx !== 3) throw new Error('an even split read ' + r.even + ' (' + r.evenIdx + ')');
    return '9:1 toward Low reads ' + r.low + '; 1:9 toward Very High reads ' + r.high
      + '; an even split reads ' + r.even + ' \u2014 a tie rounds up, never down';
  });

  await t.step('a scheme with no band is left out and counted', async () => {
    const r = await t.eval(()=>{
      const p = allocPortfolioRisk({schemes:[
        {schemeName:'ZZ A', amount:'500000', riskLevel:'Low'},
        {schemeName:'ZZ B', amount:'500000', riskLevel:''},
      ]});
      const none = allocPortfolioRisk({schemes:[
        {schemeName:'ZZ C', amount:'500000', riskLevel:''},
      ]});
      return {band: p.band, index: p.index, unrated: p.unrated, amt: p.unratedAmt,
              rated: p.rated, noneIdx: none.index, noneUnrated: none.unrated};
    });
    /* Left out, not averaged: the reading is the Low line's own. */
    if(r.index !== 0) throw new Error('an unrated line moved the band to ' + r.band);
    if(r.unrated !== 1) throw new Error('it counted ' + r.unrated + ' unrated lines');
    if(r.amt !== 500000) throw new Error('it put ' + r.amt + ' outside the reading');
    if(r.rated !== 500000) throw new Error('it weighted ' + r.rated + ' inside it');
    if(r.noneIdx !== -1) throw new Error('a sheet with no bands at all gave a reading anyway');
    if(r.noneUnrated !== 1) throw new Error('it did not count the unrated line');
    return 'the unrated 5,00,000 sits outside the reading and is counted, not averaged in';
  });

  t.section('what the document shows, and what it claims');

  await t.step('both riskometers are drawn, and the portfolio one is not claimed as official', async () => {
    const r = await t.eval(()=>{
      const rec = SHEET_FN([
        {schemeName:'ZZ Risk A', amount:'700000', riskLevel:'Very High', fundObjective:'x'},
        {schemeName:'ZZ Risk B', amount:'300000', riskLevel:'Low', fundObjective:'y'},
      ]);
      const html = allocationDocHtml(rec);
      return {/* The blend is now the Portfolio Risk Meter, in the Risk Profile
                 section, drawn as a dial beside the client's own rather than
                 as a strip at the foot of the document. It is the same
                 reading off the same allocPortfolioRisk. */
              portfolio: /PORTFOLIO RISK METER/.test(html),
              noIseq: /No Investor Suitability Questionnaire on file/.test(html),
              dial: (html.match(/risk-meter-dial/g) || []).length,
              scheme: (html.match(/SCHEME RISKOMETER/g) || []).length,
              strips: (html.match(/riskometer-strip/g) || []).length,
              marked: (html.match(/riskometer-seg[^"]*on/g) || []).length,
              honest: /not a regulatory figure/.test(html),
              saysWhy: /weighted by the amount/.test(html)};
    });
    if(!r.portfolio) throw new Error('there is no portfolio riskometer on the document');
    /* This fixture's client has no questionnaire on file, so the client
       side says so rather than drawing a needle off nothing; the
       portfolio's own dial is the one this step is about. */
    if(r.dial !== 1) throw new Error(r.dial + ' dials drawn, expected 1 (the portfolio\u2019s)');
    if(!r.noIseq) throw new Error('the client meter drew something without a questionnaire');
    if(r.scheme !== 2) throw new Error('the per-scheme riskometer appears ' + r.scheme + ' times, not 2');
    if(r.strips !== 2) throw new Error(r.strips + ' strips drawn, expected 2 (one per scheme)');
    if(r.marked < 2) throw new Error('a band was not marked on every strip');
    /* The honesty of this is the point: a blend presented as a
       regulator's figure would be a lie told in a client's name. */
    if(!r.honest) throw new Error('the document does not say the portfolio reading is not regulatory');
    if(!r.saysWhy) throw new Error('it does not say how the blend was arrived at');
    return 'two scheme riskometers and the portfolio blend as its own meter, named as the firm’s own';
  });

  await t.step('a sheet whose schemes carry no band says so rather than guessing', async () => {
    const r = await t.eval(()=>{
      const rec = SHEET_FN([{schemeName:'ZZ Risk C', amount:'500000', riskLevel:''}]);
      const html = allocationDocHtml(rec);
      return {says: /no portfolio reading can be given/.test(html),
              noBlend: !/weighted by the amount/.test(html)};
    });
    if(!r.says) throw new Error('it did not say why there is no reading');
    if(!r.noBlend) throw new Error('it described a blend it did not make');
    return 'it says no reading can be given, and claims no blend';
  });

  await t.step('a renamed band still reads', async () => {
    const r = await t.eval(()=>({
      low: allocRiskIndex('Low'), veryHigh: allocRiskIndex('Very High'),
      cased: allocRiskIndex('very  HIGH'), unknown: allocRiskIndex('Zzxq'),
      blank: allocRiskIndex(''),
    }));
    if(r.low !== 0) throw new Error('Low reads ' + r.low);
    if(r.veryHigh !== 5) throw new Error('Very High reads ' + r.veryHigh);
    if(r.cased !== 5) throw new Error('case and spacing changed the reading: ' + r.cased);
    if(r.unknown !== -1) throw new Error('a band it cannot place returned ' + r.unknown);
    if(r.blank !== -1) throw new Error('an empty band returned ' + r.blank);
    return 'bands read regardless of case and spacing; an unknown one is left unplaced';
  });

  await t.step('nothing was alerted', async () => {
    if(t.dialogs.length) throw new Error('alerts: ' + t.dialogs.join(' | ').slice(0, 220));
    return 'none';
  });
});
