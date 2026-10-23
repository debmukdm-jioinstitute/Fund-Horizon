/* eslint-disable */
export function initRiskProfiling() {
/* ================= Data — FH Recommended List (Regular Plan, Growth) ================= */
      var FH_BY_CATEGORY = {
        "Large Cap": [
          { name: "ICICI Prudential Large Cap Fund", code: "108466" },
          { name: "DSP Large Cap Fund", code: "101635" },
          { name: "WhiteOak Capital Large Cap Fund", code: "150799" }
        ],
        "Large & Mid Cap": [
          { name: "ICICI Prudential Large & Mid Cap Fund", code: "100349" },
          { name: "Invesco India Large & Mid Cap Fund", code: "106144" },
          { name: "Bandhan Large & Mid Cap Fund", code: "108596" }
        ],
        "Mid Cap": [
          { name: "Bandhan Nifty Midcap 150 Index Fund", code: "152856" },
          { name: "WhiteOak Capital Mid Cap Fund", code: "150583" }
        ],
        "Small Cap": [
          { name: "Invesco India Small Cap Fund", code: "145139" },
          { name: "ICICI Prudential Small Cap Fund", code: "106823" },
          { name: "Edelweiss Small Cap Fund", code: "146193" },
          { name: "Helios Small Cap Fund", code: "153909" }
        ],
        "Multi Cap": [
          { name: "WhiteOak Capital Multi Cap Fund", code: "152072" },
          { name: "Mirae Asset Multicap Fund", code: "151812" },
          { name: "Edelweiss Multi Cap Fund", code: "152095" },
          { name: "HSBC Multi Cap Fund", code: "151289" }
        ],
        "Flexi Cap": [
          { name: "WhiteOak Capital Flexi Cap Fund", code: "150347" },
          { name: "HSBC Flexi Cap Fund", code: "102252" },
          { name: "Edelweiss Flexi Cap Fund", code: "140355" },
          { name: "Helios Flexi Cap Fund", code: "152136" },
          { name: "Invesco India Flexi Cap Fund", code: "149766" }
        ],
        "Multi Asset": [
          { name: "DSP Multi Asset Allocation Fund", code: "152053" },
          { name: "Nippon India Multi Asset Allocation Fund", code: "148459" },
          { name: "WhiteOak Capital Multi Asset Allocation Fund", code: "151746" },
          { name: "Invesco India Multi Asset Allocation Fund", code: "153046" },
          { name: "Kotak Multi Asset Allocation Fund", code: "152065" }
        ]
      };
      function catRole(cat) {
        var roles = {
          "Large Cap": "Large, established companies — the steadier equity part of the plan.",
          "Large & Mid Cap": "A mix of large and mid-size companies for growth with some anchor.",
          "Mid Cap": "Mid-size growing companies — higher growth potential, bigger swings.",
          "Small Cap": "Small companies — highest growth potential in this list, also the sharpest falls.",
          "Multi Cap": "Spread across large, mid and small companies in fixed proportions.",
          "Flexi Cap": "Manager can move across company sizes as opportunities change.",
          "Multi Asset": "Spread across equity, debt and commodities — built to smooth the journey."
        };
        return roles[cat] || "";
      }

      /* ================= Data (Fund Horizon engine) ================= */
      var STYLES = {
        conservative: {
          name: "Conservative", color: "#2F6DB3",
          tagline: "Grows steadily. Falls very little.",
          fits: "you need the money in 1–3 years, or market falls worry you.",
          ret: 8, risk: 1, riskWord: "Low risk",
          alloc: { equity: 15, debt: 65, gold: 5, liquid: 15 },
          funds: [
            { name: "DSP Multi Asset Allocation Fund", category: "Multi Asset", code: "152053", pct: 55, desc: "Spread across equity, debt and commodities — built to smooth the journey.", pick: true },
            { name: "ICICI Prudential Large Cap Fund", category: "Large Cap", code: "108466", pct: 25, desc: "Large, established companies — the steadier equity part of the plan.", pick: false },
            { name: "WhiteOak Capital Multi Asset Allocation Fund", category: "Multi Asset", code: "151746", pct: 20, desc: "A second multi-asset holding to diversify across asset types.", pick: false }
          ]
        },
        moderate: {
          name: "Moderate", color: "#0C6B4F",
          tagline: "Balance of growth & safety.",
          fits: "goals 3–7 years away, and you want growth without big shocks.",
          ret: 10.5, risk: 2, riskWord: "Medium risk",
          alloc: { equity: 50, debt: 33, gold: 10, liquid: 7 },
          funds: [
            { name: "ICICI Prudential Large Cap Fund", category: "Large Cap", code: "108466", pct: 30, desc: "Large, established companies — the steadier equity part of the plan.", pick: true },
            { name: "WhiteOak Capital Flexi Cap Fund", category: "Flexi Cap", code: "150347", pct: 30, desc: "Manager can move across company sizes as opportunities change.", pick: false },
            { name: "ICICI Prudential Large & Mid Cap Fund", category: "Large & Mid Cap", code: "100349", pct: 25, desc: "A mix of large and mid-size companies for growth with some anchor.", pick: false },
            { name: "Nippon India Multi Asset Allocation Fund", category: "Multi Asset", code: "148459", pct: 15, desc: "Spread across equity, debt and commodities — built to smooth the journey.", pick: false }
          ]
        },
        aggressive: {
          name: "Aggressive", color: "#C2500F",
          tagline: "Maximum long-term growth. Big ups & downs.",
          fits: "goals 7+ years away, and you can stay calm when markets fall.",
          ret: 12, risk: 3, riskWord: "High risk",
          alloc: { equity: 85, debt: 7, gold: 6, liquid: 2 },
          funds: [
            { name: "WhiteOak Capital Flexi Cap Fund", category: "Flexi Cap", code: "150347", pct: 35, desc: "Manager can move across company sizes as opportunities change.", pick: true },
            { name: "WhiteOak Capital Mid Cap Fund", category: "Mid Cap", code: "150583", pct: 25, desc: "Mid-size growing companies — higher growth potential, bigger swings.", pick: false },
            { name: "Invesco India Small Cap Fund", category: "Small Cap", code: "145139", pct: 20, desc: "Small companies — highest growth potential in this list, also the sharpest falls.", pick: false },
            { name: "Mirae Asset Multicap Fund", category: "Multi Cap", code: "151812", pct: 20, desc: "Spread across large, mid and small companies in fixed proportions.", pick: false }
          ]
        }
      };
      var STYLE_ORDER = ["conservative", "moderate", "aggressive"];
      var ASSETS = [
        { key: "equity", label: "Equity", color: "#178A50" },
        { key: "debt", label: "Debt", color: "#2F6DB3" },
        { key: "gold", label: "Gold", color: "#DFA00C" },
        { key: "liquid", label: "Liquid", color: "#93A1B0" }
      ];

      var ICONS = {
        shield: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 3v5c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6l7-3z"/><path d="m9 12 2 2 4-4"/></svg>',
        gauge: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15a8 8 0 1 1 16 0"/><line x1="12" y1="15" x2="15.5" y2="9"/><circle cx="12" cy="15" r="1.4" fill="currentColor"/><line x1="2.5" y1="19" x2="21.5" y2="19"/></svg>',
        rocket: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 16.5c-1.5 1.3-2 5-2 5s3.7-.5 5-2c.7-.9.7-2.2-.1-3s-2.1-.8-2.9 0z"/><path d="M12 15l-3-3a22 22 0 0 1 2-4A12.9 12.9 0 0 1 22 2c0 2.7-.8 7.5-6 11a22.4 22.4 0 0 1-4 2z"/><path d="M9 12 4.5 10.5C6 8 7.5 5.5 10 4c.6 2 .9 4.2 1 6.5"/><path d="M12 15l1.5 4.5C16 18 18.5 16.5 21 15c-2-.6-4.2-.9-6.5-1"/></svg>',
        firstaid: '<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>',
        book: '<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V4a2 2 0 0 0-2-2H6.5A2.5 2.5 0 0 0 4 4.5v15z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/></svg>',
        rings: '<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="14" r="6"/><circle cx="16.5" cy="9.5" r="5"/></svg>',
        home: '<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 10 9-7 9 7v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22v-8h6v8"/></svg>',
        car: '<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 16 6.6 9.6A2 2 0 0 1 8.5 8h7a2 2 0 0 1 1.9 1.6L19 16"/><path d="M3 16h18v4h-2.5"/><path d="M3 20v-4"/><circle cx="7.5" cy="20" r="1.8"/><circle cx="16.5" cy="20" r="1.8"/><line x1="9.3" y1="20" x2="14.7" y2="20"/></svg>',
        sun: '<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 18a6 6 0 0 1 12 0"/><line x1="12" y1="6" x2="12" y2="3"/><line x1="5.6" y1="8.6" x2="3.8" y2="6.8"/><line x1="18.4" y1="8.6" x2="20.2" y2="6.8"/><line x1="2" y1="21" x2="22" y2="21"/></svg>',
        chart: '<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 17 9 11 13 15 21 7"/><polyline points="15 7 21 7 21 13"/></svg>',
        plane: '<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>',
        briefcase: '<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/><line x1="2" y1="13" x2="22" y2="13"/></svg>',
        heart: '<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 1 0-7.8 7.8l1 1L12 21.2l7.8-7.8 1-1a5.5 5.5 0 0 0 0-7.8z"/></svg>',
        tag: '<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.6 13.4 12 22 2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8z"/><circle cx="7" cy="7" r="1.4" fill="currentColor"/></svg>',
        sliders: '<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="7" x2="20" y2="7"/><circle cx="9" cy="7" r="2.2" fill="#fff"/><line x1="4" y1="17" x2="20" y2="17"/><circle cx="15" cy="17" r="2.2" fill="#fff"/></svg>'
      };
      var STYLE_ICONS = { conservative: "shield", moderate: "gauge", aggressive: "rocket" };

      var GOALS = [
        { id: "emergency", name: "Emergency Fund", icon: "firstaid", target: 600000, years: 1 },
        { id: "education", name: "Child Education", icon: "book", target: 2500000, years: 10 },
        { id: "marriage", name: "Child Marriage", icon: "rings", target: 3000000, years: 15 },
        { id: "home", name: "Buy a Home", icon: "home", target: 5000000, years: 7, note: "down payment" },
        { id: "car", name: "Buy a Car", icon: "car", target: 1200000, years: 3 },
        { id: "retirement", name: "Retirement", icon: "sun", target: 20000000, years: 25 },
        { id: "wealth", name: "Wealth Creation", icon: "chart", target: 10000000, years: 15 },
        { id: "vacation", name: "Vacation / World Tour", icon: "plane", target: 500000, years: 2 },
        { id: "business", name: "Start a Business", icon: "briefcase", target: 2000000, years: 5 },
        { id: "parents", name: "Parents' Care", icon: "heart", target: 2500000, years: 10 },
        { id: "tax", name: "Tax Saving — ELSS", icon: "tag", target: 150000, years: 1, note: "per year, under 80C" },
        { id: "custom", name: "Custom Goal", icon: "sliders", target: 1000000, years: 5 }
      ];

      /* ================= PMS data — FH list, APMI / manager disclosures ================= */
      var PMS_MIN = 5000000;
      var PMS_HORIZONS = [["m1","1 Month"],["m3","3 Month"],["m6","6 Month"],["y1","1 Year"],["y2","2 Year"],["y3","3 Year CAGR"],["y5","5 Year CAGR"],["si","Since Inception"]];
      var PMS_CHART_H = [["m1","1M"],["m3","3M"],["m6","6M"],["y1","1Y"],["y3","3Y"],["y5","5Y"],["si","SI"]];
      var PMS_STRATEGIES = [
        { id: "abakkus", name: "Abakkus Emerging Opportunities Approach", short: "Abakkus Emerging Opportunities", provider: "Abakkus Asset Manager", apmi: "2512", pick: true,
          category: "Small & Mid Cap", inception: "29 Oct 2020", benchmark: "S&P BSE 500 TRI", aum: null, aumAsOf: null,
          managerNote: "Abakkus Asset Manager, founded by Sunil Singhania; this approach is managed by Aman Chowhan.",
          returnsAsOf: "31 Aug 2026",
          rets: { m1:{s:3.04,b:-0.09}, m3:{s:8.77,b:3.86}, m6:{s:10.82,b:1.43}, y1:{s:8.67,b:4.72}, y2:{s:2.45,b:null}, y3:{s:13.08,b:12.09}, y5:{s:15.51,b:10.91}, si:{s:26.40,b:17.25} },
          fees: [["Fixed fee","Up to 3% p.a."],["Performance fee","Up to 30% of profits"],["Hurdle","0–25% p.a. or benchmark-linked"],["Exit load","Year 1 up to 3% · Year 2 up to 2% · Year 3 up to 1%"],["High water mark","Yes"]],
          feesNote: "Fee ranges are from the Disclosure Document and are agreement-specific.",
          approach: "Benchmark-agnostic multicap portfolio with a mid and small cap bias; disciplined bottom-up stock selection; 3–5 year horizon.",
          risk: null, monthly: null },
        { id: "carnelian", name: "Carnelian Capital Compounder Strategy", short: "Carnelian Compounder", provider: "Carnelian Asset Management", apmi: "1193", pick: false,
          category: "Multi Cap & Flexi Cap", inception: "15 May 2019", benchmark: "BSE 500 TRI (as reported)", aum: "₹2,532.27 Cr", aumAsOf: "Aug 2026, ALTPORT",
          managerNote: "Fund Manager: Kunal Shah, Principal Officer & Fund Manager, Carnelian Asset Management.",
          returnsAsOf: "31 Aug 2026",
          rets: { m1:{s:4.57,b:-0.09}, m3:{s:12.10,b:3.86}, m6:{s:15.76,b:1.43}, y1:{s:22.36,b:4.72}, y2:{s:13.51,b:null}, y3:{s:23.85,b:12.09}, y5:{s:17.54,b:10.91}, si:{s:20.08,b:14.87} },
          fees: [["Fixed fee","2.5% p.a."],["Performance fee","15%"],["Hurdle","8%"],["Exit load","1% if redeemed in the first year, 0% after"]],
          feesNote: "",
          approach: "Long-only multicap capturing the India growth story — bottom-up picking using Carnelian's Magic, Compounder and Opportunistic filters with forensic (CLEAR) checks.",
          risk: null, monthly: null },
        { id: "icici", name: "ICICI Prudential PMS Value Strategy", short: "ICICI PMS Value", provider: "ICICI Prudential PMS", apmi: "781", pick: false,
          category: "Multi Cap & Flexi Cap", inception: "31 Mar 2007", benchmark: "S&P BSE 500 TRI", aum: "₹976.06 Cr", aumAsOf: "30 Nov 2025",
          managerNote: null,
          returnsAsOf: "31 May 2026",
          rets: { m1:{s:-1.46,b:null}, m3:{s:-3.25,b:null}, m6:{s:2.51,b:null}, y1:{s:10.50,b:null}, y2:{s:6.46,b:null}, y3:{s:24.63,b:null}, y5:{s:21.98,b:null}, si:{s:13.04,b:null} },
          fees: [["Fixed fee","2.25% p.a."],["Performance fee","15%"],["Hurdle","10%"],["Exit load","1% in the first year, 0% after"]],
          feesNote: "",
          approach: "Value style — diversified stocks trading at a discount to their fair / intrinsic value.",
          risk: { asOf: "Manager factsheet, 31 Jan 2025",
            stats: [["Std Deviation","18.43%"],["Sharpe","1.07"],["Sortino","1.89"],["Beta","1.21"]],
            mc: [["Large Cap",48.3,"#2F6DB3"],["Mid Cap",17.0,"#DFA00C"],["Small Cap",34.8,"#C2500F"]],
            holdings: [["ICICI Bank",7.39],["Larsen & Toubro",7.36],["Bharti Airtel",6.85],["Sarda Energy & Minerals",5.29],["Jindal Stainless",5.03],["State Bank of India",4.58],["Apollo Tyres",3.83],["Aurobindo Pharma",3.81],["NTPC",3.67],["Jindal Steel & Power",3.51]] },
          monthly: null },
        { id: "buoyant", name: "Buoyant Opportunities PMS", short: "Buoyant Opportunities", provider: "Buoyant Capital", apmi: "606", pick: false,
          category: "Multi Cap & Flexi Cap", inception: "31 May 2016", benchmark: "S&P BSE 500 TRI", aum: "₹12,574.49 Cr", aumAsOf: "30 Sep 2026",
          managerNote: "Portfolio: 42 stocks.",
          returnsAsOf: "30 Sep 2026",
          rets: { m1:{s:null,b:null}, m3:{s:null,b:null}, m6:{s:null,b:null}, y1:{s:5.03,b:null}, y2:{s:4.62,b:null}, y3:{s:13.50,b:null}, y5:{s:15.64,b:null}, si:{s:19.98,b:null} },
          fees: [["Fixed fee","2% p.a."],["Performance fee","17.5%"],["Hurdle","10%"],["Exit load","Not disclosed in source"]],
          feesNote: "",
          approach: "Core & Satellite buy-and-hold base — aggressive in uptrends, defensive when protecting capital, investing across market cycles.",
          risk: { asOf: "As reported, Sep 2026",
            stats: [["Std Deviation","18.36%"],["Beta","0.99"],["Sharpe","-0.05"]],
            mc: null, holdings: null },
          monthly: null },
        { id: "stallion", name: "Stallion Asset Core Fund", short: "Stallion Core Fund", provider: "Stallion Asset", apmi: "174", pick: false,
          category: "Multicap Growth", inception: "22 Oct 2018", benchmark: "S&P BSE 500 TRI", aum: "₹5,568.37 Cr", aumAsOf: "30 Jun 2025",
          managerNote: null,
          returnsAsOf: "30 Sep 2026",
          rets: { m1:{s:1.59,b:-5.57}, m3:{s:7.82,b:-3.59}, m6:{s:39.90,b:8.07}, y1:{s:18.39,b:-2.33}, y2:{s:11.35,b:-3.93}, y3:{s:33.41,b:9.20}, y5:{s:23.79,b:8.91}, si:{s:28.31,b:13.72} },
          fees: [["Fixed fee","Plan A: 2.5% p.a. · Plan B: 1.5% p.a."],["Performance fee","Plan A: none · Plan B: 15% above hurdle"],["Hurdle","10% (Plan B)"],["Exit load","2% before 12 months"]],
          feesNote: "Two fee plans — Plan A and Plan B — as per the manager's disclosure.",
          approach: "Multicap growth — backs the bull-run leader of each 1–3 year cycle; Core + Trend + Special Situations with sector rotation.",
          risk: null,
          monthly: [["Oct 2025",1.82,4.27],["Nov 2025",0.45,0.96],["Dec 2025",-3.14,-0.24],["Jan 2026",-4.34,-3.34],["Feb 2026",-1.87,0.45],["Mar 2026",-9.00,-11.37],["Apr 2026",17.67,10.38],["May 2026",7.56,-0.17],["Jun 2026",2.52,1.73],["Jul 2026",2.12,2.19],["Aug 2026",3.93,-0.09],["Sep 2026",1.59,-5.57]] }
      ];
      function findStrat(id) { for (var i = 0; i < PMS_STRATEGIES.length; i++) { if (PMS_STRATEGIES[i].id === id) return PMS_STRATEGIES[i]; } return null; }
      function fmtRet(v) { if (v === null || v === undefined) return "—"; return (v > 0 ? "+" : "") + v.toFixed(2) + "%"; }
      function retClass(v) { if (v === null || v === undefined || v === 0) return ""; return v > 0 ? "pos" : "neg"; }
      var PMS_DEFAULTS = {
        conservative: { pms: 15, cap: 20 },
        moderate: { pms: 30, cap: 50 },
        aggressive: { pms: 40, cap: 60 }
      };
      var pmsState = { route: "mf", corpus: 10000000, pmsPct: 30, sel: ["abakkus"], splitFirst: 50 };
      var lastPmsStyle = null;
      function selectedStrats() { return pmsState.sel.map(findStrat).filter(function (x) { return !!x; }); }
      function stratShare(id) {
        if (pmsState.sel.length < 2) return pmsState.sel[0] === id ? 100 : 0;
        return pmsState.sel[0] === id ? pmsState.splitFirst : (pmsState.sel[1] === id ? 100 - pmsState.splitFirst : 0);
      }

      /* ================= State ================= */
      var state = { style: null, goal: "education", target: 2500000, years: 10 };
      var quizAnswers = [0, 0, 0];

      /* ================= Helpers ================= */
      function $(id) { return document.getElementById(id); }
      function fmtINR(n) { return "₹" + Math.round(n).toLocaleString("en-IN"); }
      function fmtShort(n) {
        if (n >= 10000000) { var c = n / 10000000; return "₹" + (c % 1 === 0 ? c : c.toFixed(1)) + " Crore"; }
        if (n >= 100000) { var l = n / 100000; return "₹" + (l % 1 === 0 ? l : l.toFixed(1)) + " Lakh"; }
        return fmtINR(n);
      }
      var anims = {};
      function countUp(el, to, formatter) {
        var key = el.id;
        if (anims[key]) cancelAnimationFrame(anims[key]);
        var from = parseFloat(el.getAttribute("data-val") || "0");
        var start = null, dur = 650;
        function frame(ts) {
          if (!start) start = ts;
          var t = Math.min(1, (ts - start) / dur);
          var eased = 1 - Math.pow(1 - t, 3);
          var val = from + (to - from) * eased;
          el.textContent = formatter(val);
          if (t < 1) { anims[key] = requestAnimationFrame(frame); }
          else { el.setAttribute("data-val", String(to)); }
        }
        anims[key] = requestAnimationFrame(frame);
      }

      /* ================= Step 1: style cards ================= */
      function splitBarHTML(alloc) {
        var segs = ASSETS.map(function (a) {
          return '<span class="seg-' + a.key + '" data-w="' + alloc[a.key] + '"></span>';
        }).join("");
        var legend = ASSETS.map(function (a) {
          return '<span><i style="background:' + a.color + '"></i>' + a.label + " " + alloc[a.key] + "%</span>";
        }).join("");
        return '<div class="split-bar">' + segs + '</div><div class="split-legend">' + legend + "</div>";
      }
      function buildStyleCards() {
        var grid = $("styleGrid");
        grid.innerHTML = STYLE_ORDER.map(function (key) {
          var s = STYLES[key];
          var dots = [1, 2, 3].map(function (i) { return '<i class="' + (i <= s.risk ? "on" : "") + '"></i>'; }).join("");
          return '<button type="button" class="style-card" data-style="' + key + '">' +
            '<span class="tick"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span>' +
            '<span class="icon-badge">' + ICONS[STYLE_ICONS[key]] + "</span>" +
            "<h3>" + s.name + "</h3>" +
            '<p class="tagline">' + s.tagline + "</p>" +
            splitBarHTML(s.alloc) +
            '<p class="fits"><strong>Fits if:</strong> ' + s.fits + "</p>" +
            '<span class="card-foot"><span class="return-label">~' + s.ret + '% a year<small>assumed return</small></span>' +
            '<span class="risk-dots">' + dots + "<em>" + s.riskWord + "</em></span></span>" +
            "</button>";
        }).join("");
        // animate bars in
        setTimeout(function () {
          var bars = grid.querySelectorAll(".split-bar span");
          for (var i = 0; i < bars.length; i++) bars[i].style.width = bars[i].getAttribute("data-w") + "%";
        }, 120);
        var cards = grid.querySelectorAll(".style-card");
        for (var j = 0; j < cards.length; j++) {
          cards[j].addEventListener("click", function () { selectStyle(this.getAttribute("data-style"), true); });
        }
      }

      function selectStyle(key, advance) {
        state.style = key;
        var cards = document.querySelectorAll(".style-card");
        for (var i = 0; i < cards.length; i++) {
          cards[i].classList.toggle("selected", cards[i].getAttribute("data-style") === key);
        }
        if (advance) {
          setTimeout(function () { goToStep(2); }, 480);
        }
      }

      /* ================= Quiz ================= */
      $("quizToggle").addEventListener("click", function () {
        var p = $("quizPanel");
        p.classList.toggle("open");
        if (p.classList.contains("open")) p.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
      var quizOpts = document.querySelectorAll(".quiz-opt");
      for (var qi = 0; qi < quizOpts.length; qi++) {
        quizOpts[qi].addEventListener("click", function () {
          var qEl = this.closest(".quiz-q");
          var qIdx = parseInt(qEl.getAttribute("data-q"), 10);
          quizAnswers[qIdx] = parseInt(this.getAttribute("data-score"), 10);
          var siblings = qEl.querySelectorAll(".quiz-opt");
          for (var s = 0; s < siblings.length; s++) siblings[s].classList.toggle("picked", siblings[s] === this);
          if (quizAnswers.indexOf(0) === -1) {
            var total = quizAnswers[0] + quizAnswers[1] + quizAnswers[2];
            var key = total <= 4 ? "conservative" : (total <= 7 ? "moderate" : "aggressive");
            var res = $("quizResult");
            res.textContent = "Your answers point to: " + STYLES[key].name + " — taking you to your plan…";
            res.classList.add("show");
            selectStyle(key, false);
            setTimeout(function () { goToStep(2); }, 1100);
          }
        });
      }

      /* ================= Step navigation ================= */
      function goToStep(n, back) {
        var s1 = $("step1"), s2 = $("step2");
        if (n === 2) {
          renderStep2();
          s1.classList.remove("active"); s1.classList.remove("back");
          s2.classList.add("active"); s2.classList.remove("back");
          $("progressFill").style.width = "100%";
          $("progressLabel").textContent = "Step 2 of 2";
        } else {
          s2.classList.remove("active");
          s1.classList.add("active");
          if (back) s1.classList.add("back"); else s1.classList.remove("back");
          $("progressFill").style.width = "50%";
          $("progressLabel").textContent = "Step 1 of 2";
        }
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
      $("changeStyleBtn").addEventListener("click", function () { goToStep(1, true); });

      /* ================= Step 2: goals ================= */
      function buildGoals() {
        var grid = $("goalGrid");
        grid.innerHTML = GOALS.map(function (g) {
          var meta = fmtShort(g.target) + " · " + g.years + (g.years === 1 ? " yr" : " yrs") + (g.note ? " · " + g.note : "");
          return '<button type="button" class="goal-card" data-goal="' + g.id + '">' +
            '<span class="g-icon">' + ICONS[g.icon] + "</span>" +
            '<span class="g-name">' + g.name + "</span>" +
            '<span class="g-meta">' + meta + "</span></button>";
        }).join("");
        var cards = grid.querySelectorAll(".goal-card");
        for (var i = 0; i < cards.length; i++) {
          cards[i].addEventListener("click", function () {
            var g = GOALS.filter(function (x) { return x.id === this.getAttribute("data-goal"); }, this)[0];
            state.goal = g.id;
            state.target = g.target;
            state.years = g.years;
            syncInputs();
            renderPlan();
          });
        }
      }
      function markGoal() {
        var cards = document.querySelectorAll(".goal-card");
        for (var i = 0; i < cards.length; i++) {
          cards[i].classList.toggle("selected", cards[i].getAttribute("data-goal") === state.goal);
        }
      }

      /* ================= Step 2: style pills ================= */
      function buildPills() {
        $("stylePills").innerHTML = STYLE_ORDER.map(function (key) {
          return '<button type="button" class="pill" data-pill="' + key + '">' + STYLES[key].name + "</button>";
        }).join("");
        var pills = document.querySelectorAll("[data-pill]");
        for (var i = 0; i < pills.length; i++) {
          pills[i].addEventListener("click", function () {
            state.style = this.getAttribute("data-pill");
            var cards = document.querySelectorAll(".style-card");
            for (var j = 0; j < cards.length; j++) {
              cards[j].classList.toggle("selected", cards[j].getAttribute("data-style") === state.style);
            }
            renderPlan();
          });
        }
      }
      function markPills() {
        var pills = document.querySelectorAll("[data-pill]");
        for (var i = 0; i < pills.length; i++) {
          pills[i].classList.toggle("on", pills[i].getAttribute("data-pill") === state.style);
        }
      }

      /* ================= Calculator ================= */
      var LOG_MIN = Math.log10(50000), LOG_MAX = Math.log10(50000000);
      function sliderToAmount(pos) { return Math.pow(10, LOG_MIN + (LOG_MAX - LOG_MIN) * (pos / 200)); }
      function amountToSlider(amt) {
        var p = (Math.log10(Math.max(50000, Math.min(50000000, amt))) - LOG_MIN) / (LOG_MAX - LOG_MIN) * 200;
        return Math.round(p);
      }
      function roundNice(n) {
        if (n >= 100000) return Math.round(n / 5000) * 5000;
        if (n >= 10000) return Math.round(n / 500) * 500;
        return Math.round(n / 100) * 100;
      }
      function syncInputs() {
        $("targetRange").value = amountToSlider(state.target);
        $("targetInput").value = Math.round(state.target).toLocaleString("en-IN");
        $("yearsRange").value = state.years;
        $("yearsInput").value = state.years;
      }
      $("targetRange").addEventListener("input", function () {
        state.target = roundNice(sliderToAmount(parseFloat(this.value)));
        $("targetInput").value = Math.round(state.target).toLocaleString("en-IN");
        renderPlan(false);
      });
      $("yearsRange").addEventListener("input", function () {
        state.years = parseInt(this.value, 10);
        $("yearsInput").value = state.years;
        renderPlan(false);
      });
      $("targetInput").addEventListener("change", function () {
        var v = parseFloat(this.value.replace(/[^0-9.]/g, ""));
        if (!isNaN(v) && v > 0) {
          state.target = Math.max(1000, Math.min(100000000, v));
          $("targetRange").value = amountToSlider(state.target);
          this.value = Math.round(state.target).toLocaleString("en-IN");
          renderPlan(false);
        }
      });
      $("yearsInput").addEventListener("change", function () {
        var v = parseInt(this.value.replace(/[^0-9]/g, ""), 10);
        if (!isNaN(v)) {
          state.years = Math.max(1, Math.min(40, v));
          $("yearsRange").value = Math.min(30, state.years);
          this.value = state.years;
          renderPlan(false);
        }
      });

      function calcPlan() {
        var s = STYLES[state.style];
        var annual = s.ret / 100;
        var r = annual / 12, n = state.years * 12;
        var sip = state.target * r / ((Math.pow(1 + r, n) - 1) * (1 + r));
        var invested = sip * n;
        var growth = state.target - invested;
        var lumpsum = state.target / Math.pow(1 + annual, state.years);
        return { sip: sip, invested: invested, growth: growth, lumpsum: lumpsum };
      }

      /* ================= Donut ================= */
      var CIRC = 2 * Math.PI * 84;
      function renderDonut() {
        var s = STYLES[state.style];
        var segs = { equity: $("segEquity"), debt: $("segDebt"), gold: $("segGold"), liquid: $("segLiquid") };
        var offset = 0;
        ASSETS.forEach(function (a) {
          var frac = s.alloc[a.key] / 100;
          var len = Math.max(0, frac * CIRC - (frac > 0 ? 2.5 : 0));
          var el = segs[a.key];
          el.style.strokeDasharray = len + " " + (CIRC - len);
          el.style.strokeDashoffset = -offset;
          offset += frac * CIRC;
        });
        $("donutBig").textContent = s.alloc.equity + "%";
        $("allocLegend").innerHTML = ASSETS.map(function (a) {
          return '<li><i style="background:' + a.color + '"></i><span class="nm">' + a.label + '</span><span class="pc">' + s.alloc[a.key] + "%</span></li>";
        }).join("");
      }

      /* ================= Funds — FH Recommended List ================= */
      var protectState = { emergency: null, term: null, health: null };
      var lastPlanCache = null;
      function escHtml(s){ return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
      function renderFunds(sip) {
        var s = STYLES[state.style];
        var html = s.funds.map(function (f, idx) {
          var amt = sip * f.pct / 100;
          var peers = (FH_BY_CATEGORY[f.category] || []).filter(function(x){ return x.code !== f.code; });
          var peersHtml = peers.length ? '<div class="see-all" id="seeall-'+idx+'"><h4>All funds in '+escHtml(f.category)+' — FH Recommended List</h4><ul>'+peers.map(function(p){ return '<li><span>'+escHtml(p.name)+'</span><span>AMFI '+escHtml(p.code)+'</span></li>'; }).join("")+'<li><span>'+escHtml(f.name)+' (in this plan)</span><span>AMFI '+escHtml(f.code)+'</span></li></ul></div>' : '';
          var seeBtn = peers.length ? '<button type="button" class="link-btn secondary" data-seeall="'+idx+'">See all funds in this category</button>' : '';
          return '<div class="fund-row"><div class="fund-main">' +
            '<div class="fund-name">' + escHtml(f.name) + (f.pick ? '<span class="pick-tag">Marked pick</span>' : "") + "</div>" +
            '<div class="fund-meta"><b>'+escHtml(f.category)+'</b> · AMFI Scheme Code: '+escHtml(f.code)+' · Regular Plan · Growth</div>' +
            '<div class="fund-desc">' + escHtml(f.desc) + "</div>" +
            '<div class="fund-bar"><span style="width:' + f.pct + '%"></span></div>' +
            '<div class="fund-actions"><button type="button" class="link-btn" data-explain-fund="'+idx+'">Explain this fund</button>'+seeBtn+'</div>' +
            peersHtml +
            '</div>' +
            '<div class="fund-amt"><span class="pc">' + f.pct + '%</span><span class="rs">' + fmtINR(amt) + "/mo</span></div></div>";
        }).join("");
        $("fundList").innerHTML = html;
        // wire explain + see-all
        var expBtns = $("fundList").querySelectorAll("[data-explain-fund]");
        for (var i=0;i<expBtns.length;i++){ expBtns[i].addEventListener("click", function(){ var idx=parseInt(this.getAttribute("data-explain-fund"),10); openFundExplain(idx); }); }
        var seeBtns = $("fundList").querySelectorAll("[data-seeall]");
        for (var j=0;j<seeBtns.length;j++){ seeBtns[j].addEventListener("click", function(){ var id="seeall-"+this.getAttribute("data-seeall"); var el=document.getElementById(id); if(el){ var open=el.classList.toggle("open"); this.textContent = open ? "Hide funds in this category" : "See all funds in this category"; } }); }
      }

      /* ================= AI Explainer (client-side, Rule-Based Summary) ================= */
      function currentPlanData(){
        var s = STYLES[state.style]; var goal = GOALS.filter(function(g){return g.id===state.goal;})[0]; var plan = calcPlan();
        return { style:s, styleKey:state.style, goal:goal, plan:plan, target:state.target, years:state.years };
      }
      function planExplainHTML(){
        var d = currentPlanData(); var s=d.style, plan=d.plan, goal=d.goal;
        var allocLine = ASSETS.map(function(a){ return a.label+" "+s.alloc[a.key]+"%"; }).join(", ");
        var fundLines = s.funds.map(function(f){ var amt=plan.sip*f.pct/100; return "<li><strong>"+escHtml(f.name)+"</strong> ("+escHtml(f.category)+", AMFI "+escHtml(f.code)+") — "+f.pct+"% · <strong>"+fmtINR(amt)+"/month</strong>. "+escHtml(f.desc)+"</li>"; }).join("");
        var why = "";
        if(state.style==="conservative"){ why = "You picked <strong>Conservative</strong> for <strong>"+escHtml(goal?goal.name:"your goal")+"</strong> — target "+fmtINR(d.target)+" in "+d.years+(d.years===1?" year":" years")+". This style keeps equity low at "+s.alloc.equity+"% and leans on multi-asset and large-cap holdings, so the ride is calmer. At an assumed "+s.ret+"% a year, the maths points to a monthly SIP of <strong>"+fmtINR(plan.sip)+"</strong>."; }
        else if(state.style==="aggressive"){ why = "You picked <strong>Aggressive</strong> for <strong>"+escHtml(goal?goal.name:"your goal")+"</strong> — target "+fmtINR(d.target)+" in "+d.years+" years. This style puts "+s.alloc.equity+"% in equity for long-term growth, with flexi, mid, small and multi-cap funds doing the heavy lifting. At an assumed "+s.ret+"% a year, the monthly SIP works out to <strong>"+fmtINR(plan.sip)+"</strong>. The longer horizon gives markets more time to recover from falls."; }
        else { why = "You picked <strong>Moderate</strong> for <strong>"+escHtml(goal?goal.name:"your goal")+"</strong> — target "+fmtINR(d.target)+" in "+d.years+" years. This style balances growth and steadiness with "+s.alloc.equity+"% in equity ("+allocLine+"). At an assumed "+s.ret+"% a year, the monthly SIP works out to <strong>"+fmtINR(plan.sip)+"</strong> — you invest "+fmtINR(plan.invested)+" in total, with "+fmtINR(plan.growth)+" shown as growth in this illustration."; }
        var riskText = state.style==="aggressive" ? "Values will swing — sometimes sharply. Mid and small-cap parts can fall more than the wider market. If you need this money sooner than planned, or a fall would make you stop the SIP, this mix will feel uncomfortable. Returns are not assured and the assumed "+s.ret+"% may not happen." : (state.style==="conservative" ? "Even a calmer mix can dip for short periods, and multi-asset funds still hold equity. Inflation can also eat into low-risk returns over time. The assumed "+s.ret+"% is an illustration, not a promise — check the plan yearly and keep emergency money separate." : "Markets will fall at times and this mix will fall with them, though the multi-asset and large-cap parts are there to soften it. Returns are not assured and the assumed "+s.ret+"% may not happen. Stopping the SIP during a fall is the most common way this type of plan misses its target.");
        var pmsPara = "";
        if (pmsState.route === "mix" && isPmsEligible()) {
          var mx = currentMix(); var selList = selectedStrats();
          if (mx.valid) {
            var selParts = selList.map(function (st) { var sh = stratShare(st.id); return "<strong>"+escHtml(st.name)+"</strong> (APMI "+escHtml(st.apmi)+(st.pick?", Marked pick":"")+", "+fmtINR(mx.pmsAmt*sh/100)+")"; }).join(" and ");
            pmsPara = "<h4>Your PMS mix</h4><p>Alongside the SIP above, your lump-sum corpus of <strong>"+fmtINR(mx.corpus)+"</strong> is split as Mutual Funds (lump sum) <strong>"+fmtINR(mx.mfAmt)+"</strong> ("+mx.mfPct+"%) and PMS <strong>"+fmtINR(mx.pmsAmt)+"</strong> ("+mx.pmsPct+"%). The PMS portion goes to "+selParts+", subject to a suitability discussion. Each portfolio manager needs a minimum of ₹50 Lakh (SEBI rule) and PMS returns are not assured — historical returns for each strategy are in its details on screen.</p>";
          } else {
            pmsPara = "<h4>Your PMS mix — not valid yet</h4><p>Your PMS portion is currently "+fmtINR(mx.pmsAmt)+", below the ₹50 Lakh SEBI minimum per portfolio manager, so this mix is not valid yet. Increase the PMS share to at least "+mx.minPct+"% or increase your corpus. PMS returns are not assured.</p>";
          }
        } else if (pmsState.route === "pms") {
          pmsPara = "<h4>PMS enquiry</h4><p>You chose to ask about PMS only. That route still needs the ₹50 Lakh per-manager minimum and a suitability discussion, so Mutual Funds remain the working route in this plan until Fund Horizon confirms the final structure with you. PMS returns are not assured.</p>";
        } else if (!isPmsEligible()) {
          pmsPara = "<h4>Why Mutual Funds are the route here</h4><p>PMS needs at least ₹50 Lakh as a lump sum with one portfolio manager (SEBI rule). Your lump sum is "+fmtINR(pmsState.corpus)+", so Mutual Funds remain the route — the SIP plan above already works for this goal. PMS returns are not assured.</p>";
        }
        var html = "<h4>Why this style fits this goal</h4><p>"+why+"</p>"+pmsPara+
          "<p style='background:#F7FAF7;border:1px solid #DEE7E0;border-radius:10px;padding:10px 12px'><strong>Your numbers:</strong> Target "+fmtINR(d.target)+" · "+d.years+" years · Monthly SIP <strong>"+fmtINR(plan.sip)+"</strong> · You invest "+fmtINR(plan.invested)+" · Growth (illustration) "+fmtINR(plan.growth)+" · Or lumpsum today "+fmtINR(plan.lumpsum)+" · Split: "+allocLine+".</p>"+
          "<h4>Where your money goes</h4><ul>"+fundLines+"</ul><p>All funds above are from the FH Recommended List — Regular Plan, Growth. One fund in this style carries the Marked pick tag on screen.</p>"+
          "<h4>What could go wrong</h4><p>"+riskText+"</p>"+
          "<h4>Your next steps</h4><p>1) Check the 3 protection checks below — emergency money, term cover and health cover — before you start. 2) Download the PDF report on this page for a clean copy of these exact numbers. 3) Talk to Fund Horizon to complete KYC and start the SIP in the Regular Plan, Growth option. Review the goal once a year, or sooner if the date or amount changes.</p>";
        return html;
      }
      function planExplainPlainText(){
        var tmp=document.createElement("div"); tmp.innerHTML=planExplainHTML(); return tmp.textContent.trim();
      }
      function fundExplainHTML(idx){
        var d=currentPlanData(); var f=d.style.funds[idx]; if(!f) return ""; var amt=d.plan.sip*f.pct/100;
        return "<h4>"+escHtml(f.name)+"</h4><p><strong>"+escHtml(f.category)+"</strong> · AMFI "+escHtml(f.code)+" · Regular Plan, Growth · "+f.pct+"% of your SIP · <strong>"+fmtINR(amt)+"/month</strong> in this plan (total SIP "+fmtINR(d.plan.sip)+"/month for "+escHtml(d.goal?d.goal.name:"your goal")+", "+escHtml(d.style.name)+" style).</p><p>"+escHtml(catRole(f.category))+" In this "+escHtml(d.style.name)+" plan it takes "+f.pct+"% of the monthly amount, so when you change the target or years above, this fund's ₹/month moves in the same proportion. It is one of the funds in the FH Recommended List for its category.</p><p style='color:#5C6B63;font-size:13.5px'>This is about the fund's role in the plan, not a view on future returns. No return, rating or NAV is shown here — live figures are on the full site from AMFI feeds.</p>";
      }
      var aiRevealTimer=null;
      function showAILoadingThen(html, subText){
        var modal=$("aiModal"); modal.classList.add("open"); document.body.style.overflow="hidden";
        if(subText) $("aiModalSub").textContent=subText;
        $("aiLoading").style.display="block"; $("aiContent").style.display="none"; $("aiFoot").style.display="none";
        if(aiRevealTimer) clearTimeout(aiRevealTimer);
        aiRevealTimer=setTimeout(function(){
          $("aiLoading").style.display="none";
          var c=$("aiContent"); c.innerHTML=html; c.style.display="block"; $("aiFoot").style.display="block";
          // progressive reveal: fade sections in
          var kids=c.querySelectorAll("h4,p,ul"); for(var k=0;k<kids.length;k++){ kids[k].style.opacity="0"; kids[k].style.transform="translateY(4px)"; kids[k].style.transition="opacity .35s ease, transform .35s ease"; (function(el,delay){ setTimeout(function(){ el.style.opacity="1"; el.style.transform="none"; }, delay); })(kids[k], 90*k); }
        }, 750);
      }
      function openPlanExplain(){ lastPlanCache = JSON.stringify({style:state.style,goal:state.goal,target:state.target,years:state.years}); showAILoadingThen(planExplainHTML(), "Built from your live plan numbers on this screen. On the full site this uses the AI explainer with this same summary as fallback."); }
      function openFundExplain(idx){ var f=STYLES[state.style].funds[idx]; showAILoadingThen(fundExplainHTML(idx), f ? ("About "+f.name+" in this plan — amounts match the SIP on screen.") : ""); }
      function closeAIModal(){ $("aiModal").classList.remove("open"); document.body.style.overflow=""; if(aiRevealTimer) clearTimeout(aiRevealTimer); }
      $("aiModalClose").addEventListener("click", closeAIModal);
      $("aiModal").addEventListener("click", function(e){ if(e.target===this) closeAIModal(); });
      function onKeydown(e){ if(e.key==="Escape"){ closeAIModal(); closePmsDrawer(); } }
      document.addEventListener("keydown", onKeydown);
      $("explainPlanBtn").addEventListener("click", openPlanExplain);

      /* ================= PMS Strategy Detail Drawer ================= */
      function miniRetsHTML(st) {
        var keys = [["y1","1Y"],["y3","3Y"],["y5","5Y"],["si","Since Inc."]];
        return '<div class="mini-rets">' + keys.map(function (k) {
          var v = st.rets[k[0]].s;
          return '<span class="mini-ret">' + k[1] + '<b class="' + retClass(v) + '">' + fmtRet(v) + "</b></span>";
        }).join("") + "</div>";
      }
      function groupedBarChart(pairs, labels, colorS, colorB, height) {
        // pairs: [{s, b|null}], labels: [..]
        var hasB = pairs.some(function (p) { return p.b !== null && p.b !== undefined; });
        var max = 0;
        pairs.forEach(function (p) { max = Math.max(max, Math.abs(p.s || 0), hasB ? Math.abs(p.b || 0) : 0); });
        if (!max) max = 1;
        var W = 660, H = height || 210, top = 20, bot = 24, plotH = H - top - bot;
        var zeroY = top + plotH / 2, unit = (plotH / 2) / max;
        var gw = W / pairs.length;
        var bars = "", texts = "";
        pairs.forEach(function (p, i) {
          var cx = gw * i + gw / 2;
          var items = hasB ? [{ v: p.s, c: colorS, dx: -21 }, { v: p.b, c: colorB, dx: 3 }] : [{ v: p.s, c: colorS, dx: -11 }];
          items.forEach(function (it, j) {
            if (it.v === null || it.v === undefined) return;
            var h = Math.max(2, Math.abs(it.v) * unit);
            var y = it.v >= 0 ? zeroY - h : zeroY;
            var delay = (i * 70 + j * 40);
            bars += '<rect class="cb" x="' + (cx + it.dx) + '" y="' + y.toFixed(1) + '" width="18" height="' + h.toFixed(1) + '" rx="3" fill="' + it.c + '" style="transform:scaleY(0);transform-box:fill-box;transform-origin:' + (it.v >= 0 ? "bottom" : "top") + ';transition-delay:' + delay + 'ms"><title>' + fmtRet(it.v) + "</title></rect>";
            var ty = it.v >= 0 ? y - 5 : y + h + 13;
            texts += '<text x="' + (cx + it.dx + 9) + '" y="' + ty.toFixed(1) + '" text-anchor="middle" font-size="10.5" font-weight="700" fill="#5C6B63">' + (it.v > 0 ? "+" : "") + it.v.toFixed(1) + "</text>";
          });
          texts += '<text x="' + cx + '" y="' + (H - 6) + '" text-anchor="middle" font-size="11.5" font-weight="700" fill="#5C6B63">' + labels[i] + "</text>";
        });
        var zeroLine = '<line x1="0" y1="' + zeroY + '" x2="' + W + '" y2="' + zeroY + '" stroke="#C9D6CC" stroke-width="1.5"/>';
        return { svg: '<svg viewBox="0 0 ' + W + " " + H + '" width="100%" role="img" aria-label="Returns chart">' + zeroLine + bars + texts + "</svg>", hasB: hasB };
      }
      function pmsDrawerHTML(st) {
        var stripKeys = [["m1","1 Month"],["m3","3 Month"],["m6","6 Month"],["y1","1 Year"],["y3","3 Year CAGR"],["y5","5 Year CAGR"],["si","Since Inception"]];
        var strip = '<div class="ret-strip">' + stripKeys.map(function (k) {
          var r = st.rets[k[0]];
          return '<div class="ret-box"><div class="k">' + k[1] + '</div><div class="v ' + retClass(r.s) + '">' + fmtRet(r.s) + "</div>" + (r.b !== null && r.b !== undefined ? '<div class="b">Bench ' + fmtRet(r.b) + "</div>" : "") + "</div>";
        }).join("") + "</div>";
        var pairs = PMS_CHART_H.map(function (h) { return { s: st.rets[h[0]].s, b: st.rets[h[0]].b }; });
        var labels = PMS_CHART_H.map(function (h) { return h[1]; });
        var chart = groupedBarChart(pairs, labels, "#0C6B4F", "#93A1B0", 215);
        var chartHTML = '<div class="chart-wrap"><div class="chart-legend"><span><i style="background:#0C6B4F"></i>Strategy</span>' +
          (chart.hasB ? '<span><i style="background:#93A1B0"></i>Benchmark — ' + escHtml(st.benchmark) + "</span>" : "") + "</div>" + chart.svg +
          (chart.hasB ? "" : '<p class="fine-note" style="margin-top:4px">Benchmark returns not reported in the source data.</p>') + "</div>";
        var dgrid = '<div class="dgrid">' +
          '<div class="dbox"><div class="k">Benchmark</div><div class="v">' + escHtml(st.benchmark) + "</div></div>" +
          '<div class="dbox"><div class="k">Inception date</div><div class="v">' + escHtml(st.inception) + "</div></div>" +
          '<div class="dbox"><div class="k">AUM</div><div class="v">' + (st.aum ? escHtml(st.aum) + (st.aumAsOf ? '<br><span style="font-size:11.5px;color:var(--faint);font-weight:600">As on ' + escHtml(st.aumAsOf) + "</span>" : "") : "Not disclosed") + "</div></div>" +
          '<div class="dbox"><div class="k">Minimum investment</div><div class="v">₹50,00,000</div></div>' +
          '<div class="dbox"><div class="k">APMI Strategy ID</div><div class="v">' + escHtml(st.apmi) + "</div></div>" +
          '<div class="dbox"><div class="k">Category</div><div class="v">' + escHtml(st.category) + "</div></div>" +
          "</div>" + (st.managerNote ? '<p style="font-size:13.5px;color:var(--muted);margin:10px 0 0;line-height:1.55">' + escHtml(st.managerNote) + "</p>" : "");
        var fees = '<table class="fee-table">' + st.fees.map(function (f) { return "<tr><th>" + escHtml(f[0]) + "</th><td>" + escHtml(f[1]) + "</td></tr>"; }).join("") + "</table>" +
          (st.feesNote ? '<p class="fine-note">' + escHtml(st.feesNote) + "</p>" : "") +
          '<p class="fine-note">Exact fees are as per your agreement with the portfolio manager.</p>';
        var riskHTML = "";
        if (st.risk) {
          var stats = '<div class="dgrid">' + st.risk.stats.map(function (s2) { return '<div class="dbox"><div class="k">' + escHtml(s2[0]) + '</div><div class="v">' + escHtml(s2[1]) + "</div></div>"; }).join("") + "</div>";
          var mc = "";
          if (st.risk.mc) {
            mc = '<div class="mc-bar">' + st.risk.mc.map(function (m) { return '<span style="width:' + m[1] + '%;background:' + m[2] + '"></span>'; }).join("") + "</div>" +
              '<div class="chart-legend">' + st.risk.mc.map(function (m) { return '<span><i style="background:' + m[2] + '"></i>' + escHtml(m[0]) + " " + m[1] + "%</span>"; }).join("") + "</div>";
          }
          var holds = "";
          if (st.risk.holdings) {
            holds = '<h4 style="margin:14px 0 6px">Top holdings</h4><table class="hold-table">' + st.risk.holdings.map(function (h) { return "<tr><td>" + escHtml(h[0]) + "</td><td>" + h[1].toFixed(2) + "%</td></tr>"; }).join("") + "</table>";
          }
          riskHTML = '<div class="drawer-sec"><h4>Risk &amp; portfolio <span style="font-weight:600;color:var(--faint);font-size:12px">(' + escHtml(st.risk.asOf) + ")</span></h4>" + stats + mc + holds + "</div>";
        }
        var monthlyHTML = "";
        if (st.monthly) {
          var mpairs = st.monthly.map(function (m) { return { s: m[1], b: m[2] }; });
          var mlabels = st.monthly.map(function (m) { return m[0].split(" ")[0].slice(0, 3); });
          var mchart = groupedBarChart(mpairs, mlabels, "#0C6B4F", "#93A1B0", 185);
          var mrows = st.monthly.map(function (m) { return "<tr><td>" + escHtml(m[0]) + '</td><td class="' + retClass(m[1]) + '" style="font-weight:700">' + fmtRet(m[1]) + '</td><td class="' + retClass(m[2]) + '">' + fmtRet(m[2]) + "</td></tr>"; }).join("");
          monthlyHTML = '<div class="drawer-sec"><h4>Monthly history — strategy vs benchmark</h4><div class="chart-wrap"><div class="chart-legend"><span><i style="background:#0C6B4F"></i>Strategy</span><span><i style="background:#93A1B0"></i>Benchmark — ' + escHtml(st.benchmark) + "</span></div>" + mchart.svg + "</div>" +
            '<details class="monthly-det"><summary>Monthly data table</summary><table class="fee-table" style="margin-top:8px"><tr><th>Month</th><th>Strategy</th><th>Benchmark</th></tr>' + mrows + "</table></details></div>";
        }
        var isSel = pmsState.sel.indexOf(st.id) !== -1;
        return '<div class="modal-head"><div style="flex:1;min-width:0"><h3 id="pmsModalTitle">' + escHtml(st.name) + "</h3>" +
          '<p class="modal-sub" style="margin:4px 0 0">' + escHtml(st.provider) + " · APMI Strategy ID: " + escHtml(st.apmi) + "</p></div>" +
          (st.pick ? '<span class="pick-tag" style="align-self:flex-start">Marked pick</span>' : "") +
          '<button class="modal-close" id="pmsModalClose" type="button" aria-label="Close strategy details">×</button></div>' +
          '<div style="display:flex;flex-wrap:wrap;gap:7px;margin-bottom:16px"><span class="mini-ret" style="font-size:12px">PMS Strategy</span><span class="mini-ret" style="font-size:12px">' + escHtml(st.category) + '</span><span class="mini-ret" style="font-size:12px">Returns as of ' + escHtml(st.returnsAsOf) + "</span></div>" +
          '<div class="drawer-sec"><h4>Historical returns</h4>' + strip + chartHTML + "</div>" +
          '<div class="drawer-sec"><h4>Strategy details</h4>' + dgrid + '<p style="font-size:14px;line-height:1.6;margin:12px 0 0"><strong>Investment approach:</strong> ' + escHtml(st.approach) + "</p></div>" +
          '<div class="drawer-sec"><h4>Fees &amp; charges</h4>' + fees + "</div>" +
          riskHTML + monthlyHTML +
          '<div class="drawer-foot">Source: APMI / manager disclosure, as on ' + escHtml(st.returnsAsOf) + ". Returns are TWRR, net of fees. Returns up to 1 year are absolute; above 1 year are CAGR. Past performance does not indicate future returns." +
          '<div class="drawer-actions">' + (isSel ? '<span style="font-weight:800;color:var(--primary-dark);font-size:14px;align-self:center">Selected for your PMS portion</span>' : '<button class="btn primary" type="button" id="pmsDrawerSelect">Use this strategy for my PMS portion</button>') +
          '<button class="btn" type="button" id="pmsDrawerClose2">Close</button></div></div>';
      }
      function openPmsDrawer(id) {
        var st = findStrat(id); if (!st) return;
        $("pmsDrawerContent").innerHTML = pmsDrawerHTML(st);
        $("pmsModal").classList.add("open");
        document.body.style.overflow = "hidden";
        $("pmsModalClose").addEventListener("click", closePmsDrawer);
        var c2 = $("pmsDrawerClose2"); if (c2) c2.addEventListener("click", closePmsDrawer);
        var sel = $("pmsDrawerSelect");
        if (sel) sel.addEventListener("click", function () { selectStrat(id); closePmsDrawer(); });
        requestAnimationFrame(function () {
          setTimeout(function () {
            var rects = $("pmsDrawerContent").querySelectorAll(".cb");
            for (var i = 0; i < rects.length; i++) rects[i].style.transform = "scaleY(1)";
          }, 60);
        });
      }
      function closePmsDrawer() { $("pmsModal").classList.remove("open"); if (!$("aiModal").classList.contains("open")) document.body.style.overflow = ""; }
      $("pmsModal").addEventListener("click", function (e) { if (e.target === this) closePmsDrawer(); });

      /* ================= PDF Report (browser print-to-PDF) ================= */
      function protectLabel(key){ if(protectState[key]==="yes") return "Yes"; if(protectState[key]==="no") return "Not yet"; return "Not answered"; }
      function pmsSectionHtml(){
        if (pmsState.route === "pms") {
          return "<h3 style='margin:14px 0 4px'>PMS — Enquiry</h3><p class='pr-note'>Route: PMS only — enquiry. Lump-sum corpus stated: "+fmtINR(pmsState.corpus)+". The ₹50 Lakh per-manager minimum and eligibility check apply, and the final structure is decided only after a suitability discussion. No PMS amounts are calculated for an enquiry.</p>";
        }
        if (!(pmsState.route === "mix" && isPmsEligible())) {
          return "<h3 style='margin:14px 0 4px'>PMS</h3><p class='pr-note'>Route: Mutual Funds only."+(isPmsEligible() ? "" : " PMS needs a ₹50 Lakh lump sum (SEBI rule); stated corpus "+fmtINR(pmsState.corpus)+", so Mutual Funds are the route in this plan.")+"</p>";
        }
        var mx = currentMix(); var selList = selectedStrats();
        var rows = selList.map(function (st) { var sh = stratShare(st.id); return "<tr><td><strong>"+escHtml(st.name)+"</strong>"+(st.pick?" — Marked pick":"")+"</td><td>"+escHtml(st.apmi)+"</td><td class='r'>"+sh+"%</td><td class='r'>"+fmtINR(mx.pmsAmt*sh/100)+"</td></tr>"; }).join("");
        var retTables = selList.map(function (st) {
          var trs = PMS_HORIZONS.map(function (h) { var r = st.rets[h[0]]; return "<tr><td>"+h[1]+"</td><td class='r'>"+fmtRet(r.s)+"</td><td class='r'>"+fmtRet(r.b)+"</td></tr>"; }).join("");
          return "<h4 style='margin:12px 0 2px'>Historical returns — "+escHtml(st.name)+" (APMI "+escHtml(st.apmi)+")</h4><table class='pr-table'><tr><th>Horizon</th><th class='r'>Strategy</th><th class='r'>Benchmark ("+escHtml(st.benchmark)+")</th></tr>"+trs+"</table><p class='pr-note'>Source: APMI / manager disclosure, as on "+escHtml(st.returnsAsOf)+". Returns are TWRR, net of fees. Returns up to 1 year are absolute; above 1 year are CAGR. Past performance does not indicate future returns.</p>";
        }).join("");
        return "<h3 style='margin:14px 0 4px'>PMS Mix</h3><p class='pr-note'>Route: Mutual Funds + PMS mix · Corpus "+fmtINR(mx.corpus)+" · Mutual Funds (lump sum) "+fmtINR(mx.mfAmt)+" ("+mx.mfPct+"%) · PMS "+fmtINR(mx.pmsAmt)+" ("+mx.pmsPct+"%)"+(mx.valid ? "" : " · Note: PMS portion is below the ₹50 Lakh SEBI minimum — mix not valid yet.")+" No returns are projected for the PMS portion; historical returns are shown below for information.</p><table class='pr-table'><tr><th>PMS strategy (FH list)</th><th>APMI ID</th><th class='r'>% of PMS</th><th class='r'>₹</th></tr>"+rows+"</table>"+retTables+"<p class='pr-note'>Final strategy selection happens after a suitability discussion and the portfolio manager's risk profiling.</p>";
      }
      function buildPrintReport(){
        var d=currentPlanData(); var s=d.style, plan=d.plan, goal=d.goal;
        var cd = contactData(); var investorName = cd.name ? escHtml(cd.name) : "Investor Plan";
        var preparedLine = cd.name ? ("Prepared for: <strong style='color:#152420'>"+escHtml(cd.name)+"</strong>"+(cd.email?" · "+escHtml(cd.email):"")+(cd.phone?" · +91 "+escHtml(cd.phone):"")+"<br>") : "";
        var dateStr=new Date().toLocaleDateString("en-IN",{day:"numeric",month:"long",year:"numeric"});
        var allocRows=ASSETS.map(function(a){ return "<tr><td>"+a.label+"</td><td class='r'>"+s.alloc[a.key]+"%</td></tr>"; }).join("");
        var fundRows=s.funds.map(function(f){ var amt=plan.sip*f.pct/100; return "<tr><td><strong>"+escHtml(f.name)+"</strong>"+(f.pick?" — Marked pick":"")+"</td><td>"+escHtml(f.category)+"</td><td>"+escHtml(f.code)+"</td><td class='r'>"+f.pct+"%</td><td class='r'>"+fmtINR(amt)+"</td></tr>"; }).join("");
        var aiText=planExplainHTML();
        var html="<div class='pr-head'><div><div class='pr-brand'>Fund <span>Horizon</span></div><div style='font-size:11.5px;color:#5C6B63'>Simple Goal Plan · Funds from the FH Recommended List</div></div><div class='pr-meta'>Report date: "+dateStr+"<br>Regular Plan · Growth<br>AMFI Registered Distributor · ARN 345439</div></div>"+
          "<h2 class='pr-title'>Plan for "+investorName+"</h2><p style='margin:0 0 2px;color:#5C6B63'>"+preparedLine+"</p><p style='margin:0;color:#5C6B63'>Style: <strong style='color:#152420'>"+escHtml(s.name)+"</strong> · Goal: <strong style='color:#152420'>"+escHtml(goal?goal.name:"—")+"</strong> · Target "+fmtINR(d.target)+" in "+d.years+(d.years===1?" year":" years")+" · Assumed return "+s.ret+"% a year (illustration only)</p>"+
          "<div class='pr-grid'><div class='pr-box'><h3>Your numbers</h3><p style='margin:0'>Monthly SIP: <strong>"+fmtINR(plan.sip)+"</strong><br>You invest: "+fmtINR(plan.invested)+"<br>Growth (illustration): "+fmtINR(plan.growth)+"<br>Lumpsum today (alternative): "+fmtINR(plan.lumpsum)+"</p></div><div class='pr-box'><h3>Protection checks</h3><p style='margin:0'>Emergency money: <strong>"+protectLabel("emergency")+"</strong><br>Term cover: <strong>"+protectLabel("term")+"</strong><br>Health cover: <strong>"+protectLabel("health")+"</strong></p></div></div>"+
          "<h3 style='margin:14px 0 4px'>Allocation — "+escHtml(s.name)+"</h3><table class='pr-table'><tr><th>Asset</th><th class='r'>Share</th></tr>"+allocRows+"</table>"+
          "<h3 style='margin:14px 0 4px'>Funds from the FH Recommended List</h3><table class='pr-table'><tr><th>Fund</th><th>Category</th><th>AMFI Code</th><th class='r'>% of SIP</th><th class='r'>₹ / month</th></tr>"+fundRows+"</table><p class='pr-note'>Fund list: Fund Horizon's curated FH Recommended List (Regular Plan, Growth). Live NAV/returns are shown on the full site from AMFI feeds. Amounts above are the live SIP split from the on-screen calculator.</p>"+
          "<div class='pr-ai'><h3>Educational Explanation — Rule-Based Summary</h3><div>"+aiText+"</div></div>"+
          pmsSectionHtml() +
          "<div class='pr-footer'><strong>Important disclosures</strong><br><strong>Mutual Funds:</strong> Mutual fund investments are subject to market risks, read all scheme related documents carefully. Past performance does not indicate future returns. Fund Horizon is an AMFI Registered Mutual Fund Distributor · ARN 345439. The funds shown are from Fund Horizon's curated list for education and planning; this page does not constitute an investment offer or recommendation.<br><strong>PMS:</strong> Portfolio Management Services (PMS) are offered by SEBI-registered Portfolio Managers under the SEBI (Portfolio Managers) Regulations. The minimum investment is ₹50 Lakh per portfolio manager. PMS portfolios are concentrated, market-linked and carry higher risk than diversified mutual funds; returns are not assured or promised and past performance does not indicate future returns. Fees, charges and taxes apply as per the agreement with the portfolio manager. Before investing, read the portfolio manager's Disclosure Document carefully, complete their risk profiling and sign the PMS agreement directly with them. Fund Horizon does not manage PMS portfolios — PMS services are provided by the respective portfolio manager.<br><strong>General:</strong> All return figures on this page (8% / 10.5% / 12%) are assumptions for illustration only, not a promise or guarantee. This tool is for education and planning only and is not a solicitation to buy any fund or service. Please consult your advisor and consider your own situation before investing.<br>This report was generated from the numbers you set on screen.<br><strong>AMFI Registered Distributor · ARN 345439</strong> · Fund Horizon, Kharghar, Navi Mumbai</div>";
        $("printReport").innerHTML=html;
      }
      $("downloadPdfBtn").addEventListener("click", function(){
        var v = validateDetails(true);
        if (!v.ok) { scrollToDetails(); return; }
        buildPrintReport(); setTimeout(function(){ window.print(); }, 120);
      });

      /* ================= PMS logic ================= */
      function isPmsEligible(){ return pmsState.corpus >= PMS_MIN; }
      function currentMix(){
        var pmsPct = pmsState.pmsPct, mfPct = 100 - pmsPct;
        var pmsAmt = pmsState.corpus * pmsPct / 100;
        var mfAmt = pmsState.corpus - pmsAmt;
        var minPct = pmsState.corpus > 0 ? Math.ceil(PMS_MIN / pmsState.corpus * 100) : 100;
        return { corpus: pmsState.corpus, mfPct: mfPct, pmsPct: pmsPct, mfAmt: mfAmt, pmsAmt: pmsAmt, minPct: minPct, valid: pmsAmt >= PMS_MIN };
      }
      function selectStrat(id) {
        pmsState.sel = [id];
        $("secondStratNote").classList.remove("show");
        renderPMS();
      }
      function tryAddSecond(id) {
        var mix = currentMix();
        if (mix.pmsAmt < 2 * PMS_MIN) {
          var n = $("secondStratNote");
          n.textContent = "Splitting across 2 managers needs at least ₹1 Crore — SEBI's ₹50 Lakh minimum applies to each manager separately.";
          n.classList.add("show");
          n.scrollIntoView({ behavior: "smooth", block: "center" });
          return;
        }
        if (pmsState.sel.indexOf(id) === -1 && pmsState.sel.length === 1) {
          pmsState.sel = [pmsState.sel[0], id];
          pmsState.splitFirst = 50;
        }
        $("secondStratNote").classList.remove("show");
        renderPMS();
      }
      function removeStrat(id) {
        pmsState.sel = pmsState.sel.filter(function (x) { return x !== id; });
        if (!pmsState.sel.length) pmsState.sel = ["abakkus"];
        renderPMS();
      }
      function stratRowHTML(st, mix) {
        var isSel = pmsState.sel.indexOf(st.id) !== -1;
        var share = isSel ? stratShare(st.id) : 0;
        var amt = mix.pmsAmt * share / 100;
        var actions = '<button type="button" class="link-btn" data-pms-details="' + st.id + '">View details</button>';
        if (!isSel && pmsState.sel.length === 1) actions += '<button type="button" class="link-btn secondary" data-pms-add="' + st.id + '">+ Add as second strategy</button>';
        if (isSel && pmsState.sel.length === 2) actions += '<button type="button" class="link-btn secondary" data-pms-remove="' + st.id + '">Remove</button>';
        return '<div class="strat-row' + (isSel ? " sel" : "") + '" data-strat-row="' + st.id + '" role="button" tabindex="0" aria-pressed="' + isSel + '">' +
          '<span class="radio-dot"></span>' +
          '<div class="fund-main"><div class="fund-name">' + escHtml(st.name) + (st.pick ? '<span class="pick-tag">Marked pick</span>' : "") + "</div>" +
          '<div class="fund-meta"><b>' + escHtml(st.provider) + '</b> · APMI Strategy ID: ' + escHtml(st.apmi) + " · " + escHtml(st.category) + "</div>" +
          miniRetsHTML(st) +
          (isSel ? '<div class="fund-bar"><span style="width:' + share + '%"></span></div>' : "") +
          '<div class="fund-actions">' + actions + "</div></div>" +
          '<div class="fund-amt">' + (isSel ? '<span class="pc">' + share + '%</span><span class="rs">' + fmtINR(amt) + "</span>" : '<span class="tap-hint">Tap to select</span>') + "</div></div>";
      }
      function renderPMS(){
        if (!state.style) state.style = "moderate";
        var def = PMS_DEFAULTS[state.style] || PMS_DEFAULTS.moderate;
        if (lastPmsStyle !== state.style) {
          pmsState.pmsPct = def.pms;
          lastPmsStyle = state.style;
        }
        if (pmsState.pmsPct > def.cap) pmsState.pmsPct = def.cap;
        var eligible = isPmsEligible();
        if (!eligible && pmsState.route === "mix") pmsState.route = "mf";
        // corpus input + chips
        var ci = $("corpusInput");
        if (ci && document.activeElement !== ci) ci.value = Math.round(pmsState.corpus).toLocaleString("en-IN");
        var chips = document.querySelectorAll("#corpusChips .pms-chip");
        for (var c = 0; c < chips.length; c++) {
          chips[c].classList.toggle("on", parseInt(chips[c].getAttribute("data-corpus"), 10) === pmsState.corpus);
        }
        // route cards
        var mixCard = $("routeMixCard");
        if (mixCard) mixCard.classList.toggle("disabled", !eligible);
        var cards = document.querySelectorAll("#routeGrid .route-card");
        for (var r = 0; r < cards.length; r++) {
          cards[r].classList.toggle("selected", cards[r].getAttribute("data-route") === pmsState.route);
        }
        // eligibility note
        var note = $("pmsEligibilityNote");
        if (!eligible) {
          note.textContent = "PMS needs at least ₹50 Lakh as a lump sum (SEBI rule). With " + fmtINR(pmsState.corpus) + " Mutual Funds are the practical route — your SIP plan above already works.";
          note.classList.add("show");
        } else {
          note.classList.remove("show");
        }
        // panels
        var showMix = pmsState.route === "mix" && eligible;
        $("mixPanel").classList.toggle("open", !!showMix);
        $("pmsOnlyPanel").classList.toggle("open", pmsState.route === "pms");
        if (showMix) {
          var mix = currentMix();
          var range = $("mixRange");
          range.max = def.cap;
          if (parseInt(range.value, 10) !== mix.pmsPct) range.value = mix.pmsPct;
          $("mixMfPctLabel").textContent = mix.mfPct + "%";
          $("mixPmsPctLabel").textContent = mix.pmsPct + "%";
          $("mixCapLabel").textContent = "PMS capped at " + def.cap + "% for this style";
          $("mixStyleNote").classList.toggle("show", state.style === "conservative");
          countUp($("mixCorpusVal"), mix.corpus, fmtINR);
          countUp($("mixMfVal"), mix.mfAmt, fmtINR);
          countUp($("mixPmsVal"), mix.pmsAmt, fmtINR);
          var vn = $("mixValidNote");
          if (!mix.valid) {
            vn.textContent = "PMS portion is " + fmtINR(mix.pmsAmt) + " — below the ₹50 Lakh SEBI minimum. Move the slider to at least " + mix.minPct + "% PMS or increase your corpus.";
            vn.classList.add("show");
          } else { vn.classList.remove("show"); }
          // strategy selection — per-manager ₹50L minimum enforced
          if (pmsState.sel.length === 2 && mix.pmsAmt < 2 * PMS_MIN) { pmsState.sel = [pmsState.sel[0]]; }
          var sw = $("splitWrap");
          if (pmsState.sel.length === 2) {
            var minShare = Math.ceil(PMS_MIN / mix.pmsAmt * 100);
            if (pmsState.splitFirst < minShare) pmsState.splitFirst = minShare;
            if (pmsState.splitFirst > 100 - minShare) pmsState.splitFirst = 100 - minShare;
            var sr = $("splitRange");
            sr.min = minShare; sr.max = 100 - minShare; sr.value = pmsState.splitFirst;
            var sa = findStrat(pmsState.sel[0]), sb = findStrat(pmsState.sel[1]);
            $("splitNameA").textContent = (sa ? sa.short : "Strategy A") + " " + pmsState.splitFirst + "% · " + fmtINR(mix.pmsAmt * pmsState.splitFirst / 100);
            $("splitNameB").textContent = (sb ? sb.short : "Strategy B") + " " + (100 - pmsState.splitFirst) + "% · " + fmtINR(mix.pmsAmt * (100 - pmsState.splitFirst) / 100);
            sw.classList.add("open");
          } else { sw.classList.remove("open"); }
          $("pmsStratList").innerHTML = PMS_STRATEGIES.map(function (st) { return stratRowHTML(st, mix); }).join("");
          $("seeAllPmsList").innerHTML = PMS_STRATEGIES.map(function (st) {
            var isSel = pmsState.sel.indexOf(st.id) !== -1;
            var r1 = st.rets.y1.s, r3 = st.rets.y3.s;
            return '<li><span>' + escHtml(st.short) + (st.pick ? " — Marked pick" : "") + (isSel ? " · Selected" : "") + '<br><span style="font-weight:600;color:var(--muted);font-size:12px">1Y <b class="' + retClass(r1) + '">' + fmtRet(r1) + '</b> · 3Y <b class="' + retClass(r3) + '">' + fmtRet(r3) + '</b> · as of ' + escHtml(st.returnsAsOf) + '</span></span><span style="text-align:right">APMI ' + escHtml(st.apmi) + '<br><button type="button" class="link-btn" data-pms-details="' + st.id + '" style="font-size:12.5px">Details</button> ' + (isSel ? "" : '<button type="button" class="link-btn" data-pms-pick="' + st.id + '" style="font-size:12.5px">Select</button>') + "</span></li>";
          }).join("");
        }
        renderSummaryRoute();
      }
      function renderSummaryRoute(){
        var el = $("sumRoute"); if (!el) return;
        if (pmsState.route === "mix" && isPmsEligible()) {
          var mix = currentMix();
          var selTxt = selectedStrats().map(function (st) { var sh = stratShare(st.id); return escHtml(st.short) + " " + fmtINR(mix.pmsAmt * sh / 100); }).join(" · ");
          el.innerHTML = "Mutual Funds + PMS mix — Corpus " + fmtINR(mix.corpus) + ": Mutual Funds (lump sum) " + fmtINR(mix.mfAmt) + " · PMS " + fmtINR(mix.pmsAmt) + (mix.valid ? ("<br>PMS strategy: " + selTxt) : ' · <span class="invalid">PMS portion below the ₹50 Lakh minimum — mix not valid yet</span>');
        } else if (pmsState.route === "pms") {
          el.textContent = "PMS only — enquiry. Final structure after a suitability discussion; ₹50 Lakh minimum applies.";
        } else if (pmsState.route === "mix" || !isPmsEligible()) {
          el.textContent = pmsState.corpus > 0 && !isPmsEligible() ? "Mutual Funds only — PMS needs a ₹50 Lakh lump sum (your corpus: " + fmtINR(pmsState.corpus) + ")" : "Mutual Funds only";
        } else {
          el.textContent = "Mutual Funds only";
        }
      }
      // PMS events
      $("corpusInput").addEventListener("change", function () {
        var v = parseFloat(this.value.replace(/[^0-9.]/g, ""));
        if (!isNaN(v) && v >= 0) { pmsState.corpus = Math.min(1000000000, v); }
        this.value = Math.round(pmsState.corpus).toLocaleString("en-IN");
        renderPMS();
      });
      var corpusChips = document.querySelectorAll("#corpusChips .pms-chip");
      for (var cci = 0; cci < corpusChips.length; cci++) {
        corpusChips[cci].addEventListener("click", function () {
          pmsState.corpus = parseInt(this.getAttribute("data-corpus"), 10);
          renderPMS();
        });
      }
      var routeCards = document.querySelectorAll("#routeGrid .route-card");
      for (var rci = 0; rci < routeCards.length; rci++) {
        routeCards[rci].addEventListener("click", function () {
          var route = this.getAttribute("data-route");
          if (route === "mix" && !isPmsEligible()) {
            var note = $("pmsEligibilityNote");
            note.scrollIntoView({ behavior: "smooth", block: "center" });
            return;
          }
          pmsState.route = route;
          renderPMS();
        });
      }
      $("mixRange").addEventListener("input", function () {
        pmsState.pmsPct = parseInt(this.value, 10);
        renderPMS();
      });
      $("seeAllPmsBtn").addEventListener("click", function () {
        var el = $("seeAllPms");
        var open = el.classList.toggle("open");
        this.textContent = open ? "Hide PMS list" : "See all PMS on FH list";
      });
      $("splitRange").addEventListener("input", function () {
        pmsState.splitFirst = parseInt(this.value, 10);
        renderPMS();
      });
      // Delegated PMS strategy interactions (rows re-render often)
      $("pmsPanel").addEventListener("click", function (e) {
        var t = e.target;
        var det = t.closest ? t.closest("[data-pms-details]") : null;
        if (det) { e.stopPropagation(); openPmsDrawer(det.getAttribute("data-pms-details")); return; }
        var add = t.closest ? t.closest("[data-pms-add]") : null;
        if (add) { e.stopPropagation(); tryAddSecond(add.getAttribute("data-pms-add")); return; }
        var rem = t.closest ? t.closest("[data-pms-remove]") : null;
        if (rem) { e.stopPropagation(); removeStrat(rem.getAttribute("data-pms-remove")); return; }
        var pick = t.closest ? t.closest("[data-pms-pick]") : null;
        if (pick) { e.stopPropagation(); selectStrat(pick.getAttribute("data-pms-pick")); return; }
        var row = t.closest ? t.closest("[data-strat-row]") : null;
        if (row) { selectStrat(row.getAttribute("data-strat-row")); }
      });
      $("pmsPanel").addEventListener("keydown", function (e) {
        if (e.key !== "Enter" && e.key !== " ") return;
        var row = e.target.closest ? e.target.closest("[data-strat-row]") : null;
        if (row && e.target === row) { e.preventDefault(); selectStrat(row.getAttribute("data-strat-row")); }
      });
      $("pmsTalkBtn").addEventListener("click", function () {
        var card = $("summaryCard");
        card.scrollIntoView({ behavior: "smooth", block: "center" });
        card.classList.add("pulse");
        setTimeout(function () { card.classList.remove("pulse"); }, 1600);
      });

      /* ================= Guardrail ================= */
      function renderGuardrail() {
        var show = state.style === "aggressive" && (state.years <= 3 || state.goal === "emergency");
        $("guardrail").classList.toggle("show", !!show);
        if (show) {
          $("guardrailText").textContent = state.goal === "emergency"
            ? "Emergency money needs to be safe and ready anytime — Aggressive swings can hurt at the wrong moment. A calmer style usually fits better."
            : "Short time + Aggressive is risky — markets may not recover before you need the money. A calmer style usually fits better.";
        }
      }
      $("guardrailBtn").addEventListener("click", function () {
        state.style = "moderate";
        var cards = document.querySelectorAll(".style-card");
        for (var j = 0; j < cards.length; j++) {
          cards[j].classList.toggle("selected", cards[j].getAttribute("data-style") === "moderate");
        }
        renderPlan();
      });

      /* ================= Render step 2 ================= */
      function renderStep2() { syncInputs(); renderPlan(); }
      function renderPlan() {
        if (!state.style) state.style = "moderate";
        var s = STYLES[state.style];
        var goal = GOALS.filter(function (g) { return g.id === state.goal; })[0];
        var plan = calcPlan();

        $("bannerStyle").textContent = s.name;
        $("bannerDot").style.background = s.color;
        $("allocSub").textContent = "The " + s.name + " mix — the same split every month.";
        $("assumptionText").innerHTML = "Assumed return for <strong>" + s.name + ": " + s.ret + "% a year</strong>. Assumed, not assured — real returns move up and down.";

        countUp($("sipValue"), plan.sip, fmtINR);
        countUp($("investedValue"), plan.invested, fmtINR);
        countUp($("growthValue"), plan.growth, fmtINR);
        countUp($("lumpsumValue"), plan.lumpsum, fmtINR);

        renderDonut();
        renderFunds(plan.sip);
        renderGuardrail();
        markGoal();
        markPills();

        $("sumStyle").textContent = s.name;
        $("sumGoal").textContent = goal ? goal.name : "—";
        $("sumTarget").textContent = fmtShort(state.target);
        $("sumYears").textContent = state.years + (state.years === 1 ? " year" : " years");
        $("sumSip").textContent = fmtINR(plan.sip) + "/mo";
        renderPMS();
      }

      /* ================= Protection toggles ================= */
      var ynGroups = document.querySelectorAll(".yn");
      for (var yi = 0; yi < ynGroups.length; yi++) {
        (function (group) {
          var key = group.getAttribute("data-check");
          var btns = group.querySelectorAll("button");
          var note = group.closest(".protect-card").querySelector(".gap-note");
          for (var b = 0; b < btns.length; b++) {
            btns[b].addEventListener("click", function () {
              for (var k = 0; k < btns.length; k++) { btns[k].classList.remove("on-yes", "on-no"); }
              var val = this.getAttribute("data-val");
              if (key) protectState[key] = val;
              if (val === "yes") { this.classList.add("on-yes"); note.classList.remove("show"); }
              else { this.classList.add("on-no"); note.classList.add("show"); }
            });
          }
        })(ynGroups[yi]);
      }

      /* ================= Your details — validation (DPDP consent) ================= */
      function normPhone(raw) {
        var d = String(raw || "").replace(/\D/g, "");
        if (d.length === 12 && d.indexOf("91") === 0) d = d.slice(2);
        if (d.length === 11 && d.charAt(0) === "0") d = d.slice(1);
        return d;
      }
      function contactData() {
        return {
          name: ($("cdName").value || "").trim(),
          email: ($("cdEmail").value || "").trim(),
          phone: normPhone($("cdPhone").value || "")
        };
      }
      function fmtPhone(d) { return d && d.length === 10 ? "+91 " + d.slice(0, 5) + " " + d.slice(5) : d; }
      function setFieldErr(input, errEl, bad) {
        input.classList.toggle("invalid", !!bad);
        errEl.classList.toggle("show", !!bad);
        return !bad;
      }
      function validateDetails(show) {
        var cd = contactData();
        var nameOk = (cd.name.match(/[A-Za-z]/g) || []).length >= 3;
        var emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(cd.email);
        var phoneOk = /^[6-9]\d{9}$/.test(cd.phone);
        if (show) {
          setFieldErr($("cdName"), $("errName"), !nameOk);
          setFieldErr($("cdEmail"), $("errEmail"), !emailOk);
          setFieldErr($("cdPhone"), $("errPhone"), !phoneOk);
        }
        return { ok: nameOk && emailOk && phoneOk, nameOk: nameOk, emailOk: emailOk, phoneOk: phoneOk, data: cd };
      }
      function validateConsent(show) {
        var ok = $("cdConsent").checked;
        if (show) {
          $("errConsent").classList.toggle("show", !ok);
          $("consentRow").classList.toggle("bad", !ok);
        }
        return ok;
      }
      function scrollToDetails() {
        var p = $("detailsPanel");
        p.scrollIntoView({ behavior: "smooth", block: "center" });
        p.classList.add("err-flash");
        setTimeout(function () { p.classList.remove("err-flash"); }, 1800);
        var v = validateDetails(false);
        var firstBad = !v.nameOk ? $("cdName") : (!v.emailOk ? $("cdEmail") : (!v.phoneOk ? $("cdPhone") : null));
        if (firstBad) setTimeout(function () { firstBad.focus({ preventScroll: true }); }, 450);
      }
      function updatePreparedLine() {
        var cd = contactData();
        var wrap = $("sumPrepared");
        if (cd.name) {
          $("sumPreparedVal").textContent = cd.name + (cd.phone ? " · " + fmtPhone(cd.phone) : "");
          wrap.style.display = "";
        } else { wrap.style.display = "none"; }
      }
      [["cdName","errName"],["cdEmail","errEmail"],["cdPhone","errPhone"]].forEach(function (pair) {
        $(pair[0]).addEventListener("input", function () {
          this.classList.remove("invalid");
          $(pair[1]).classList.remove("show");
          $("talkSuccess").classList.remove("show");
          updatePreparedLine();
        });
        $(pair[0]).addEventListener("blur", function () {
          var cd = contactData();
          if (pair[0] === "cdName") setFieldErr(this, $("errName"), (cd.name.match(/[A-Za-z]/g) || []).length < 3 && cd.name.length > 0);
          if (pair[0] === "cdEmail") setFieldErr(this, $("errEmail"), cd.email.length > 0 && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(cd.email));
          if (pair[0] === "cdPhone") setFieldErr(this, $("errPhone"), cd.phone.length > 0 && !/^[6-9]\d{9}$/.test(cd.phone));
          updatePreparedLine();
        });
      });
      $("cdConsent").addEventListener("change", function () {
        if (this.checked) { $("errConsent").classList.remove("show"); $("consentRow").classList.remove("bad"); }
      });

      /* ================= CTA / reset ================= */
      $("ctaBtn").addEventListener("click", function () {
        var v = validateDetails(true);
        var cOk = validateConsent(true);
        if (!v.ok || !cOk) { scrollToDetails(); return; }
        var first = v.data.name.split(/\s+/)[0];
        var box = $("talkSuccess");
        box.innerHTML = "Thank you, <strong>" + escHtml(first) + "</strong> — your plan summary is ready. Fund Horizon will reach you on <strong>" + escHtml(fmtPhone(v.data.phone)) + "</strong> / <strong>" + escHtml(v.data.email) + '</strong>.<span class="small">Your details are captured in this plan and its PDF report.</span>';
        box.classList.add("show");
        box.scrollIntoView({ behavior: "smooth", block: "center" });
      });
      $("startOverBtn").addEventListener("click", function () {
        state.style = null; state.goal = "education"; state.target = 2500000; state.years = 10;
        pmsState = { route: "mf", corpus: 10000000, pmsPct: 30, sel: ["abakkus"], splitFirst: 50 }; lastPmsStyle = null;
        var seeAllPmsEl = $("seeAllPms"); if (seeAllPmsEl) seeAllPmsEl.classList.remove("open");
        var sapBtn = $("seeAllPmsBtn"); if (sapBtn) sapBtn.textContent = "See all PMS on FH list";
        var snEl = $("secondStratNote"); if (snEl) snEl.classList.remove("show");
        protectState = { emergency: null, term: null, health: null };
        ["cdName","cdEmail","cdPhone"].forEach(function (id) { var el = $(id); el.value = ""; el.classList.remove("invalid"); });
        ["errName","errEmail","errPhone","errConsent"].forEach(function (id) { $(id).classList.remove("show"); });
        $("cdConsent").checked = false; $("consentRow").classList.remove("bad");
        $("talkSuccess").classList.remove("show");
        $("sumPrepared").style.display = "none";
        closePmsDrawer();
        closeAIModal();
        quizAnswers = [0, 0, 0];
        var cards = document.querySelectorAll(".style-card");
        for (var i = 0; i < cards.length; i++) cards[i].classList.remove("selected");
        var opts = document.querySelectorAll(".quiz-opt");
        for (var j = 0; j < opts.length; j++) opts[j].classList.remove("picked");
        $("quizResult").classList.remove("show");
        $("quizPanel").classList.remove("open");
        var ynBtns = document.querySelectorAll(".yn button");
        for (var k = 0; k < ynBtns.length; k++) ynBtns[k].classList.remove("on-yes", "on-no");
        var notes = document.querySelectorAll(".gap-note");
        for (var m = 0; m < notes.length; m++) notes[m].classList.remove("show");
        buildStyleCards();
        goToStep(1, true);
      });

      /* ================= Init ================= */
      buildStyleCards();
      buildGoals();
      buildPills();

  return function cleanup() {
    try {
      document.removeEventListener("keydown", onKeydown);
    } catch (e) {}
    try {
      if (typeof anims === "object" && anims) {
        for (var k in anims) {
          if (anims[k]) cancelAnimationFrame(anims[k]);
        }
      }
    } catch (e) {}
    try {
      if (aiRevealTimer) clearTimeout(aiRevealTimer);
    } catch (e) {}
    try {
      document.body.style.overflow = "";
    } catch (e) {}
  };
}
