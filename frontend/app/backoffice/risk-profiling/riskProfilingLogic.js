/* eslint-disable */
import { API_URL, resolveApiUrl } from "@/lib/api";
import { pdfBlob, renderCard } from "@/lib/calcExport";
import { rebalance, adjustedReturn, fundPcts, nudges, ASSET_KEYS } from "./allocEngine.mjs";

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
      var state = { style: null, goal: "education", target: 2500000, years: 10, excluded: [] };
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
        state.style = key; state.excluded = [];
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
      $("allocReset").addEventListener("click", function () { state.excluded = []; renderPlan(); });

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
            state.style = this.getAttribute("data-pill"); state.excluded = [];
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

      /* Rebalanced mix: the style's baseline minus any asset classes staff unticked (see allocEngine.mjs). */
      function allocView() {
        var s = STYLES[state.style];
        var r = rebalance(state.style, s.alloc, state.excluded, state.years, state.goal);
        return { r: r, ret: adjustedReturn(s.ret, s.alloc, r.alloc) };
      }
      function curAlloc() { return allocView().r.alloc; }
      function curRet() { return allocView().ret; }

      function calcPlan(retOverride) {
        var annual = (retOverride == null ? curRet() : retOverride) / 100;
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
        var alloc = curAlloc();
        var segs = { equity: $("segEquity"), debt: $("segDebt"), gold: $("segGold"), liquid: $("segLiquid") };
        var offset = 0;
        ASSETS.forEach(function (a) {
          var frac = alloc[a.key] / 100;
          var len = Math.max(0, frac * CIRC - (frac > 0 ? 2.5 : 0));
          var el = segs[a.key];
          el.style.strokeDasharray = len + " " + (CIRC - len);
          el.style.strokeDashoffset = -offset;
          offset += frac * CIRC;
        });
        $("donutBig").textContent = alloc.equity + "%";
        var kept = ASSETS.filter(function (a) { return state.excluded.indexOf(a.key) < 0; }).length;
        $("allocLegend").innerHTML = ASSETS.map(function (a) {
          var on = state.excluded.indexOf(a.key) < 0;
          return '<li class="' + (on ? "" : "off") + '"><label class="alloc-opt"><input type="checkbox" data-asset="' + a.key + '"' + (on ? " checked" : "") + (on && kept === 1 ? " disabled" : "") + ' aria-label="Include ' + a.label + '"><i style="background:' + a.color + '"></i><span class="nm">' + a.label + '</span></label><span class="pc">' + alloc[a.key] + "%</span></li>";
        }).join("");
        var boxes = $("allocLegend").querySelectorAll("input[data-asset]");
        for (var b = 0; b < boxes.length; b++) {
          boxes[b].addEventListener("change", function () {
            var k = this.getAttribute("data-asset"), i = state.excluded.indexOf(k);
            if (this.checked && i >= 0) state.excluded.splice(i, 1);
            else if (!this.checked && i < 0) state.excluded.push(k);
            renderPlan();
          });
        }
        $("allocReset").style.display = state.excluded.length ? "" : "none";
      }

      /* ================= Nudges: plain-language guidance on the current mix ================= */
      function renderNudges(plan) {
        var s = STYLES[state.style], v = allocView();
        var goal = GOALS.filter(function (g) { return g.id === state.goal; })[0];
        var base = calcPlan(s.ret);
        var list = nudges({
          style: state.style, styleName: s.name, baseAlloc: s.alloc, alloc: v.r.alloc, excluded: state.excluded, moved: v.r.moved, relaxed: v.r.relaxed,
          years: state.years, goalId: state.goal, goalName: goal ? goal.name : "", baseRet: s.ret, ret: v.ret, sip: plan.sip, baseSip: base.sip, fmt: fmtINR,
          fundNote: fundPcts(s.funds, s.alloc, v.r.alloc).note
        });
        var icon = { alert: "\u26A0", warn: "\u2757", info: "\u2139" };
        $("allocNudges").innerHTML = list.map(function (n) {
          return '<li class="nudge ' + n.level + '"><span class="ni" aria-hidden="true">' + icon[n.level] + "</span><span>" + escHtml(n.text) + "</span></li>";
        }).join("");
      }

      /* ================= Funds — FH Recommended List ================= */
      var protectState = { emergency: null, term: null, health: null };
      var lastPlanCache = null;
      function escHtml(s){ return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
      function renderFunds(sip) {
        var s = STYLES[state.style];
        var fp = fundPcts(s.funds, s.alloc, curAlloc());
        var html = s.funds.map(function (f, idx) {
          var fpct = fp.note === "none" ? 0 : fp.pcts[idx];
          if (!fpct) return "";
          var amt = sip * fpct / 100;
          var peers = (FH_BY_CATEGORY[f.category] || []).filter(function(x){ return x.code !== f.code; });
          var peersHtml = peers.length ? '<div class="see-all" id="seeall-'+idx+'"><h4>All funds in '+escHtml(f.category)+' — FH Recommended List</h4><ul>'+peers.map(function(p){ return '<li><span>'+escHtml(p.name)+'</span><span>AMFI '+escHtml(p.code)+'</span></li>'; }).join("")+'<li><span>'+escHtml(f.name)+' (in this plan)</span><span>AMFI '+escHtml(f.code)+'</span></li></ul></div>' : '';
          var seeBtn = peers.length ? '<button type="button" class="link-btn secondary" data-seeall="'+idx+'">See all funds in this category</button>' : '';
          return '<div class="fund-row"><div class="fund-main">' +
            '<div class="fund-name">' + escHtml(f.name) + (f.pick ? '<span class="pick-tag">Marked pick</span>' : "") + "</div>" +
            '<div class="fund-meta"><b>'+escHtml(f.category)+'</b> · AMFI Scheme Code: '+escHtml(f.code)+' · Regular Plan · Growth</div>' +
            '<div class="fund-desc">' + escHtml(f.desc) + "</div>" +
            '<div class="fund-bar"><span style="width:' + fpct + '%"></span></div>' +
            '<div class="fund-actions"><button type="button" class="link-btn" data-explain-fund="'+idx+'">Explain this fund</button>'+seeBtn+'</div>' +
            peersHtml +
            '</div>' +
            '<div class="fund-amt"><span class="pc">' + fpct + '%</span><span class="rs">' + fmtINR(amt) + "/mo</span></div></div>";
        }).join("");
        $("fundList").innerHTML = html || '<p class="list-note">No FH Recommended funds apply to this mix. See the note above.</p>';
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
        var allocLine = ASSETS.map(function(a){ return a.label+" "+curAlloc()[a.key]+"%"; }).join(", ");
        var fundLines = s.funds.map(function(f){ var amt=plan.sip*f.pct/100; return "<li><strong>"+escHtml(f.name)+"</strong> ("+escHtml(f.category)+", AMFI "+escHtml(f.code)+") — "+f.pct+"% · <strong>"+fmtINR(amt)+"/month</strong>. "+escHtml(f.desc)+"</li>"; }).join("");
        var why = "";
        if(state.style==="conservative"){ why = "You picked <strong>Conservative</strong> for <strong>"+escHtml(goal?goal.name:"your goal")+"</strong> — target "+fmtINR(d.target)+" in "+d.years+(d.years===1?" year":" years")+". This style keeps equity low at "+curAlloc().equity+"% and leans on multi-asset and large-cap holdings, so the ride is calmer. At an assumed "+curRet()+"% a year, the maths points to a monthly SIP of <strong>"+fmtINR(plan.sip)+"</strong>."; }
        else if(state.style==="aggressive"){ why = "You picked <strong>Aggressive</strong> for <strong>"+escHtml(goal?goal.name:"your goal")+"</strong> — target "+fmtINR(d.target)+" in "+d.years+" years. This style puts "+curAlloc().equity+"% in equity for long-term growth, with flexi, mid, small and multi-cap funds doing the heavy lifting. At an assumed "+curRet()+"% a year, the monthly SIP works out to <strong>"+fmtINR(plan.sip)+"</strong>. The longer horizon gives markets more time to recover from falls."; }
        else { why = "You picked <strong>Moderate</strong> for <strong>"+escHtml(goal?goal.name:"your goal")+"</strong> — target "+fmtINR(d.target)+" in "+d.years+" years. This style balances growth and steadiness with "+curAlloc().equity+"% in equity ("+allocLine+"). At an assumed "+curRet()+"% a year, the monthly SIP works out to <strong>"+fmtINR(plan.sip)+"</strong> — you invest "+fmtINR(plan.invested)+" in total, with "+fmtINR(plan.growth)+" shown as growth in this illustration."; }
        var riskText = state.style==="aggressive" ? "Values will swing — sometimes sharply. Mid and small-cap parts can fall more than the wider market. If you need this money sooner than planned, or a fall would make you stop the SIP, this mix will feel uncomfortable. Returns are not assured and the assumed "+curRet()+"% may not happen." : (state.style==="conservative" ? "Even a calmer mix can dip for short periods, and multi-asset funds still hold equity. Inflation can also eat into low-risk returns over time. The assumed "+curRet()+"% is an illustration, not a promise — check the plan yearly and keep emergency money separate." : "Markets will fall at times and this mix will fall with them, though the multi-asset and large-cap parts are there to soften it. Returns are not assured and the assumed "+curRet()+"% may not happen. Stopping the SIP during a fall is the most common way this type of plan misses its target.");
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
      
      
      var OFFICIAL_LOGO_B64 = "data:image/png;base64,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";
      var BACKTEST_DATA = {"conservative": {"start": "May 2008", "end": "22 Oct 2026", "basis": "daily", "months": 221, "joins": ["DSP Multi Asset Allocation Fund from Sep 2023", "WhiteOak Capital Multi Asset Allocation Fund from May 2023"], "cagr": {"1y": -0.008647117868685994, "3y": 0.12626242415619804, "5y": 0.1033165759073047, "10y": 0.12912725048409435, "all": 0.13873931305103393}, "vol": 0.17448303067619858, "max_drawdown": -0.3994053518334987, "worst_12m": -0.24650391087935564, "growth_sampled": [{"d": "2008-05-26", "v": 100.0}, {"d": "2008-10-01", "v": 88.92}, {"d": "2009-02-18", "v": 69.56}, {"d": "2009-07-08", "v": 102.3}, {"d": "2009-11-19", "v": 130.94}, {"d": "2010-04-06", "v": 144.61}, {"d": "2010-08-11", "v": 152.5}, {"d": "2010-12-21", "v": 169.36}, {"d": "2011-05-03", "v": 162.28}, {"d": "2011-09-09", "v": 152.59}, {"d": "2012-01-23", "v": 154.79}, {"d": "2012-06-05", "v": 150.5}, {"d": "2012-10-15", "v": 174.55}, {"d": "2013-02-25", "v": 182.34}, {"d": "2013-07-08", "v": 179.04}, {"d": "2013-11-20", "v": 196.21}, {"d": "2014-03-31", "v": 215.87}, {"d": "2014-08-12", "v": 255.09}, {"d": "2014-12-31", "v": 285.73}, {"d": "2015-05-15", "v": 287.72}, {"d": "2015-09-21", "v": 283.83}, {"d": "2016-02-04", "v": 264.57}, {"d": "2016-06-17", "v": 294.81}, {"d": "2016-11-01", "v": 322.06}, {"d": "2017-03-10", "v": 333.83}, {"d": "2017-07-21", "v": 373.55}, {"d": "2017-12-01", "v": 391.12}, {"d": "2018-04-16", "v": 400.7}, {"d": "2018-08-23", "v": 425.55}, {"d": "2019-01-08", "v": 401.6}, {"d": "2019-05-22", "v": 423.55}, {"d": "2019-10-03", "v": 415.57}, {"d": "2020-02-13", "v": 444.91}, {"d": "2020-06-30", "v": 379.94}, {"d": "2020-11-04", "v": 428.94}, {"d": "2021-03-17", "v": 539.22}, {"d": "2021-07-29", "v": 587.72}, {"d": "2021-12-10", "v": 653.89}, {"d": "2022-04-22", "v": 648.3}, {"d": "2022-09-01", "v": 666.67}, {"d": "2023-01-11", "v": 692.02}, {"d": "2023-05-26", "v": 709.07}, {"d": "2023-10-06", "v": 760.01}, {"d": "2024-02-19", "v": 852.68}, {"d": "2024-07-03", "v": 933.64}, {"d": "2024-11-12", "v": 952.59}, {"d": "2025-03-25", "v": 967.6}, {"d": "2025-08-04", "v": 1032.39}, {"d": "2025-12-17", "v": 1117.5}, {"d": "2026-05-04", "v": 1123.62}, {"d": "2026-09-09", "v": 1137.37}, {"d": "2026-10-22", "v": 1092.89}]}, "moderate": {"start": "Apr 2006", "end": "22 Oct 2026", "basis": "daily", "months": 246, "joins": ["ICICI Prudential Large Cap Fund (erstwhile Bluechip Fund) from May 2008", "WhiteOak Capital Flexi Cap Fund from Aug 2022", "Nippon India Multi Asset Allocation Fund from Aug 2020"], "cagr": {"1y": -0.06936605905355275, "3y": 0.11229337965225916, "5y": 0.10509781598130763, "10y": 0.12434180313415699, "all": 0.12895981841452375}, "vol": 0.18947512170918315, "max_drawdown": -0.5423002556272416, "worst_12m": -0.4585862742851603, "growth_sampled": [{"d": "2006-04-02", "v": 100.0}, {"d": "2006-08-24", "v": 96.08}, {"d": "2007-01-17", "v": 116.02}, {"d": "2007-06-14", "v": 116.82}, {"d": "2007-11-02", "v": 159.94}, {"d": "2008-03-28", "v": 129.48}, {"d": "2008-08-21", "v": 118.87}, {"d": "2009-01-21", "v": 83.03}, {"d": "2009-06-24", "v": 128.05}, {"d": "2009-11-18", "v": 157.24}, {"d": "2010-04-19", "v": 166.26}, {"d": "2010-09-03", "v": 179.7}, {"d": "2011-01-27", "v": 185.28}, {"d": "2011-06-21", "v": 179.01}, {"d": "2011-11-17", "v": 172.46}, {"d": "2012-04-12", "v": 187.12}, {"d": "2012-09-03", "v": 187.55}, {"d": "2013-01-29", "v": 218.88}, {"d": "2013-06-24", "v": 198.63}, {"d": "2013-11-19", "v": 230.19}, {"d": "2014-04-11", "v": 253.55}, {"d": "2014-09-08", "v": 317.09}, {"d": "2015-02-06", "v": 340.77}, {"d": "2015-07-03", "v": 333.12}, {"d": "2015-11-30", "v": 326.73}, {"d": "2016-04-27", "v": 326.77}, {"d": "2016-09-19", "v": 374.45}, {"d": "2017-02-10", "v": 386.25}, {"d": "2017-07-07", "v": 417.21}, {"d": "2017-11-30", "v": 455.28}, {"d": "2018-04-26", "v": 454.11}, {"d": "2018-09-18", "v": 467.92}, {"d": "2019-02-13", "v": 430.97}, {"d": "2019-07-11", "v": 468.96}, {"d": "2019-12-10", "v": 474.07}, {"d": "2020-05-07", "v": 371.37}, {"d": "2020-09-24", "v": 430.48}, {"d": "2021-02-17", "v": 594.21}, {"d": "2021-07-14", "v": 643.21}, {"d": "2021-12-09", "v": 717.82}, {"d": "2022-05-05", "v": 695.59}, {"d": "2022-09-26", "v": 723.57}, {"d": "2023-02-17", "v": 757.28}, {"d": "2023-07-17", "v": 848.75}, {"d": "2023-12-12", "v": 952.51}, {"d": "2024-05-09", "v": 1054.63}, {"d": "2024-10-01", "v": 1255.49}, {"d": "2025-02-24", "v": 1111.76}, {"d": "2025-07-21", "v": 1258.76}, {"d": "2025-12-16", "v": 1301.84}, {"d": "2026-05-14", "v": 1248.42}, {"d": "2026-10-06", "v": 1246.43}, {"d": "2026-10-22", "v": 1210.17}]}, "aggressive": {"start": "Nov 2018", "end": "22 Oct 2026", "basis": "daily", "months": 95, "joins": ["WhiteOak Capital Flexi Cap Fund from Aug 2022", "WhiteOak Capital Mid Cap Fund from Sep 2022", "Mirae Asset Multicap Fund from Aug 2023"], "cagr": {"1y": -0.016657638340885073, "3y": 0.13827495993215888, "5y": 0.13123169209723495, "10y": null, "all": 0.18478635971259827}, "vol": 0.16962174465249485, "max_drawdown": -0.3767290480065093, "worst_12m": -0.22811918063314574, "growth_sampled": [{"d": "2018-11-04", "v": 100.0}, {"d": "2019-01-02", "v": 102.28}, {"d": "2019-02-26", "v": 94.65}, {"d": "2019-04-26", "v": 104.46}, {"d": "2019-06-25", "v": 102.68}, {"d": "2019-08-21", "v": 92.77}, {"d": "2019-10-22", "v": 102.48}, {"d": "2019-12-18", "v": 104.16}, {"d": "2020-02-12", "v": 117.84}, {"d": "2020-04-15", "v": 85.53}, {"d": "2020-06-11", "v": 93.86}, {"d": "2020-08-05", "v": 101.88}, {"d": "2020-09-29", "v": 112.49}, {"d": "2020-11-25", "v": 119.62}, {"d": "2021-01-21", "v": 137.26}, {"d": "2021-03-19", "v": 152.13}, {"d": "2021-05-20", "v": 165.31}, {"d": "2021-07-14", "v": 193.76}, {"d": "2021-09-09", "v": 202.48}, {"d": "2021-11-09", "v": 218.93}, {"d": "2022-01-04", "v": 218.73}, {"d": "2022-03-02", "v": 194.75}, {"d": "2022-04-29", "v": 202.58}, {"d": "2022-06-24", "v": 181.57}, {"d": "2022-08-22", "v": 206.36}, {"d": "2022-10-18", "v": 214.8}, {"d": "2022-12-15", "v": 218.82}, {"d": "2023-02-09", "v": 211.79}, {"d": "2023-04-11", "v": 208.69}, {"d": "2023-06-07", "v": 232.23}, {"d": "2023-08-02", "v": 250.12}, {"d": "2023-09-29", "v": 260.59}, {"d": "2023-11-29", "v": 276.17}, {"d": "2024-01-25", "v": 296.52}, {"d": "2024-03-22", "v": 298.89}, {"d": "2024-05-23", "v": 325.98}, {"d": "2024-07-19", "v": 351.14}, {"d": "2024-09-13", "v": 378.71}, {"d": "2024-11-11", "v": 366.17}, {"d": "2025-01-08", "v": 370.98}, {"d": "2025-03-05", "v": 324.79}, {"d": "2025-05-06", "v": 347.08}, {"d": "2025-06-30", "v": 385.91}, {"d": "2025-08-25", "v": 382.94}, {"d": "2025-10-24", "v": 392.25}, {"d": "2025-12-19", "v": 390.22}, {"d": "2026-02-17", "v": 384.91}, {"d": "2026-04-17", "v": 381.22}, {"d": "2026-06-15", "v": 392.58}, {"d": "2026-08-10", "v": 418.07}, {"d": "2026-10-06", "v": 401.27}, {"d": "2026-10-22", "v": 385.92}]}};

      function renderPrintDonutSVG(alloc) {
        var CIRC = 2 * Math.PI * 84;
        var segs = [
          { key: "equity", val: alloc.equity, col: "#178A50" },
          { key: "debt", val: alloc.debt, col: "#2F6DB3" },
          { key: "gold", val: alloc.gold, col: "#DFA00C" },
          { key: "liquid", val: alloc.liquid, col: "#93A1B0" }
        ];
        var offset = 0;
        var circles = segs.map(function (s) {
          var frac = s.val / 100;
          var len = Math.max(0, frac * CIRC - (frac > 0 ? 2 : 0));
          var svgCircle = '<circle cx="105" cy="105" r="84" fill="none" stroke="' + s.col + '" stroke-width="28" ' +
            'stroke-dasharray="' + len.toFixed(1) + ' ' + (CIRC - len).toFixed(1) + '" stroke-dashoffset="' + (-offset).toFixed(1) + '"/>';
          offset += frac * CIRC;
          return svgCircle;
        }).join("");

        return '<svg width="120" height="120" viewBox="0 0 210 210" style="transform:rotate(-90deg);flex:none;" role="img" aria-label="Asset allocation donut">' +
          '<circle cx="105" cy="105" r="84" fill="none" stroke="#EDF1ED" stroke-width="28"/>' +
          circles +
          '</svg>';
      }

      function renderBacktestChartSVG(bt) {
        var pts = bt.growth_sampled;
        var vs = pts.map(function(p){ return p.v; });
        var lo = Math.min.apply(null, vs.concat([100]));
        var hi = Math.max.apply(null, vs);
        var W = 620, H = 105, padL = 42, padR = 68, padT = 16, padB = 20;
        var plotW = W - padL - padR, plotH = H - padT - padB;
        var coords = pts.map(function(p, i) {
          var x = padL + (i / (pts.length - 1)) * plotW;
          var y = padT + plotH - ((p.v - lo) / (hi - lo)) * plotH;
          return [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
        });
        var ptsStr = coords.map(function(c){ return c[0] + ',' + c[1]; }).join(' ');
        var areaStr = padL + ',' + (padT + plotH) + ' ' + ptsStr + ' ' + (padL + plotW) + ',' + (padT + plotH);
        
        var gridSvg = '';
        var gridVals = [lo, (lo + hi) / 2, hi];
        gridVals.forEach(function(gv) {
          var gy = padT + plotH - ((gv - lo) / (hi - lo)) * plotH;
          gridSvg += '<line x1="' + padL + '" y1="' + gy.toFixed(1) + '" x2="' + (padL + plotW) + '" y2="' + gy.toFixed(1) + '" stroke="#E3EBE4" stroke-dasharray="3 3" stroke-width="1"/>';
          gridSvg += '<text x="' + (padL - 6) + '" y="' + (gy + 3.5).toFixed(1) + '" text-anchor="end" font-size="9" fill="#84938A" font-weight="700">₹' + Math.round(gv) + '</text>';
        });

        var startPt = coords[0];
        var endPt = coords[coords.length - 1];

        return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" height="' + H + '" role="img" aria-label="Historical fund backtest growth chart">' +
          '<defs>' +
            '<linearGradient id="prBtGrad" x1="0" y1="0" x2="0" y2="1">' +
              '<stop offset="0%" stop-color="#0C6B4F" stop-opacity="0.24"/>' +
              '<stop offset="100%" stop-color="#0C6B4F" stop-opacity="0.02"/>' +
            '</linearGradient>' +
          '</defs>' +
          gridSvg +
          '<polygon points="' + areaStr + '" fill="url(#prBtGrad)" />' +
          '<polyline points="' + ptsStr + '" fill="none" stroke="#0C6B4F" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />' +
          '<circle cx="' + startPt[0] + '" cy="' + startPt[1] + '" r="' + 3.5 + '" fill="#0C6B4F" />' +
          '<circle cx="' + endPt[0] + '" cy="' + endPt[1] + '" r="' + 4.5 + '" fill="#0C6B4F" stroke="#fff" stroke-width="2" />' +
          '<text x="' + (startPt[0] + 6) + '" y="' + (startPt[1] - 5) + '" font-size="9.5" font-weight="700" fill="#5C6B63">₹100 (' + bt.start + ')</text>' +
          '<rect x="' + (endPt[0] + 4) + '" y="' + (endPt[1] - 11) + '" width="62" height="20" rx="5" fill="#0C6B4F" />' +
          '<text x="' + (endPt[0] + 35) + '" y="' + (endPt[1] + 3) + '" text-anchor="middle" font-size="10" font-weight="800" fill="#fff">₹' + Math.round(vs[vs.length - 1]) + '</text>' +
        '</svg>';
      }

      function buildPrintReport() {
        var d = currentPlanData();
        var s = d.style, plan = d.plan, goal = d.goal;
        var cd = contactData();
        var investorName = cd.name ? escHtml(cd.name) : "Valued Investor";
        var dateStr = new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
        var refId = "FH-RP-" + dateStr.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();

        var investPct = Math.min(100, Math.round((plan.invested / d.target) * 100));
        var growthPct = Math.max(0, 100 - investPct);

        var donutSVG = renderPrintDonutSVG(curAlloc());

        var assetBarsHTML = ASSETS.map(function (a) {
          var val = curAlloc()[a.key];
          var role = a.key === "equity" ? "Primary Growth Engine" : (a.key === "debt" ? "Capital Stability & Income" : (a.key === "gold" ? "Inflation & Crisis Hedge" : "Emergency & Cash Buffer"));
          return '<div class="pr-asset-row">' +
            '<div class="pr-asset-head"><span><i style="background:' + a.color + '"></i>' + a.label + ' <small>(' + role + ')</small></span><strong>' + val + '%</strong></div>' +
            '<div class="pr-bar-track"><span style="width:' + val + '%;background:' + a.color + ';"></span></div>' +
          '</div>';
        }).join("");

        var fundCardsHTML = s.funds.map(function (f) {
          var amt = plan.sip * f.pct / 100;
          return '<div class="pr-fund-item">' +
            '<div class="pr-fund-info">' +
              '<div class="pr-fund-title"><strong>' + escHtml(f.name) + '</strong>' + (f.pick ? '<span class="pr-pick-badge">Marked Pick</span>' : '') + '</div>' +
              '<div class="pr-fund-sub"><b>' + escHtml(f.category) + '</b> · AMFI Code: ' + escHtml(f.code) + ' · Regular Plan · Growth</div>' +
              '<div class="pr-fund-bar"><span style="width:' + f.pct + '%;"></span></div>' +
            '</div>' +
            '<div class="pr-fund-numbers">' +
              '<div class="pr-fund-sip">' + fmtINR(amt) + ' <small>/ mo</small></div>' +
              '<div class="pr-fund-weight">' + f.pct + '% of SIP</div>' +
            '</div>' +
          '</div>';
        }).join("");

        var bt = BACKTEST_DATA[state.style] || BACKTEST_DATA.moderate;
        var btSVG = renderBacktestChartSVG(bt);
        var btAllCagr = (bt.cagr.all * 100).toFixed(1) + "%";
        var bt3Y = bt.cagr["3y"] !== null ? (bt.cagr["3y"] * 100).toFixed(1) + "%" : "—";
        var bt5Y = bt.cagr["5y"] !== null ? (bt.cagr["5y"] * 100).toFixed(1) + "%" : "—";
        var bt1Y = bt.cagr["1y"] !== null ? (bt.cagr["1y"] * 100).toFixed(1) + "%" : "—";
        var btLastVal = bt.growth_sampled[bt.growth_sampled.length - 1].v;
        var btMultiplier = (btLastVal / 100).toFixed(2) + "x";
        var btVol = (bt.vol * 100).toFixed(1) + "%";
        var btMaxDd = (bt.max_drawdown * 100).toFixed(1) + "%";

        function protBadge(k) {
          if (protectState[k] === "yes") return '<span class="pr-status-badge ok">✓ Confirmed</span>';
          if (protectState[k] === "no") return '<span class="pr-status-badge warn">⚠ Action Needed</span>';
          return '<span class="pr-status-badge muted">— Not Reviewed</span>';
        }

        var pmsHTML = "";
        if (pmsState.route === "mix" && isPmsEligible()) {
          var mx = currentMix();
          var selList = selectedStrats();
          var stratChips = selList.map(function(st) {
            var sh = stratShare(st.id);
            return '<div class="pr-pms-box">' +
              '<div style="display:flex;justify-content:space-between;align-items:center;"><strong>' + escHtml(st.name) + '</strong><span class="pr-badge">APMI ' + escHtml(st.apmi) + '</span></div>' +
              '<div style="font-size:11px;color:#5C6B63;margin-top:2px;">' + escHtml(st.provider) + ' · ' + escHtml(st.category) + '</div>' +
              '<div style="margin-top:6px;display:flex;gap:12px;font-size:12px;"><span>Alloc: <b>' + sh + '% (' + fmtINR(mx.pmsAmt * sh / 100) + ')</b></span><span>3Y: <b>' + fmtRet(st.rets.y3.s) + '</b></span><span>SI: <b>' + fmtRet(st.rets.si.s) + '</b></span></div>' +
            '</div>';
          }).join("");
          pmsHTML = '<div class="pr-card" style="margin-top:14px;">' +
            '<div class="pr-card-header"><h3>Portfolio Management Services (PMS) Allocation</h3><span class="pr-badge">SEBI Minimum ₹50 Lakh Enforced</span></div>' +
            '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:8px 0 10px;">' +
              '<div class="pr-kpi"><span class="k">Total Lump Sum Corpus</span><span class="v">' + fmtINR(mx.corpus) + '</span></div>' +
              '<div class="pr-kpi"><span class="k">Mutual Funds (' + mx.mfPct + '%)</span><span class="v">' + fmtINR(mx.mfAmt) + '</span></div>' +
              '<div class="pr-kpi highlight"><span class="k">PMS Share (' + mx.pmsPct + '%)</span><span class="v">' + fmtINR(mx.pmsAmt) + '</span></div>' +
            '</div>' +
            '<div style="display:flex;flex-direction:column;gap:8px;">' + stratChips + '</div>' +
          '</div>';
        }

        var html = '<div class="pr-page">' +
          '<div class="pr-head">' +
            '<div class="pr-brand-wrap">' +
              '<img src="' + OFFICIAL_LOGO_B64 + '" class="pr-logo" alt="Fund Horizon" />' +
            '</div>' +
            '<div class="pr-reg-wrap">' +
              '<div class="pr-arn-badge">AMFI REGISTERED DISTRIBUTOR · ARN 345439</div>' +
              '<div class="pr-reg-text">Institutional Wealth Planning Terminal</div>' +
              '<div class="pr-date">Report Generated: <b>' + dateStr + '</b></div>' +
            '</div>' +
          '</div>' +

          '<div class="pr-banner">' +
            '<div class="pr-banner-left">' +
              '<div class="pr-investor-title">Goal Plan &amp; Risk Profile for <strong>' + investorName + '</strong></div>' +
              '<div class="pr-investor-sub">' + (cd.email ? escHtml(cd.email) + ' · ' : '') + (cd.phone ? '+91 ' + escHtml(fmtPhone(cd.phone)) + ' · ' : '') + 'Goal: <strong>' + escHtml(goal ? goal.name : 'Wealth Creation') + '</strong></div>' +
            '</div>' +
            '<div class="pr-banner-badges">' +
              '<span class="pr-style-pill ' + state.style + '"><span class="pr-dot"></span>' + s.name + ' Style</span>' +
              '<span class="pr-goal-pill">Target: <b>' + fmtShort(d.target) + '</b> in <b>' + d.years + (d.years === 1 ? ' yr' : ' yrs') + '</b></span>' +
            '</div>' +
          '</div>' +

          '<div class="pr-kpi-grid">' +
            '<div class="pr-kpi highlight">' +
              '<span class="k">Monthly SIP Required</span>' +
              '<span class="v big">' + fmtINR(plan.sip) + '<small> / month</small></span>' +
              '<span class="sub-tag">Disciplined wealth accumulation</span>' +
            '</div>' +
            '<div class="pr-kpi">' +
              '<span class="k">Your Total Investment</span>' +
              '<span class="v">' + fmtINR(plan.invested) + '</span>' +
              '<span class="sub-tag">' + investPct + '% of target capital</span>' +
            '</div>' +
            '<div class="pr-kpi growth">' +
              '<span class="k">Estimated Growth</span>' +
              '<span class="v">' + fmtINR(plan.growth) + '</span>' +
              '<span class="sub-tag">' + growthPct + '% compounded gain</span>' +
            '</div>' +
            '<div class="pr-kpi">' +
              '<span class="k">One-Time Lumpsum Today</span>' +
              '<span class="v">' + fmtINR(plan.lumpsum) + '</span>' +
              '<span class="sub-tag">Assumed return ' + curRet() + '% p.a.</span>' +
            '</div>' +
          '</div>' +

          '<div class="pr-card" style="padding:10px 14px 12px;">' +
            '<div style="display:flex;justify-content:space-between;font-size:12px;font-weight:700;margin-bottom:6px;">' +
              '<span>Visual Wealth Compounding: Target ' + fmtINR(d.target) + '</span>' +
              '<span style="color:#0C6B4F;">Growth Multiplier: ' + ((d.target / plan.invested)).toFixed(2) + 'x of invested money</span>' +
            '</div>' +
            '<div class="pr-wealth-track">' +
              '<div class="seg-inv" style="width:' + investPct + '%;" title="You Invest"></div>' +
              '<div class="seg-gro" style="width:' + growthPct + '%;" title="Market Compounding"></div>' +
            '</div>' +
            '<div class="pr-wealth-legend">' +
              '<span><i style="background:#0C6B4F;"></i>You Invest: <b>' + fmtINR(plan.invested) + ' (' + investPct + '%)</b></span>' +
              '<span><i style="background:#27AE60;"></i>Estimated Compounded Growth: <b>' + fmtINR(plan.growth) + ' (' + growthPct + '%)</b></span>' +
            '</div>' +
          '</div>' +

          '<div class="pr-card">' +
            '<div class="pr-card-header">' +
              '<h3>Strategic Asset Allocation (' + s.name + ' Mix)</h3>' +
              '<span class="pr-badge">Balanced for ' + d.years + ' Year Horizon</span>' +
            '</div>' +
            '<div class="pr-alloc-body">' +
              '<div class="pr-donut-col">' +
                donutSVG +
                '<div class="pr-donut-lbl"><strong>' + curAlloc().equity + '%</strong><small>in Equity</small></div>' +
              '</div>' +
              '<div class="pr-bars-col">' +
                assetBarsHTML +
              '</div>' +
            '</div>' +
          '</div>' +

          '<div class="pr-card">' +
            '<div class="pr-card-header">' +
              '<h3>Curated Scheme Portfolio — FH Recommended List</h3>' +
              '<span class="pr-badge">Regular Plan · Growth · Daily AMFI Tracking</span>' +
            '</div>' +
            '<div class="pr-funds-list">' +
              fundCardsHTML +
            '</div>' +
          '</div>' +

          '<div class="pr-card pr-backtest-card">' +
            '<div class="pr-card-header">' +
              '<h3>Visual Portfolio Backtest — Simulated Past Performance</h3>' +
              '<span class="pr-badge green">' + bt.start + ' to ' + bt.end + '</span>' +
            '</div>' +
            '<div class="pr-bt-metrics">' +
              '<div class="pr-bt-box"><span class="k">1Y Return</span><span class="v">' + bt1Y + '</span></div>' +
              '<div class="pr-bt-box"><span class="k">3Y CAGR</span><span class="v pos">' + bt3Y + '</span></div>' +
              '<div class="pr-bt-box"><span class="k">5Y CAGR</span><span class="v pos">' + bt5Y + '</span></div>' +
              '<div class="pr-bt-box highlight"><span class="k">All-Time CAGR</span><span class="v pos big">' + btAllCagr + '</span></div>' +
              '<div class="pr-bt-box highlight"><span class="k">₹100 Invested Grew To</span><span class="v big">₹' + Math.round(btLastVal) + '</span><span class="pr-mult-tag">' + btMultiplier + '</span></div>' +
              '<div class="pr-bt-box"><span class="k">Volatility (σ)</span><span class="v">' + btVol + '</span></div>' +
              '<div class="pr-bt-box"><span class="k">Max Drawdown</span><span class="v neg">' + btMaxDd + '</span></div>' +
            '</div>' +
            '<div class="pr-bt-chart-wrap">' +
              '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;font-size:11px;font-weight:700;color:#5C6B63;">' +
                '<span>Simulated Growth of ₹100 Over Time (' + bt.start + ' → ' + bt.end + ')</span>' +
                '<span style="color:#0C6B4F;">Rebalanced periodically on daily AMFI NAVs</span>' +
              '</div>' +
              btSVG +
            '</div>' +
          '</div>' +

          pmsHTML +

          '<div class="pr-card" style="margin-top:12px;">' +
            '<div class="pr-card-header">' +
              '<h3>Protection &amp; Risk Preparedness Checks</h3>' +
              '<span class="pr-badge">Essential Foundation</span>' +
            '</div>' +
            '<div class="pr-protect-grid">' +
              '<div class="pr-protect-box">' +
                '<div class="pr-prot-top"><strong>Emergency Reserve</strong>' + protBadge("emergency") + '</div>' +
                '<p>6 months living expenses parked in liquid buffer to safeguard investments during unexpected events.</p>' +
              '</div>' +
              '<div class="pr-protect-box">' +
                '<div class="pr-prot-top"><strong>Term Life Cover</strong>' + protBadge("term") + '</div>' +
                '<p>Pure life cover protecting family goals (10–15× annual household earnings recommended).</p>' +
              '</div>' +
              '<div class="pr-protect-box">' +
                '<div class="pr-prot-top"><strong>Comprehensive Health</strong>' + protBadge("health") + '</div>' +
                '<p>Independent health insurance shielding goal capital from medical inflation and hospital claims.</p>' +
              '</div>' +
            '</div>' +
          '</div>' +

          '<div class="pr-footer">' +
            '<div class="pr-foot-disc">' +
              '<strong>Regulatory Disclosures:</strong> Mutual fund investments are subject to market risks, read all scheme related documents carefully. Past performance does not indicate future returns. Fund Horizon is an AMFI Registered Mutual Fund Distributor · ARN 345439. Historical portfolio backtest simulations use actual scheme NAVs rebalanced periodically for educational and planning illustration only; this document does not constitute an investment offer or recommendation.' +
            '</div>' +
            '<div class="pr-foot-sign">' +
              '<div class="pr-foot-brand">Fund Horizon</div>' +
              '<div>AMFI Registered Mutual Fund Distributor · ARN 345439</div>' +
              '<div>Kharghar, Navi Mumbai · www.fundhorizon.website</div>' +
            '</div>' +
          '</div>' +

        '</div>';

        document.getElementById("printReport").innerHTML = html;
      }

      document.getElementById("downloadPdfBtn").addEventListener("click", function(){
        var v = validateDetails(true);
        var cOk = validateConsent(true);
        if (!v.ok || !cOk) { scrollToDetails(); return; }
        recordLead(null, v.data.email).catch(function () {}); // best effort: the print dialog must still open
        window.addEventListener("afterprint", function once() { window.removeEventListener("afterprint", once); showThanks(); });
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
        $("assumptionText").innerHTML = "Assumed return for <strong>" + s.name + ": " + curRet() + "% a year</strong>. Assumed, not assured — real returns move up and down.";

        countUp($("sipValue"), plan.sip, fmtINR);
        countUp($("investedValue"), plan.invested, fmtINR);
        countUp($("growthValue"), plan.growth, fmtINR);
        countUp($("lumpsumValue"), plan.lumpsum, fmtINR);

        renderDonut();
        renderNudges(plan);
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

      /* ================= Save lead, email PDF, thank-you ================= */
      var recorded = false;
      var ROUTE_SHORT = { mf: "Mutual Funds only", mix: "Mutual Funds + PMS mix", pms: "PMS only (enquiry)" };
      function planFacts() {
        var s = STYLES[state.style], goal = GOALS.filter(function (g) { return g.id === state.goal; })[0];
        return { s: s, goal: goal ? goal.name : "—", plan: calcPlan(), route: ROUTE_SHORT[pmsState.route] || ROUTE_SHORT.mf };
      }
      function recordLead(pdfB64, email) {
        var cd = contactData(), f = planFacts();
        var body = {
          name: cd.name, email: email || cd.email, phone: cd.phone, consent: true, recorded: recorded,
          ref: new URLSearchParams(window.location.search).get("ref") || undefined, pdf_base64: pdfB64 || undefined,
          plan: { Style: f.s.name, Goal: f.goal, Target: fmtShort(state.target), Years: String(state.years), "Monthly SIP": fmtINR(f.plan.sip), Route: f.route }
        };
        return fetch(resolveApiUrl(API_URL + "/api/crm/public/plan-lead"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
          .then(function (r) {
            if (!r.ok) return r.json().catch(function () { return {}; }).then(function (j) { throw new Error(typeof j.detail === "string" ? j.detail : "Request failed (" + r.status + ")"); });
            recorded = true; return r.json();
          });
      }
      function planPdfB64() {
        var f = planFacts(), cd = contactData(), s = f.s, years = [], inv, val, r = curRet() / 1200;
        for (var y = 0; y <= state.years; y++) {
          inv = f.plan.sip * 12 * y; val = r === 0 ? inv : f.plan.sip * ((Math.pow(1 + r, 12 * y) - 1) / r) * (1 + r);
          years.push({ x: y, a: inv, b: Math.max(val - inv, 0) });
        }
        return renderCard({
          title: "Your plan at a glance", client: cd.name,
          inputs: [["Style", s.name], ["Goal", f.goal], ["Target", fmtShort(state.target)], ["Time", state.years + " years"], ["Assumed return", curRet() + "% a year"], ["Route", f.route]],
          metrics: [{ label: "Monthly SIP needed", text: fmtINR(f.plan.sip) + " / month" }, { label: "You invest", text: fmtINR(f.plan.invested) }, { label: "Growth (market gains)", text: fmtINR(f.plan.growth) }, { label: "Or one-time lumpsum today", text: fmtINR(f.plan.lumpsum) }],
          viz: { donutTitle: "How your money is split", donut: ASSETS.map(function (a) { return { name: a.label, value: curAlloc()[a.key] }; }), growth: { kind: "stack", title: "Year-by-year growth", names: ["Invested", "Growth"], pts: years } }
        }).then(pdfBlob).then(function (blob) {
          return new Promise(function (res, rej) { var fr = new FileReader(); fr.onload = function () { res(String(fr.result).split(",")[1]); }; fr.onerror = rej; fr.readAsDataURL(blob); });
        });
      }
      function showThanks() {
        var cd = contactData();
        $("thanksName").textContent = cd.name.split(/\s+/)[0];
        $("thanksPhone").textContent = fmtPhone(cd.phone);
        $("thanksOverlay").classList.add("show");
        document.body.style.overflow = "hidden";
      }
      $("thanksCloseBtn").addEventListener("click", function () { window.close(); $("thanksHint").style.display = "block"; });
      $("thanksNewBtn").addEventListener("click", function () {
        $("thanksOverlay").classList.remove("show"); $("thanksHint").style.display = "none";
        document.body.style.overflow = ""; recorded = false; $("emailPdfTo").value = ""; $("emailPdfMsg").textContent = "";
        $("startOverBtn").click();
      });
      $("emailPdfBtn").addEventListener("click", function () {
        var btn = this, msg = $("emailPdfMsg"), v = validateDetails(true), cOk = validateConsent(true);
        var to = ($("emailPdfTo").value || "").trim() || v.data.email;
        msg.classList.remove("bad");
        if (!v.ok || !cOk) { scrollToDetails(); return; }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(to)) { msg.textContent = "Please enter a valid email ID."; msg.classList.add("bad"); return; }
        btn.disabled = true; msg.textContent = "Preparing and sending your PDF…";
        planPdfB64().then(function (b64) { return recordLead(b64, to); }).then(function (res) {
          if (!res.emailed) throw new Error("We could not send the email right now. Please use Download PDF report.");
          msg.textContent = "Sent to " + to + ".";
          showThanks();
        }).catch(function (e) { msg.textContent = e && e.message ? e.message : "Something went wrong. Please try again."; msg.classList.add("bad"); })
          .then(function () { btn.disabled = false; });
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
        recordLead(null, v.data.email).catch(function () {});
        box.scrollIntoView({ behavior: "smooth", block: "center" });
      });
      $("startOverBtn").addEventListener("click", function () {
        state.style = null; state.goal = "education"; state.target = 2500000; state.years = 10; state.excluded = [];
        pmsState = { route: "mf", corpus: 10000000, pmsPct: 30, sel: ["abakkus"], splitFirst: 50 }; lastPmsStyle = null;
        var seeAllPmsEl = $("seeAllPms"); if (seeAllPmsEl) seeAllPmsEl.classList.remove("open");
        var sapBtn = $("seeAllPmsBtn"); if (sapBtn) sapBtn.textContent = "See all PMS on FH list";
        var snEl = $("secondStratNote"); if (snEl) snEl.classList.remove("show");
        protectState = { emergency: null, term: null, health: null };
        ["cdName","cdEmail","cdPhone"].forEach(function (id) { var el = $(id); el.value = ""; el.classList.remove("invalid"); });
        ["errName","errEmail","errPhone","errConsent"].forEach(function (id) { $(id).classList.remove("show"); });
        $("cdConsent").checked = false; $("consentRow").classList.remove("bad");
        $("talkSuccess").classList.remove("show");
        recorded = false;
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
