import { describe, expect, it } from 'vitest';
import { calculateLine, calculateQuoteTotals, QuoteCalculationInput } from './calc';

describe('calculateLine', () => {
  it('computes subtotal, discount and taxes correctly', () => {
    const result = calculateLine({
      quantity: 2,
      unitPrice: 100,
      taxRate: 23,
      discountType: 'percent',
      discountValue: 10
    });

    expect(result.subtotal).toBeCloseTo(200);
    expect(result.discountAmount).toBeCloseTo(20);
    expect(result.netTotal).toBeCloseTo(180);
    expect(result.taxAmount).toBeCloseTo(41.4);
    expect(result.grossTotal).toBeCloseTo(221.4);
  });
});

describe('calculateQuoteTotals', () => {
  it('aggregates multiple lines with different taxes and global discount', () => {
    const input: QuoteCalculationInput = {
      globalDiscountPercent: 5,
      shippingCost: 20,
      lines: [
        {
          quantity: 3,
          unitPrice: 50,
          taxRate: 23,
          discountType: 'percent',
          discountValue: 0
        },
        {
          quantity: 2,
          unitPrice: 80,
          taxRate: 6,
          discountType: 'value',
          discountValue: 10
        }
      ]
    };

    const totals = calculateQuoteTotals(input);

    expect(totals.baseTaxable).toBeCloseTo(250);
    expect(totals.globalDiscountAmount).toBeCloseTo(12.5);
    expect(totals.baseAfterDiscount).toBeCloseTo(237.5);
    expect(totals.taxBreakdown.length).toBe(2);
    const iva23 = totals.taxBreakdown.find((tax) => tax.rate === 23);
    const iva6 = totals.taxBreakdown.find((tax) => tax.rate === 6);
    expect(iva23?.tax).toBeCloseTo(41.3625, 4);
    expect(iva6?.tax).toBeCloseTo(7.125, 4);
    expect(totals.shippingCost).toBeCloseTo(20);
    expect(totals.totalTax).toBeCloseTo(48.4875, 4);
    expect(totals.grandTotal).toBeCloseTo(305.9875, 4);
  });

  it('handles zero quantities and caps value discounts', () => {
    const totals = calculateQuoteTotals({
      globalDiscountPercent: 0,
      shippingCost: 0,
      lines: [
        {
          quantity: 0,
          unitPrice: 100,
          taxRate: 23,
          discountType: 'value',
          discountValue: 50
        },
        {
          quantity: 1,
          unitPrice: 100,
          taxRate: 13,
          discountType: 'value',
          discountValue: 150
        }
      ]
    });

    expect(totals.baseTaxable).toBeCloseTo(0 + 0);
    const lineTaxes = totals.taxBreakdown.reduce((sum, item) => sum + item.tax, 0);
    expect(lineTaxes).toBeCloseTo(0);
    expect(totals.grandTotal).toBeCloseTo(0);
  });
});
