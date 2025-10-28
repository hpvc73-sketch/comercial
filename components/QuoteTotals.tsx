'use client';

import type { QuoteInputTotals } from '@/lib/calc';
import { formatCurrency } from '@/lib/format';

type QuoteTotalsProps = {
  totals: QuoteInputTotals;
};

export function QuoteTotals({ totals }: QuoteTotalsProps) {
  return (
    <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h3 className="text-lg font-semibold text-slate-800">Resumo do orçamento</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
        <div className="space-y-2">
          <div className="flex justify-between">
            <span>Base tributável (antes desconto global)</span>
            <span className="font-medium">{formatCurrency(totals.baseTaxable)}</span>
          </div>
          <div className="flex justify-between text-red-600">
            <span>Desconto global</span>
            <span className="font-medium">- {formatCurrency(totals.globalDiscountAmount)}</span>
          </div>
          <div className="flex justify-between">
            <span>Base após desconto</span>
            <span className="font-medium">{formatCurrency(totals.baseAfterDiscount)}</span>
          </div>
          <div className="flex justify-between">
            <span>Portes</span>
            <span className="font-medium">{formatCurrency(totals.shippingCost)}</span>
          </div>
        </div>
        <div className="space-y-2">
          <p className="font-medium text-slate-700">IVA por taxa</p>
          <div className="space-y-1">
            {totals.taxBreakdown.map((tax) => (
              <div key={tax.rate} className="flex justify-between">
                <span>
                  {tax.rate}% sobre {formatCurrency(tax.base)}
                </span>
                <span className="font-medium">{formatCurrency(tax.tax)}</span>
              </div>
            ))}
            {totals.taxBreakdown.length === 0 && <p className="text-slate-500">Sem IVA aplicável.</p>}
          </div>
          <div className="flex justify-between text-slate-800">
            <span>Total IVA</span>
            <span className="font-semibold">{formatCurrency(totals.totalTax)}</span>
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between border-t border-slate-200 pt-4 text-lg font-semibold text-primary-700">
        <span>Total com IVA</span>
        <span>{formatCurrency(totals.grandTotal)}</span>
      </div>
    </div>
  );
}
