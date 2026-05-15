// ACTUS Calculation Engine - Real Financial Calculations

export interface PAMContract {
  id: string;
  type: 'PAM';
  counterparty: string;
  principal: number;
  rate: number; // Annual rate as percentage
  maturity: string; // ISO date string
  startDate: string;
  direction: 'receivable' | 'payable';
  riskScore: number;
}

export interface ANNContract {
  id: string;
  type: 'ANN';
  counterparty: string;
  loanAmount: number;
  rate: number; // Annual rate as percentage
  periods: number;
  frequency: 'monthly' | 'quarterly';
  startDate: string;
  direction: 'receivable' | 'payable';
  riskScore: number;
}

export type Contract = PAMContract | ANNContract;

export interface ScheduleEntry {
  date: string;
  period: number;
  principal: number;
  interest: number;
  payment: number;
  balance: number;
}

export interface CashFlowEntry {
  date: string;
  week: number;
  inflows: number;
  outflows: number;
  net: number;
  cumulative: number;
}

// PAM (Principal at Maturity) Calculator
// Interest paid quarterly, principal at maturity
export function calculatePAMSchedule(contract: PAMContract): ScheduleEntry[] {
  const schedule: ScheduleEntry[] = [];
  const startDate = new Date(contract.startDate);
  const maturityDate = new Date(contract.maturity);
  
  // Calculate number of quarters
  const msPerQuarter = 91.25 * 24 * 60 * 60 * 1000;
  const totalQuarters = Math.ceil((maturityDate.getTime() - startDate.getTime()) / msPerQuarter);
  
  const quarterlyRate = contract.rate / 100 / 4;
  const quarterlyInterest = contract.principal * quarterlyRate;
  
  let balance = contract.principal;
  
  for (let i = 1; i <= totalQuarters; i++) {
    const paymentDate = new Date(startDate);
    paymentDate.setMonth(paymentDate.getMonth() + i * 3);
    
    const isMaturity = i === totalQuarters;
    const principalPayment = isMaturity ? contract.principal : 0;
    const payment = quarterlyInterest + principalPayment;
    
    balance = isMaturity ? 0 : balance;
    
    schedule.push({
      date: paymentDate.toISOString().split('T')[0],
      period: i,
      principal: principalPayment,
      interest: quarterlyInterest,
      payment: payment,
      balance: balance,
    });
  }
  
  return schedule;
}

// ANN (Annuity) Calculator
// Equal installments with amortizing principal
export function calculateANNSchedule(contract: ANNContract): ScheduleEntry[] {
  const schedule: ScheduleEntry[] = [];
  const startDate = new Date(contract.startDate);
  
  const periodsPerYear = contract.frequency === 'monthly' ? 12 : 4;
  const periodicRate = contract.rate / 100 / periodsPerYear;
  const n = contract.periods;
  
  // PMT = P × [r(1+r)^n] / [(1+r)^n - 1]
  const pmt = contract.loanAmount * 
    (periodicRate * Math.pow(1 + periodicRate, n)) / 
    (Math.pow(1 + periodicRate, n) - 1);
  
  let balance = contract.loanAmount;
  
  for (let i = 1; i <= n; i++) {
    const interestPayment = balance * periodicRate;
    const principalPayment = pmt - interestPayment;
    balance = Math.max(0, balance - principalPayment);
    
    const paymentDate = new Date(startDate);
    if (contract.frequency === 'monthly') {
      paymentDate.setMonth(paymentDate.getMonth() + i);
    } else {
      paymentDate.setMonth(paymentDate.getMonth() + i * 3);
    }
    
    schedule.push({
      date: paymentDate.toISOString().split('T')[0],
      period: i,
      principal: principalPayment,
      interest: interestPayment,
      payment: pmt,
      balance: balance,
    });
  }
  
  return schedule;
}

// Net Cash Flow Calculator
export function calculateNetCashFlow(contracts: Contract[], weeks: number = 12, startDate?: string): CashFlowEntry[] {
  const today = startDate ? new Date(startDate) : new Date();
  const cashFlows: CashFlowEntry[] = [];
  
  // Initialize weeks
  for (let w = 0; w < weeks; w++) {
    const weekDate = new Date(today);
    weekDate.setDate(weekDate.getDate() + w * 7);
    cashFlows.push({
      date: weekDate.toISOString().split('T')[0],
      week: w + 1,
      inflows: 0,
      outflows: 0,
      net: 0,
      cumulative: 0,
    });
  }
  
  // Process each contract
  contracts.forEach(contract => {
    let schedule: ScheduleEntry[];
    
    if (contract.type === 'PAM') {
      schedule = calculatePAMSchedule(contract);
    } else {
      schedule = calculateANNSchedule(contract);
    }
    
    schedule.forEach(entry => {
      const entryDate = new Date(entry.date);
      const weekIndex = Math.floor((entryDate.getTime() - today.getTime()) / (7 * 24 * 60 * 60 * 1000));
      
      if (weekIndex >= 0 && weekIndex < weeks) {
        if (contract.direction === 'receivable') {
          cashFlows[weekIndex].inflows += entry.payment;
        } else {
          cashFlows[weekIndex].outflows += entry.payment;
        }
      }
    });
  });
  
  // Calculate net and cumulative — start from 0, real balance comes from treasury agent (:7070/health)
  let cumulative = 0;
  cashFlows.forEach(cf => {
    cf.net = cf.inflows - cf.outflows;
    cumulative += cf.net;
    cf.cumulative = cumulative;
  });
  
  return cashFlows;
}

// Dynamic Discount APR Calculator
// APR = (Discount% / (100 - Discount%)) × (365 / Days) × 100
export function calculateDiscountAPR(discountPercent: number, daysEarly: number): {
  apr: number;
  formula: string;
  recommendation: 'TAKE' | 'SKIP';
  savings: number;
  netBenefit: number;
} {
  const apr = (discountPercent / (100 - discountPercent)) * (365 / daysEarly) * 100;
  const costOfCapital = 12; // Assumed 12% cost of capital
  
  return {
    apr: Math.round(apr * 100) / 100,
    formula: `(${discountPercent}% / (100 - ${discountPercent}%)) × (365 / ${daysEarly}) × 100 = ${apr.toFixed(2)}%`,
    recommendation: apr > costOfCapital ? 'TAKE' : 'SKIP',
    savings: 0, // Will be calculated based on invoice amount
    netBenefit: 0, // Will be calculated
  };
}

export function calculateDiscountSavings(
  invoiceAmount: number,
  discountPercent: number,
  daysEarly: number,
  costOfCapital: number = 12
): {
  apr: number;
  savings: number;
  opportunityCost: number;
  netBenefit: number;
  recommendation: 'TAKE' | 'SKIP';
} {
  const apr = (discountPercent / (100 - discountPercent)) * (365 / daysEarly) * 100;
  const savings = invoiceAmount * (discountPercent / 100);
  const opportunityCost = invoiceAmount * (costOfCapital / 100) * (daysEarly / 365);
  const netBenefit = savings - opportunityCost;
  
  return {
    apr: Math.round(apr * 100) / 100,
    savings: Math.round(savings * 100) / 100,
    opportunityCost: Math.round(opportunityCost * 100) / 100,
    netBenefit: Math.round(netBenefit * 100) / 100,
    recommendation: apr > costOfCapital ? 'TAKE' : 'SKIP',
  };
}

// Credit Risk PD (Probability of Default) Scoring
// Logistic Regression: PD = 1 / (1 + e^(-z))
// z = -2.5 + (0.05 × daysOverdue) + (0.3 × paymentVariance) - (0.02 × invoiceCount)
export function calculatePDScore(
  daysOverdue: number,
  paymentVariance: number, // 0-10 scale
  invoiceCount: number
): {
  pd: number;
  z: number;
  riskClass: 'Low' | 'Medium' | 'High';
  formula: string;
  riskScore: number;
} {
  const z = -2.5 + (0.05 * daysOverdue) + (0.3 * paymentVariance) - (0.02 * invoiceCount);
  const pd = 1 / (1 + Math.exp(-z));
  const riskScore = Math.round(pd * 100);
  
  let riskClass: 'Low' | 'Medium' | 'High';
  if (riskScore < 20) {
    riskClass = 'Low';
  } else if (riskScore < 50) {
    riskClass = 'Medium';
  } else {
    riskClass = 'High';
  }
  
  return {
    pd: Math.round(pd * 10000) / 10000,
    z: Math.round(z * 100) / 100,
    riskClass,
    formula: `z = -2.5 + (0.05 × ${daysOverdue}) + (0.3 × ${paymentVariance}) - (0.02 × ${invoiceCount}) = ${z.toFixed(2)}`,
    riskScore,
  };
}

// Working Capital Metrics
export function calculateWorkingCapitalMetrics(
  accountsReceivable: number,
  accountsPayable: number,
  inventory: number,
  annualRevenue: number,
  annualCOGS: number
): {
  dso: number; // Days Sales Outstanding
  dpo: number; // Days Payables Outstanding
  dio: number; // Days Inventory Outstanding
  ccc: number; // Cash Conversion Cycle
} {
  const dso = (accountsReceivable / annualRevenue) * 365;
  const dpo = (accountsPayable / annualCOGS) * 365;
  const dio = (inventory / annualCOGS) * 365;
  const ccc = dso + dio - dpo;
  
  return {
    dso: Math.round(dso * 10) / 10,
    dpo: Math.round(dpo * 10) / 10,
    dio: Math.round(dio * 10) / 10,
    ccc: Math.round(ccc * 10) / 10,
  };
}

// Get total contract value
export function getContractValue(contract: Contract): number {
  if (contract.type === 'PAM') {
    return contract.principal;
  } else {
    return contract.loanAmount;
  }
}

// Get total scheduled payments
export function getTotalPayments(contract: Contract): number {
  let schedule: ScheduleEntry[];
  if (contract.type === 'PAM') {
    schedule = calculatePAMSchedule(contract);
  } else {
    schedule = calculateANNSchedule(contract);
  }
  return schedule.reduce((sum, entry) => sum + entry.payment, 0);
}

// Get total interest
export function getTotalInterest(contract: Contract): number {
  let schedule: ScheduleEntry[];
  if (contract.type === 'PAM') {
    schedule = calculatePAMSchedule(contract);
  } else {
    schedule = calculateANNSchedule(contract);
  }
  return schedule.reduce((sum, entry) => sum + entry.interest, 0);
}
