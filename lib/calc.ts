export type DiscountType = 'percent' | 'value';

export type QuoteLineInput = {
  quantity: number;
  unitPrice: number;
  taxRate: number;
  discountType: DiscountType;
  discountValue: number;
};

export type LineComputation = {
  subtotal: number;
  discountAmount: number;
  netTotal: number;
  taxRate: number;
  taxAmount: number;
  grossTotal: number;
};

export type TaxBreakdown = {
  rate: number;
  base: number;
  tax: number;
};

export type QuoteInputTotals = {
  lineResults: LineComputation[];
  baseTaxable: number;
  globalDiscountAmount: number;
  baseAfterDiscount: number;
  taxBreakdown: TaxBreakdown[];
  totalTax: number;
  shippingCost: number;
  grandTotal: number;
};

export type QuoteCalculationInput = {
  lines: QuoteLineInput[];
  globalDiscountPercent: number;
  shippingCost: number;
};

export function calculateLine(line: QuoteLineInput): LineComputation {
  const quantity = Number.isFinite(line.quantity) ? Math.max(line.quantity, 0) : 0;
  const unitPrice = Number.isFinite(line.unitPrice) ? Math.max(line.unitPrice, 0) : 0;
  const subtotal = quantity * unitPrice;
  const discountValue = Number.isFinite(line.discountValue) ? Math.max(line.discountValue, 0) : 0;
  let discountAmount = 0;
  if (line.discountType === 'percent') {
    discountAmount = subtotal * (discountValue / 100);
  } else {
    discountAmount = Math.min(discountValue, subtotal);
  }
  const netTotal = subtotal - discountAmount;
  const taxRate = Number.isFinite(line.taxRate) ? Math.max(line.taxRate, 0) : 0;
  const taxAmount = netTotal * (taxRate / 100);
  const grossTotal = netTotal + taxAmount;
  return {
    subtotal,
    discountAmount,
    netTotal,
    taxRate,
    taxAmount,
    grossTotal
  };
}

export function calculateQuoteTotals(input: QuoteCalculationInput): QuoteInputTotals {
  const lineResults = input.lines.map((line) => calculateLine(line));
  const lineNetTotal = lineResults.reduce((acc, line) => acc + line.netTotal, 0);
  const globalDiscountAmount = lineNetTotal * (Math.max(input.globalDiscountPercent, 0) / 100);
  const baseAfterDiscount = lineNetTotal - globalDiscountAmount;
  const taxBreakdownMap = new Map<number, { base: number; tax: number }>();

  lineResults.forEach((result, index) => {
    const originalLine = input.lines[index];
    const lineBase = result.netTotal;
    const rate = Math.max(originalLine.taxRate, 0);
    const discountFactor = lineNetTotal === 0 ? 0 : lineBase / lineNetTotal;
    const discountedBase = baseAfterDiscount * discountFactor;
    const taxAmount = discountedBase * (rate / 100);
    const entry = taxBreakdownMap.get(rate) ?? { base: 0, tax: 0 };
    entry.base += discountedBase;
    entry.tax += taxAmount;
    taxBreakdownMap.set(rate, entry);
  });

  const taxBreakdown: TaxBreakdown[] = Array.from(taxBreakdownMap.entries())
    .map(([rate, value]) => ({ rate, base: value.base, tax: value.tax }))
    .sort((a, b) => a.rate - b.rate);

  const totalTax = taxBreakdown.reduce((sum, item) => sum + item.tax, 0);
  const shippingCost = Math.max(input.shippingCost, 0);
  const grandTotal = baseAfterDiscount + totalTax + shippingCost;

  return {
    lineResults,
    baseTaxable: lineNetTotal,
    globalDiscountAmount,
    baseAfterDiscount,
    taxBreakdown,
    totalTax,
    shippingCost,
    grandTotal
  };
}
