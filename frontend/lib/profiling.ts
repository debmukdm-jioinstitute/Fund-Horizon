export interface ClientCapacityInputs {
  firstName: string;
  age: number;
  employmentType: "govt_psu" | "salaried_private" | "business_professional" | "freelance_variable" | "retired_none";
  dependents: number;
  monthlyIncome: number;
  monthlyExpenses: number;
  monthlyEmi: number;
  liquidAssets: number;
  investments: number;
  liabilities: number;
  termCover: number;
  healthCover: number;
  retirementAge: number;
}

export interface FactorScore {
  factor: string;
  weight: number;
  value: string | number;
  score: number;
  contribution: number;
}

export interface RiskProfileResult {
  capacity: {
    score: number;
    factors: FactorScore[];
    emergency_months: number;
  };
  tolerance: number;
  final_score: number;
  band: string;
  mismatch_note: string | null;
  priority_actions: string[];
  notes: string[];
  allocation: {
    name: string;
    equity: number;
    debt: number;
    gold: number;
    liquid: number;
  };
}

export const QUESTIONNAIRE_QUESTIONS = [
  {
    id: "q1",
    text: "Your investing experience",
    options: [
      { text: "None", score: 1 },
      { text: "Only FDs and savings", score: 2 },
      { text: "Mutual funds for less than 3 years", score: 3 },
      { text: "Mutual funds and stocks for more than 3 years", score: 4 },
      { text: "Derivatives or advanced products", score: 5 },
    ],
  },
  {
    id: "q2",
    text: "Your main objective",
    options: [
      { text: "Protect capital", score: 1 },
      { text: "Regular income", score: 2 },
      { text: "Balanced growth", score: 3 },
      { text: "Long-term growth", score: 4 },
      { text: "Maximise returns", score: 5 },
    ],
  },
  {
    id: "q3",
    text: "Your portfolio falls 20% in 3 months. You:",
    options: [
      { text: "Sell everything", score: 1 },
      { text: "Sell some", score: 2 },
      { text: "Do nothing", score: 3 },
      { text: "Invest a little more", score: 4 },
      { text: "Invest significantly more", score: 5 },
    ],
  },
  {
    id: "q4",
    text: "Largest one-year loss you could accept",
    options: [
      { text: "0%", score: 1 },
      { text: "Up to 5%", score: 2 },
      { text: "Up to 10%", score: 3 },
      { text: "Up to 20%", score: 4 },
      { text: "30% or more", score: 5 },
    ],
  },
  {
    id: "q5",
    text: "Which one would you pick?",
    options: [
      { text: "Certain +6%", score: 1 },
      { text: "50% chance of +12%, 50% chance of 0%", score: 2 },
      { text: "50% chance of +18%, 50% chance of -6%", score: 4 },
      { text: "50% chance of +25%, 50% chance of -12%", score: 5 },
    ],
  },
  {
    id: "q6",
    text: "In a past market crash (for example 2020) you:",
    options: [
      { text: "Panic-sold", score: 1 },
      { text: "Stopped SIPs", score: 2 },
      { text: "Was not invested", score: 3 },
      { text: "Continued SIPs", score: 4 },
      { text: "Invested more", score: 5 },
    ],
  },
  {
    id: "q7",
    text: "How much would portfolio swings affect your sleep?",
    options: [
      { text: "A great deal", score: 1 },
      { text: "Quite a lot", score: 2 },
      { text: "Somewhat", score: 3 },
      { text: "Little", score: 4 },
      { text: "Not at all", score: 5 },
    ],
  },
  {
    id: "q8",
    text: "Return you expect per year",
    options: [
      { text: "5-6%", score: 1 },
      { text: "7-8%", score: 2 },
      { text: "9-11%", score: 3 },
      { text: "12-14%", score: 4 },
      { text: "15% or more", score: 5 },
    ],
  },
  {
    id: "q9",
    text: "Which is true of a diversified equity fund?",
    options: [
      { text: "Returns are fixed", score: 1 },
      { text: "It can lose money for 1-2 years but usually recovers over long periods", score: 5 },
      { text: "It cannot lose money over 3 years", score: 1 },
      { text: "Not sure", score: 2 },
    ],
  },
  {
    id: "q10",
    text: "Markets rise 30% in 6 months. You:",
    options: [
      { text: "Book all profit", score: 1 },
      { text: "Book most", score: 2 },
      { text: "Hold", score: 3 },
      { text: "Add a little", score: 4 },
      { text: "Add significantly", score: 5 },
    ],
  },
];

export const BANDS = [
  { name: "Conservative", min: 0, max: 20, equity: 15, debt: 65, gold: 5, liquid: 15, color: "text-blue-700 bg-blue-50 border-blue-200" },
  { name: "Moderately Conservative", min: 20, max: 40, equity: 30, debt: 52, gold: 8, liquid: 10, color: "text-cyan-700 bg-cyan-50 border-cyan-200" },
  { name: "Moderate", min: 40, max: 60, equity: 50, debt: 33, gold: 10, liquid: 7, color: "text-teal-700 bg-teal-50 border-teal-200" },
  { name: "Moderately Aggressive", min: 60, max: 80, equity: 70, debt: 18, gold: 8, liquid: 4, color: "text-amber-700 bg-amber-50 border-amber-200" },
  { name: "Aggressive", min: 80, max: 100, equity: 85, debt: 7, gold: 6, liquid: 2, color: "text-rose-700 bg-rose-50 border-rose-200" },
];

export function getBandForScore(score: number) {
  for (const b of BANDS) {
    if (score >= b.min && score < b.max) return b;
  }
  return BANDS[BANDS.length - 1];
}

export function computeClientProfileLocally(
  c: ClientCapacityInputs,
  answers: Record<string, number>
): RiskProfileResult {
  const outgo = c.monthlyExpenses + c.monthlyEmi;
  const nw = c.liquidAssets + c.investments - c.liabilities;
  const savingsRate = c.monthlyIncome > 0 ? (c.monthlyIncome - outgo) / c.monthlyIncome : 0;
  const nwMultiple = c.monthlyIncome > 0 ? nw / (12 * c.monthlyIncome) : 0;
  const debtBurden = c.monthlyIncome > 0 ? c.monthlyEmi / c.monthlyIncome : 0;
  const efMonths = outgo > 0 ? c.liquidAssets / outgo : 99;

  // Age score
  let ageScore = 20;
  if (c.age <= 30) ageScore = 100;
  else if (c.age <= 40) ageScore = 85;
  else if (c.age <= 50) ageScore = 65;
  else if (c.age <= 60) ageScore = 40;

  // Income stability score
  const stabilityScores: Record<string, number> = {
    govt_psu: 100,
    salaried_private: 75,
    business_professional: 55,
    freelance_variable: 45,
    retired_none: 25,
  };
  const stabScore = stabilityScores[c.employmentType] ?? 50;

  // Dependents score
  const depScore = c.dependents === 0 ? 100 : c.dependents === 1 ? 80 : c.dependents === 2 ? 60 : c.dependents === 3 ? 40 : 25;

  // Savings rate score
  let srScore = 10;
  if (savingsRate >= 0.40) srScore = 100;
  else if (savingsRate >= 0.30) srScore = 85;
  else if (savingsRate >= 0.20) srScore = 70;
  else if (savingsRate >= 0.10) srScore = 50;
  else if (savingsRate >= 0.0) srScore = 30;

  // Emergency fund score
  let efScore = 10;
  if (efMonths >= 12) efScore = 100;
  else if (efMonths >= 6) efScore = 85;
  else if (efMonths >= 3) efScore = 55;
  else if (efMonths >= 1) efScore = 30;

  // Net worth multiple score
  let nwScore = 10;
  if (nwMultiple >= 5) nwScore = 100;
  else if (nwMultiple >= 3) nwScore = 80;
  else if (nwMultiple >= 1) nwScore = 55;
  else if (nwMultiple >= 0) nwScore = 35;

  // Debt burden score
  let dbScore = 10;
  if (debtBurden < 0.10) dbScore = 100;
  else if (debtBurden < 0.20) dbScore = 80;
  else if (debtBurden < 0.35) dbScore = 55;
  else if (debtBurden < 0.50) dbScore = 30;

  // Insurance score: simplified threshold (annual income * 10)
  const termNeedEst = Math.max(0, c.monthlyIncome * 12 * Math.max(1, c.retirementAge - c.age) * 0.7);
  const termOk = c.termCover >= 0.7 * termNeedEst;
  const healthOk = c.healthCover > 0;
  const insScore = termOk && healthOk ? 100 : termOk || healthOk ? 60 : 20;

  const factors: FactorScore[] = [
    { factor: "Age", weight: 0.20, value: c.age, score: ageScore, contribution: Number((ageScore * 0.20).toFixed(2)) },
    { factor: "Income stability", weight: 0.15, value: c.employmentType, score: stabScore, contribution: Number((stabScore * 0.15).toFixed(2)) },
    { factor: "Savings rate", weight: 0.15, value: `${(savingsRate * 100).toFixed(1)}%`, score: srScore, contribution: Number((srScore * 0.15).toFixed(2)) },
    { factor: "Emergency fund", weight: 0.15, value: `${efMonths.toFixed(1)} mos`, score: efScore, contribution: Number((efScore * 0.15).toFixed(2)) },
    { factor: "Dependents", weight: 0.10, value: c.dependents, score: depScore, contribution: Number((depScore * 0.10).toFixed(2)) },
    { factor: "Net worth", weight: 0.10, value: `${nwMultiple.toFixed(1)}×`, score: nwScore, contribution: Number((nwScore * 0.10).toFixed(2)) },
    { factor: "Debt burden", weight: 0.10, value: `${(debtBurden * 100).toFixed(1)}%`, score: dbScore, contribution: Number((dbScore * 0.10).toFixed(2)) },
    { factor: "Insurance", weight: 0.05, value: termOk ? "Adequate" : "Shortfall", score: insScore, contribution: Number((insScore * 0.05).toFixed(2)) },
  ];

  const capacityScore = Number(factors.reduce((sum, f) => sum + f.contribution, 0).toFixed(1));

  // Compute tolerance from questionnaire
  let totalTolerancePoints = 0;
  const minPossible = 10;
  const maxPossible = 50;
  for (let i = 0; i < QUESTIONNAIRE_QUESTIONS.length; i++) {
    const q = QUESTIONNAIRE_QUESTIONS[i];
    const chosenIdx = answers[q.id] ?? 2;
    const opt = q.options[chosenIdx] || q.options[0];
    totalTolerancePoints += opt.score;
  }
  const toleranceScore = Number((((totalTolerancePoints - minPossible) / (maxPossible - minPossible)) * 100).toFixed(1));

  const finalScore = Number(Math.min(capacityScore, toleranceScore).toFixed(1));
  const band = getBandForScore(finalScore);

  const priorityActions: string[] = [];
  if (efMonths < 6) priorityActions.push("Build emergency fund to at least 6 months of expenses");
  if (!termOk) priorityActions.push("Bridge term life insurance cover shortfall");
  if (!healthOk) priorityActions.push("Procure dedicated health insurance cover");

  let mismatchNote: string | null = null;
  if (toleranceScore - capacityScore >= 25) {
    mismatchNote = `High risk appetite (${toleranceScore}) exceeds objective financial capacity (${capacityScore}) by ${Number((toleranceScore - capacityScore).toFixed(1))} points. Risk band capped at capacity to protect capital.`;
  }

  return {
    capacity: {
      score: capacityScore,
      factors,
      emergency_months: efMonths,
    },
    tolerance: toleranceScore,
    final_score: finalScore,
    band: band.name,
    mismatch_note: mismatchNote,
    priority_actions: priorityActions,
    notes: [],
    allocation: band,
  };
}

export const PROFILING_PRESETS: { name: string; icon: string; desc: string; client: ClientCapacityInputs; answers: Record<string, number> }[] = [
  {
    name: "Young Tech Professional",
    icon: "⚡",
    desc: "Age 28, tech employee, high savings rate, strong risk appetite",
    client: {
      firstName: "Arjun",
      age: 28,
      employmentType: "salaried_private",
      dependents: 0,
      monthlyIncome: 220000,
      monthlyExpenses: 65000,
      monthlyEmi: 0,
      liquidAssets: 600000,
      investments: 1400000,
      liabilities: 0,
      termCover: 25000000,
      healthCover: 1500000,
      retirementAge: 60,
    },
    answers: { q1: 3, q2: 4, q3: 3, q4: 3, q5: 2, q6: 3, q7: 3, q8: 3, q9: 1, q10: 3 },
  },
  {
    name: "Balanced Family Wealth",
    icon: "⚖️",
    desc: "Age 42, 2 school-going children, home loan EMI, balanced objectives",
    client: {
      firstName: "Vikram & Neha",
      age: 42,
      employmentType: "salaried_private",
      dependents: 2,
      monthlyIncome: 280000,
      monthlyExpenses: 110000,
      monthlyEmi: 48000,
      liquidAssets: 950000,
      investments: 3500000,
      liabilities: 3200000,
      termCover: 30000000,
      healthCover: 2000000,
      retirementAge: 60,
    },
    answers: { q1: 2, q2: 2, q3: 2, q4: 2, q5: 1, q6: 3, q7: 2, q8: 2, q9: 1, q10: 2 },
  },
  {
    name: "Conservative Pre-Retiree",
    icon: "🛡️",
    desc: "Age 57, Govt/PSU officer, debt-free, capital preservation priority",
    client: {
      firstName: "Suresh Rao",
      age: 57,
      employmentType: "govt_psu",
      dependents: 1,
      monthlyIncome: 180000,
      monthlyExpenses: 70000,
      monthlyEmi: 0,
      liquidAssets: 1800000,
      investments: 8500000,
      liabilities: 0,
      termCover: 0,
      healthCover: 1000000,
      retirementAge: 60,
    },
    answers: { q1: 1, q2: 0, q3: 1, q4: 1, q5: 0, q6: 1, q7: 1, q8: 1, q9: 1, q10: 1 },
  },
  {
    name: "High Net-Worth Entrepreneur",
    icon: "💼",
    desc: "Age 46, business owner, substantial investments, variable income",
    client: {
      firstName: "Rajesh Singhania",
      age: 46,
      employmentType: "business_professional",
      dependents: 3,
      monthlyIncome: 650000,
      monthlyExpenses: 200000,
      monthlyEmi: 85000,
      liquidAssets: 3500000,
      investments: 18000000,
      liabilities: 4500000,
      termCover: 50000000,
      healthCover: 2500000,
      retirementAge: 65,
    },
    answers: { q1: 3, q2: 3, q3: 3, q4: 3, q5: 3, q6: 4, q7: 4, q8: 4, q9: 1, q10: 4 },
  },
];
