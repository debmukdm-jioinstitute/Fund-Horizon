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
      { text: "50% chance of +15%, 50% chance of -3%", score: 3 },
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
      { text: "It cannot lose money over 3 years", score: 2 },
      { text: "Not sure", score: 3 },
      { text: "Principal is protected with small market upside", score: 4 },
      { text: "It can lose money for 1-2 years but usually recovers over long periods", score: 5 },
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

export const MISMATCH_THRESHOLD_POINTS = 20;

export const BANDS = [
  { name: "Conservative", min: 0, max: 20, equity: 15, debt: 65, gold: 5, liquid: 15, color: "text-blue-700 bg-blue-50 border-blue-200" },
  { name: "Moderately Conservative", min: 20, max: 40, equity: 30, debt: 52, gold: 8, liquid: 10, color: "text-cyan-700 bg-cyan-50 border-cyan-200" },
  { name: "Moderate", min: 40, max: 60, equity: 50, debt: 33, gold: 10, liquid: 7, color: "text-teal-700 bg-teal-50 border-teal-200" },
  { name: "Moderately Aggressive", min: 60, max: 80, equity: 70, debt: 18, gold: 8, liquid: 4, color: "text-amber-700 bg-amber-50 border-amber-200" },
  { name: "Aggressive", min: 80, max: 100, equity: 85, debt: 7, gold: 6, liquid: 2, color: "text-rose-700 bg-rose-50 border-rose-200" },
];

export function getBandForScore(score: number) {
  for (let i = 0; i < BANDS.length; i++) {
    const b = BANDS[i];
    if (i === BANDS.length - 1) {
      if (score >= b.min && score <= b.max) return b;
    } else {
      if (score >= b.min && score < b.max) return b;
    }
  }
  return score <= 0 ? BANDS[0] : BANDS[BANDS.length - 1];
}

export function computeClientProfileLocally(
  c: ClientCapacityInputs,
  answers: Record<string, number>
): RiskProfileResult {
  const isClientValid =
    c.firstName.trim().length >= 3 &&
    c.firstName.trim().length <= 100 &&
    c.age >= 18 &&
    c.age <= 100 &&
    c.dependents >= 0 &&
    c.dependents <= 15 &&
    c.monthlyIncome > 0 &&
    Boolean(c.employmentType);

  const outgo = c.monthlyExpenses + c.monthlyEmi;
  const nw = c.liquidAssets + c.investments - c.liabilities;
  const savingsRate = c.monthlyIncome > 0 ? (c.monthlyIncome - outgo) / c.monthlyIncome : 0;
  const nwMultiple = c.monthlyIncome > 0 ? nw / (12 * c.monthlyIncome) : 0;
  const debtBurden = c.monthlyIncome > 0 ? c.monthlyEmi / c.monthlyIncome : 0;
  const efMonths = outgo > 0 ? c.liquidAssets / outgo : (c.liquidAssets > 0 ? 99 : 0);

  // Age score (0 if unentered / invalid)
  let ageScore = 0;
  if (c.age >= 18 && c.age <= 30) ageScore = 100;
  else if (c.age > 30 && c.age <= 40) ageScore = 85;
  else if (c.age > 40 && c.age <= 50) ageScore = 65;
  else if (c.age > 50 && c.age <= 60) ageScore = 40;
  else if (c.age > 60 && c.age <= 100) ageScore = 20;

  // Income stability score (0 if empty)
  const stabilityScores: Record<string, number> = {
    govt_psu: 100,
    salaried_private: 75,
    business_professional: 55,
    freelance_variable: 45,
    retired_none: 25,
  };
  const stabScore = c.employmentType ? (stabilityScores[c.employmentType] ?? 0) : 0;

  // Dependents score (0 if invalid negative)
  let depScore = 0;
  if (c.dependents >= 0 && c.dependents <= 15) {
    depScore = c.dependents === 0 ? 100 : c.dependents === 1 ? 80 : c.dependents === 2 ? 60 : c.dependents === 3 ? 40 : 25;
  }

  // Savings rate score
  let srScore = 0;
  if (c.monthlyIncome > 0) {
    if (savingsRate >= 0.40) srScore = 100;
    else if (savingsRate >= 0.30) srScore = 85;
    else if (savingsRate >= 0.20) srScore = 70;
    else if (savingsRate >= 0.10) srScore = 50;
    else if (savingsRate >= 0.0) srScore = 30;
    else srScore = 10;
  }

  // Emergency fund score: min 10 per doc rule
  let efScore = 10;
  if (efMonths >= 12) efScore = 100;
  else if (efMonths >= 6) efScore = 85;
  else if (efMonths >= 3) efScore = 55;
  else if (efMonths >= 1) efScore = 30;
  else efScore = 10;

  // Net worth multiple score
  let nwScore = 0;
  if (c.monthlyIncome > 0) {
    if (nwMultiple >= 5) nwScore = 100;
    else if (nwMultiple >= 3) nwScore = 80;
    else if (nwMultiple >= 1) nwScore = 55;
    else if (nwMultiple >= 0) nwScore = 35;
    else nwScore = 10;
  }

  // Debt burden score
  let dbScore = 0;
  if (c.monthlyIncome > 0) {
    if (debtBurden < 0.10) dbScore = 100;
    else if (debtBurden < 0.20) dbScore = 80;
    else if (debtBurden < 0.35) dbScore = 55;
    else if (debtBurden < 0.50) dbScore = 30;
    else dbScore = 10;
  }

  // Insurance score: Two explicit sub-scores (Term adequacy + Health cover) per Fix 6
  const annualIncome = c.monthlyIncome * 12;
  const termMultiple = annualIncome > 0 ? c.termCover / annualIncome : (c.termCover > 0 ? 15 : 0);
  let termSubScore = 20;
  if (termMultiple >= 15.0) termSubScore = 100;
  else if (termMultiple >= 10.0) termSubScore = 80;
  else if (termMultiple >= 7.0) termSubScore = 60;
  else if (termMultiple >= 5.0) termSubScore = 40;
  else termSubScore = 20;

  let healthSubScore = 20;
  if (c.healthCover >= 2500000) healthSubScore = 100;
  else if (c.healthCover >= 1000000) healthSubScore = 60;
  else healthSubScore = 20;

  const insScore = Math.round((termSubScore + healthSubScore) / 2);

  const factors: FactorScore[] = [
    { factor: "Age", weight: 0.20, value: c.age || "—", score: ageScore, contribution: Number((ageScore * 0.20).toFixed(2)) },
    { factor: "Income stability", weight: 0.15, value: c.employmentType || "—", score: stabScore, contribution: Number((stabScore * 0.15).toFixed(2)) },
    { factor: "Savings rate", weight: 0.15, value: c.monthlyIncome > 0 ? `${(savingsRate * 100).toFixed(1)}%` : "—", score: srScore, contribution: Number((srScore * 0.15).toFixed(2)) },
    { factor: "Emergency fund", weight: 0.15, value: `${efMonths.toFixed(1)} mos`, score: efScore, contribution: Number((efScore * 0.15).toFixed(2)) },
    { factor: "Dependents", weight: 0.10, value: c.dependents < 0 ? "Invalid" : c.dependents, score: depScore, contribution: Number((depScore * 0.10).toFixed(2)) },
    { factor: "Net worth", weight: 0.10, value: c.monthlyIncome > 0 ? `${nwMultiple.toFixed(1)}×` : "—", score: nwScore, contribution: Number((nwScore * 0.10).toFixed(2)) },
    { factor: "Debt burden", weight: 0.10, value: c.monthlyIncome > 0 ? `${(debtBurden * 100).toFixed(1)}%` : "—", score: dbScore, contribution: Number((dbScore * 0.10).toFixed(2)) },
    { factor: "Insurance", weight: 0.05, value: termSubScore === 100 && healthSubScore === 100 ? "Adequate" : `${termMultiple.toFixed(1)}× inc`, score: insScore, contribution: Number((insScore * 0.05).toFixed(2)) },
  ];

  const capacityScore = isClientValid ? Number(factors.reduce((sum, f) => sum + f.contribution, 0).toFixed(1)) : 0;

  // Compute tolerance strictly from answered questions — no invisible defaults
  let totalTolerancePoints = 0;
  let answeredCount = 0;
  for (let i = 0; i < QUESTIONNAIRE_QUESTIONS.length; i++) {
    const q = QUESTIONNAIRE_QUESTIONS[i];
    if (answers[q.id] !== undefined) {
      const chosenIdx = answers[q.id];
      const opt = q.options[chosenIdx];
      if (opt) {
        totalTolerancePoints += opt.score;
        answeredCount++;
      }
    }
  }

  const isQuestionnaireComplete = answeredCount === QUESTIONNAIRE_QUESTIONS.length;
  // Raw min 10 -> 0%, Raw max 50 -> 100% (Tolerance = (raw - 10) * 2.5)
  const toleranceScore = isQuestionnaireComplete
    ? Number(((totalTolerancePoints - 10) * 2.5).toFixed(1))
    : answeredCount > 0
    ? Number((((totalTolerancePoints - answeredCount) / (answeredCount * 4)) * 100).toFixed(1))
    : 0;

  const isComplete = isClientValid && isQuestionnaireComplete;
  const finalScore = isComplete ? Number(Math.min(capacityScore, toleranceScore).toFixed(1)) : 0;
  const band = isComplete
    ? getBandForScore(finalScore)
    : { name: "Pending Assessment", min: 0, max: 0, equity: 0, debt: 0, gold: 0, liquid: 0, color: "text-[#706E6B] bg-[#F3F3F3] border-[#ECEBEA]" };

  const priorityActions: string[] = [];
  if (isClientValid) {
    if (efMonths < 6) priorityActions.push("Build emergency fund to at least 6 months of expenses");
    if (termSubScore < 100) {
      priorityActions.push(`Bridge term life insurance cover shortfall (current: ${termMultiple.toFixed(1)}× income; target: 15×)`);
    }
    if (healthSubScore < 100) {
      priorityActions.push("Procure dedicated health insurance cover (target: ₹25L)");
    }
  }

  let mismatchNote: string | null = null;
  if (isComplete && toleranceScore - capacityScore >= MISMATCH_THRESHOLD_POINTS) {
    mismatchNote = `High risk appetite (${toleranceScore}) exceeds objective financial capacity (${capacityScore}) by ${Number((toleranceScore - capacityScore).toFixed(1))} points (threshold: ≥${MISMATCH_THRESHOLD_POINTS} pts). Risk band capped at capacity to protect capital.`;
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

/** Empty form: nothing is pre-filled; presets are an explicit choice. Zeros render as blank inputs. */
export const BLANK_CLIENT: ClientCapacityInputs = {
  firstName: "", age: 0, employmentType: "" as ClientCapacityInputs["employmentType"], dependents: 0,
  monthlyIncome: 0, monthlyExpenses: 0, monthlyEmi: 0, liquidAssets: 0, investments: 0, liabilities: 0,
  termCover: 0, healthCover: 0, retirementAge: 60,
};

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
    answers: { q1: 3, q2: 4, q3: 3, q4: 3, q5: 3, q6: 3, q7: 3, q8: 3, q9: 4, q10: 3 },
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
    answers: { q1: 2, q2: 2, q3: 2, q4: 2, q5: 1, q6: 3, q7: 2, q8: 2, q9: 4, q10: 2 },
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
    answers: { q1: 3, q2: 3, q3: 3, q4: 3, q5: 4, q6: 4, q7: 4, q8: 4, q9: 4, q10: 4 },
  },
];
