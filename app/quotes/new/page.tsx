import { QuoteForm } from '@/components/QuoteForm';
import type { QuoteFormValues } from '@/components/QuoteForm';
import { getSettings } from '@/lib/settings';
import { createQuoteDraft, generateNextQuoteNumber } from '@/lib/quotes';

export default async function NewQuotePage() {
  const settings = await getSettings();
  const draft = createQuoteDraft();
  const number = await generateNextQuoteNumber();
  const initialValues: QuoteFormValues = {
    id: undefined,
    number,
    createdAt: new Date().toISOString(),
    validityDays: draft.validityDays,
    client: draft.client,
    lines: draft.lines as QuoteFormValues['lines'],
    globalDiscountPercent: draft.globalDiscountPercent,
    shippingCost: draft.shippingCost,
    notes: draft.notes
  };

  return (
    <section className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-slate-900">Novo orçamento</h1>
        <p className="text-slate-600">Preencha os dados do cliente, linhas e exporte em PDF ou DOCX.</p>
      </header>
      <QuoteForm mode="create" initialValues={initialValues} settings={settings} />
    </section>
  );
}
