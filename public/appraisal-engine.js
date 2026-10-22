/*!
 * appraisal-engine.js  —  portable Appraisal Calculation module
 * -----------------------------------------------------------------------------
 * Pure functions only: no DOM, no storage, no framework, no globals required.
 * Works in the browser (<script src>), Node (require), and bundlers (import).
 *
 * THE MODEL
 *   Company Growth Pool % = 50% Absolute growth + 25% SIP growth + 25% New Lumpsum growth
 *   5 Cs Score (0-100)    = Curiosity + Competence + Commitment + Creativity   (manager ratings, weighted)
 *                           + Contribution                                      (role KPIs, banded)
 *   Increment %           = Pool % x (5 Cs Score / 100)
 *   Appraisal Amount      = Current Annual Salary x Increment %
 *   New Salary            = Current Annual Salary + Appraisal Amount
 *   A manager may override the 5 Cs Score (0-100); the override replaces the computed score.
 *
 * QUICK START
 *   const A = require('./appraisal-engine.js');          // Node
 *   // or: <script src="appraisal-engine.js"></script>   -> window.AppraisalEngine
 *
 *   const result = A.computeAppraisal({
 *     config : A.DEFAULT_CONFIG,                    // or your own (see CONFIG SHAPE below)
 *     roleKey: 'clientsRM',                         // 'clientsRM' | 'partnersRM' | 'operations' | null
 *     salary : 650000,                              // current ANNUAL CTC
 *     growth : { abs: 18, sip: 22, lump: 15 },      // company growth %, for the appraisal year
 *     rating : {
 *       curiosity: 85, competence: 82, commitment: 90, creativity: 70,   // each 0-100
 *       kpi: [95, 80, 75],                          // achievement % for each KPI of the role, in order
 *       scoreOverride: null                         // or a number 0-100 to override the 5 Cs score
 *     }
 *   });
 *   // -> { score, computedScore, isOverridden, pool, incrementPct, amount, newSalary,
 *   //      monthlyCTC, newMonthlyCTC, breakdown: { curiosity, competence, ..., contribution, kpis:[...] } }
 *
 * CONFIG SHAPE (all editable; see DEFAULT_CONFIG)
 *   cycle     : 'FY' (Apr-Mar) | 'calendar' (Jan-Dec)
 *   cWeights  : { curiosity, competence, commitment, creativity }   Contribution weight = 100 - sum(these)
 *   poolWeights: { abs: 0.5, sip: 0.25, lump: 0.25 }
 *   targets   : { opsPoints, meetings }         annual defaults used by achievementPct() helpers
 *   roles     : { [roleKey]: { label, kpis: [ { key, label, weight, auto, bands:[{min,val}...] } ] } }
 *               A KPI scores `val` of the first band whose `min` <= achievement % (bands are sorted high->low).
 * -----------------------------------------------------------------------------
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else if (typeof define === 'function' && define.amd) define(factory);
  else root.AppraisalEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ======================= DEFAULT CONFIG ======================= */
  var STD10_BANDS = [
    { min: 100, val: 10 }, { min: 75, val: 7.5 }, { min: 50, val: 5 }, { min: 25, val: 2.5 }, { min: 0, val: 0 }
  ];
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  var DEFAULT_CONFIG = {
    cycle: 'FY',
    cWeights: { curiosity: 5, competence: 20, commitment: 20, creativity: 5 },
    poolWeights: { abs: 0.5, sip: 0.25, lump: 0.25 },
    targets: { opsPoints: 2400, meetings: 300 },
    roles: {
      clientsRM: {
        label: 'Clients RM',
        kpis: [
          { key: 'meetings',       label: 'Meetings Target Achieved',                     weight: 30, auto: 'meetings',
            bands: [{ min: 100, val: 30 }, { min: 75, val: 25 }, { min: 50, val: 15 }, { min: 25, val: 10 }, { min: 0, val: 0 }] },
          { key: 'newClientLeads', label: 'New Clients Conversion to Leads',              weight: 10, auto: null, bands: clone(STD10_BANDS) },
          { key: 'addlBiz',        label: 'Additional Business to Review Meeting Ratio',  weight: 10, auto: null, bands: clone(STD10_BANDS) }
        ]
      },
      partnersRM: {
        label: 'Partners RM',
        kpis: [
          { key: 'webinar',      label: 'Lead to Live Webinar Attendance Ratio',      weight: 10, auto: null, bands: clone(STD10_BANDS) },
          { key: 'nismPass',     label: 'NISM Enrollment to Pass Ratio',              weight: 10, auto: null, bands: clone(STD10_BANDS) },
          { key: 'empanellment', label: 'NISM Pass to Empanellment Ratio',            weight: 10, auto: null, bands: clone(STD10_BANDS) },
          { key: 'activation',   label: 'Empanellment to Business Activation Ratio',  weight: 10, auto: null, bands: clone(STD10_BANDS) },
          { key: 'partnerQuery', label: 'Partners Query Registered & Resolve Ratio',  weight: 10, auto: null, bands: clone(STD10_BANDS) }
        ]
      },
      operations: {
        label: 'Operations',
        kpis: [
          { key: 'completedTasks',   label: 'Completed Tasks Ratio',                         weight: 30, auto: 'opsPoints',
            bands: [{ min: 100, val: 30 }, { min: 50, val: 25 }, { min: 25, val: 15 }, { min: 0, val: 0 }] },
          { key: 'projectCompleted', label: 'Project Completed %',                           weight: 10, auto: null, bands: clone(STD10_BANDS) },
          { key: 'queryResolved',    label: 'Clients Query Registered to Resolved Ratio',    weight: 10, auto: null, bands: clone(STD10_BANDS) }
        ]
      }
    }
  };

  /* ======================= SMALL HELPERS ======================= */
  function num(v) { var n = parseFloat(v); return isNaN(n) ? 0 : n; }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function round2(v) { return Math.round(v * 100) / 100; }

  /** Points earned by one KPI: first band (highest min first) that the achievement % reaches. */
  function scoreFromBand(bands, achieved) {
    achieved = num(achieved);
    var sorted = (bands || []).slice().sort(function (a, b) { return b.min - a.min; });
    for (var i = 0; i < sorted.length; i++) if (achieved >= sorted[i].min) return sorted[i].val;
    return 0;
  }

  /* ======================= COMPANY GROWTH POOL ======================= */
  /** Pool % from the three company growth figures (each a percentage). */
  function companyGrowthPool(growth, poolWeights) {
    var w = poolWeights || DEFAULT_CONFIG.poolWeights;
    growth = growth || {};
    return num(growth.abs) * w.abs + num(growth.sip) * w.sip + num(growth.lump) * w.lump;
  }

  /**
   * Optional: derive one growth % from raw AUM figures.
   * B2C growth counts 100%, B2B growth counts 10%, divided by total opening AUM.
   * row = { b2cO, b2cC, b2bO, b2bC }  (opening/closing for B2C and B2B)
   */
  function creditedGrowthPct(row) {
    var b2cO = num(row.b2cO), b2cC = num(row.b2cC), b2bO = num(row.b2bO), b2bC = num(row.b2bC);
    var credited = (b2cC - b2cO) * 1.0 + (b2bC - b2bO) * 0.10;
    var base = b2cO + b2bO;
    return base > 0 ? Math.round((credited / base) * 10000) / 100 : 0;
  }

  /* ======================= 5 Cs ======================= */
  /**
   * rating = { curiosity, competence, commitment, creativity (0-100 each), kpi: [achievement %, ...] }
   * roleKey picks the KPI set from config.roles (null = no Contribution KPIs).
   */
  function compute5C(config, roleKey, rating) {
    var w = config.cWeights;
    rating = rating || {};
    var cur  = (num(rating.curiosity)  / 100) * w.curiosity;
    var comp = (num(rating.competence) / 100) * w.competence;
    var com  = (num(rating.commitment) / 100) * w.commitment;
    var cre  = (num(rating.creativity) / 100) * w.creativity;

    var role = roleKey ? config.roles[roleKey] : null;
    var contribution = 0, kpis = [];
    if (role) {
      role.kpis.forEach(function (k, i) {
        var achieved = (rating.kpi && rating.kpi[i] !== undefined) ? num(rating.kpi[i]) : 0;
        var pts = scoreFromBand(k.bands, achieved);
        kpis.push({ key: k.key, label: k.label, weight: k.weight, achieved: achieved, points: pts });
        contribution += pts;
      });
    }
    var contributionWeight = 100 - (w.curiosity + w.competence + w.commitment + w.creativity);
    return {
      curiosity: cur, competence: comp, commitment: com, creativity: cre,
      contribution: contribution, contributionWeight: contributionWeight, kpis: kpis,
      total: cur + comp + com + cre + contribution
    };
  }

  /* ======================= MAIN: FULL APPRAISAL ======================= */
  /**
   * input = { config, roleKey, salary, growth:{abs,sip,lump}, rating:{..., scoreOverride} }
   * `salary` is the current ANNUAL CTC.
   */
  function computeAppraisal(input) {
    var config = input.config || DEFAULT_CONFIG;
    var rating = input.rating || {};
    var c = compute5C(config, input.roleKey || null, rating);

    var ov = rating.scoreOverride;
    var isOverridden = !(ov === null || ov === undefined || ov === '');
    var score = isOverridden ? clamp(num(ov), 0, 100) : c.total;

    var pool = companyGrowthPool(input.growth, config.poolWeights);
    var salary = num(input.salary);
    var incrementPct = pool * (score / 100);
    var amount = salary * (incrementPct / 100);
    var newSalary = Math.round(salary + amount);

    return {
      score: score,                       // score actually used for the increment
      computedScore: c.total,             // what the formula says (before any override)
      isOverridden: isOverridden,
      pool: pool,
      incrementPct: incrementPct,
      salary: salary,
      amount: Math.round(amount),
      newSalary: newSalary,
      monthlyCTC: salary / 12,
      newMonthlyCTC: newSalary / 12,
      breakdown: {
        curiosity: c.curiosity, competence: c.competence, commitment: c.commitment, creativity: c.creativity,
        contribution: c.contribution, contributionWeight: c.contributionWeight, kpis: c.kpis
      }
    };
  }

  /* ======================= APPRAISAL YEAR HELPERS ======================= */
  var MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  /** 'Sep-2026' style key from a date or 'YYYY-MM-DD' string. */
  function monthKey(date) {
    if (!date) return '';
    var d = (date instanceof Date) ? date : new Date(String(date).slice(0, 10) + 'T00:00:00');
    return isNaN(d.getTime()) ? '' : MONTHS[d.getMonth()] + '-' + d.getFullYear();
  }

  /** The 12 month keys an appraisal year covers. FY 2026 = Apr-2026 ... Mar-2027. */
  function appraisalMonthKeys(year, cycle) {
    var y = parseInt(year, 10), keys = [], m;
    if ((cycle || 'FY') === 'FY') {
      for (m = 3; m < 12; m++) keys.push(MONTHS[m] + '-' + y);
      for (m = 0; m < 3; m++)  keys.push(MONTHS[m] + '-' + (y + 1));
    } else {
      for (m = 0; m < 12; m++) keys.push(MONTHS[m] + '-' + y);
    }
    return keys;
  }

  function appraisalYearLabel(year, cycle) {
    var y = parseInt(year, 10);
    return (cycle || 'FY') === 'FY' ? 'FY ' + y + '\u2013' + String(y + 1).slice(2) : String(y);
  }

  /** Which appraisal year "today" falls in. */
  function currentAppraisalYear(cycle, today) {
    var d = today || new Date(), y = d.getFullYear(), m = d.getMonth();
    return (cycle || 'FY') === 'FY' ? (m >= 3 ? y : y - 1) : y;
  }

  /**
   * Achievement % for an auto-suggested anchor KPI, from totals YOU supply from your own data:
   *   Operations anchor  : total Ops points earned in the year   vs  annual points target
   *   Clients RM anchor  : total meetings held in the year       vs  annual meetings target
   * Returns a number rounded to 1 decimal, ready to feed into rating.kpi[i].
   */
  function achievementPct(total, target) {
    target = num(target);
    return target > 0 ? Math.round((num(total) / target) * 1000) / 10 : 0;
  }

  return {
    DEFAULT_CONFIG: DEFAULT_CONFIG,
    STD10_BANDS: STD10_BANDS,
    scoreFromBand: scoreFromBand,
    companyGrowthPool: companyGrowthPool,
    creditedGrowthPct: creditedGrowthPct,
    compute5C: compute5C,
    computeAppraisal: computeAppraisal,
    monthKey: monthKey,
    appraisalMonthKeys: appraisalMonthKeys,
    appraisalYearLabel: appraisalYearLabel,
    currentAppraisalYear: currentAppraisalYear,
    achievementPct: achievementPct
  };
});
