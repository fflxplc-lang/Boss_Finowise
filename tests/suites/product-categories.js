/* WHAT THE FIRM SELLS, IN THE FIRM'S OWN WORDS.

   Investment Category shipped as an asset-class list — Equity, Debt,
   Hybrid, Insurance, PMS, AIF, LAS, Other. That is a different
   question from the one the field asks. On a DBT entry and on an
   allocation line it means what the client is buying, and the firm
   wrote down what they sell: Mutual Fund, SIF, Stocks, PMS, AIF, GIFT
   CITY, Fixed Income, Other.

   Changing the shipped default moves nothing on a running site, where
   the list is data. So it is brought across once, on load — and the
   bargain is that nothing anybody recorded is disturbed. An old
   category nothing is filed under goes. One that records still name
   is DEACTIVATED: out of the picker, so nothing new lands on it, and
   every entry already filed under it reads exactly as it did. */
const {suite} = require('../lib/harness');

const WANT = ['Mutual Fund','SIF','Stocks','PMS','AIF','GIFT CITY','Fixed Income','Other'];
const PLATFORMS = ['Ametra','Anand Rathi','Finowise','Fixed Income','GIFT CITY','Motilal Oswal',
  'NJ','Omni Science','Philip Capital','Piper Serica','Volt Money','Other'];

suite(async t => {
  await t.home();

  t.section('the list the firm wrote down');

  await t.step('the shipped lists are what the firm wrote down, in order', async () => {
    const r = await t.eval(()=>({cat: PRODUCT_CATEGORIES.slice(), plat: ALLOC_PLATFORMS.slice()}));
    if(r.cat.join(' | ') !== WANT.join(' | '))
      throw new Error('the categories ship as ' + r.cat.join(', '));
    if(r.plat.join(' | ') !== PLATFORMS.join(' | '))
      throw new Error('the platforms ship as ' + r.plat.join(', '));
    return r.cat.length + ' categories and ' + r.plat.length + ' platforms';
  });

  await t.step('a list already in use is brought across once', async () => {
    const r = await t.eval(async (want)=>{
      /* The shape on the firm's books: the old asset-class list, with
         business filed under two of them and nothing under the rest. */
      delete DB.config.productCategoriesAlignedAt;
      DB.settings['business.productCategories'] = {value:
        ['Equity','Debt','Hybrid','Insurance','PMS','AIF','LAS','Other']
          .map(l=>({id:'OPT-'+l.replace(/\s/g,''), label:l, isActive:true, isArchived:false})),
        updatedAt:new Date().toISOString(), updatedBy:'test'};
      const keptId = 'OPT-PMS';
      DB.businessEntries.push({id: uid('DBT'), productCategory:'Equity', amount:'1',
        status:'Not Started', createdAt:new Date().toISOString()});
      DB.transactions.push({id: uid('TXN'), productCategory:'LAS', amount:'1',
        status:'Not Started', createdAt:new Date().toISOString()});
      await save('settings'); await save('businessEntries'); await save('transactions');
      await save('config');
      const used = configListInUse(PRODUCT_CATEGORY_USERS);
      const first = await alignProductCategoriesOnce();
      const again = await alignProductCategoriesOnce();
      const all = cfgAll('business.productCategories');
      const label = x => (x && x.label) || '';
      return {first, again,
        active: cfgLabels('business.productCategories'),
        off: all.filter(x=>x.isActive === false).map(label).sort(),
        /* Of the old list, the ones no record names must be gone. */
        unusedKept: ['Debt','Hybrid','Insurance']
          .filter(l=>!used[cfgNorm(l)] && all.some(x=>label(x) === l)),
        pmsKeptItsId: all.some(x=>x.id === keptId && label(x) === 'PMS'),
        entryUntouched: DB.businessEntries.some(e=>e.productCategory === 'Equity'),
        txnUntouched: DB.transactions.some(x=>x.productCategory === 'LAS')};
    });
    if(!r.first) throw new Error('the alignment did nothing on a list that plainly needed it');
    if(r.again) throw new Error('it ran a second time');
    if(r.active.join(' | ') !== WANT.join(' | '))
      throw new Error('the picker reads ' + r.active.join(', '));
    /* Equity and LAS are named by records, so they stand aside rather
       than vanish; Debt, Hybrid and Insurance are named by nothing. */
    /* Which old categories stand aside depends on what the store
       holds, so what is asserted is the RULE, not a list: the two this
       fixture files records under must stand aside, and nothing on the
       firm's own list may. A category this store happens to use for
       something else standing aside too is the rule working. */
    ['Equity','LAS'].forEach(l=>{
      if(r.off.indexOf(l) < 0)
        throw new Error(l + ' is named by a record and did not stand aside; off: ' + r.off.join(', '));
    });
    const wrongly = r.off.filter(l=>WANT.indexOf(l) >= 0);
    if(wrongly.length) throw new Error('deactivated something on the firm\'s own list: ' + wrongly.join(', '));
    if(r.unusedKept.length)
      throw new Error('an old category nothing names was kept: ' + r.unusedKept.join(', '));
    if(!r.pmsKeptItsId) throw new Error('PMS was rebuilt rather than kept, so its id moved');
    if(!r.entryUntouched) throw new Error('an entry filed under Equity was re-filed');
    if(!r.txnUntouched) throw new Error('a transaction filed under LAS was re-filed');
    return 'eight in the picker; Equity and LAS stand aside because records name them ('
      + r.off.join(', ') + ' in all); the unused old ones removed; nothing re-filed';
  });

  await t.step('the platform list is brought across on the same terms', async () => {
    const r = await t.eval(async ()=>{
      delete DB.config.platformsAlignedAt;
      DB.settings['alloc.platforms'] = {value:
        ['BSE StAR MF','NSE NMF II','MF Utilities','AMC Direct','PMS Platform','AIF Platform','Other']
          .map(l=>({id:'PLT-'+l.replace(/[^A-Za-z]/g,''), label:l, isActive:true, isArchived:false})),
        updatedAt:new Date().toISOString(), updatedBy:'test'};
      /* One order really was placed on AIF Platform; the rest were never used. */
      DB.transactions.push({id: uid('TXN'), platform:'AIF Platform', amount:'1',
        status:'Not Started', createdAt:new Date().toISOString()});
      await save('settings'); await save('transactions'); await save('config');
      const used = configListInUse(PLATFORM_USERS);
      const first = await alignPlatformsOnce();
      const again = await alignPlatformsOnce();
      const all = cfgAll('alloc.platforms');
      const label = x => (x && x.label) || '';
      return {first, again, active: cfgLabels('alloc.platforms'),
        off: all.filter(x=>x.isActive === false).map(label),
        unusedKept: ['NSE NMF II','MF Utilities','AMC Direct','PMS Platform']
          .filter(l=>!used[cfgNorm(l)] && all.some(x=>label(x) === l)),
        otherKeptItsId: all.some(x=>x.id === 'PLT-Other' && label(x) === 'Other'),
        txnUntouched: DB.transactions.some(x=>x.platform === 'AIF Platform')};
    });
    if(!r.first) throw new Error('the alignment did nothing');
    if(r.again) throw new Error('it ran a second time');
    if(r.active.join(' | ') !== PLATFORMS.join(' | '))
      throw new Error('the picker reads ' + r.active.join(', '));
    if(r.off.indexOf('AIF Platform') < 0)
      throw new Error('an order names AIF Platform and it did not stand aside; off: ' + r.off.join(', '));
    const wrongPlat = r.off.filter(l=>PLATFORMS.indexOf(l) >= 0);
    if(wrongPlat.length)
      throw new Error('deactivated something on the firm\'s own list: ' + wrongPlat.join(', '));
    if(r.unusedKept.length)
      throw new Error('an old platform nothing names was kept: ' + r.unusedKept.join(', '));
    if(!r.otherKeptItsId) throw new Error('Other was rebuilt rather than kept, so its id moved');
    if(!r.txnUntouched) throw new Error('a transaction placed on AIF Platform was re-filed');
    return 'twelve in the picker; AIF Platform stands aside because an order names it ('
      + r.off.join(', ') + ' in all); the unused old ones are gone';
  });

  await t.step('the allocation line and the DBT form both offer them', async () => {
    const r = await t.eval((want)=>{
      const line = allocSchemeLineHtml({schemeName:'ZZ', amount:'1'}, 0, ['Lumpsum']);
      const f = BUSINESS_FIELDS.find(x=>x.k === 'productCategory');
      const has = l => line.indexOf('>' + l + '<') >= 0;
      return {onLine: want.cat.filter(has).length, onPlat: want.plat.filter(has).length,
              offLine: has('Equity'), offPlat: has('BSE StAR MF'),
              formKey: f && f.optsKey, formLabel: f && f.l};
    }, {cat: WANT, plat: PLATFORMS});
    if(r.onLine !== WANT.length)
      throw new Error('the line offers ' + r.onLine + ' of ' + WANT.length + ' categories');
    if(r.onPlat !== PLATFORMS.length)
      throw new Error('the line offers ' + r.onPlat + ' of ' + PLATFORMS.length + ' platforms');
    if(r.offLine) throw new Error('the line still offers Equity');
    if(r.offPlat) throw new Error('the line still offers BSE StAR MF');
    if(r.formKey !== 'business.productCategories')
      throw new Error('the DBT form reads a different list: ' + r.formKey);
    if(r.formLabel !== 'Investment Category')
      throw new Error('the DBT form calls it ' + r.formLabel);
    return 'the line offers the firm’s own categories and platforms, and neither old list';
  });

  await t.step('nothing was alerted', async () => {
    if(t.dialogs.length) throw new Error('alerts: ' + t.dialogs.join(' | ').slice(0, 220));
    return 'none';
  });
});
