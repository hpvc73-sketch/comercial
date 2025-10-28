import { notFound } from 'next/navigation';
import { QuoteForm } from '@/components/QuoteForm';
import type { QuoteFormValues } from '@/components/QuoteForm';
import { getSettings } from '@/lib/settings';
import { getQuote } from '@/lib/quotes';

type QuotePageProps = {
  params: { id: string };
};

export default async function QuoteDetailPage({ params }: QuotePageProps) {
  const settings = await getSettings();
  const quote = await getQuote(params.id);
  if (!quote) {
    notFound();
  }
  const initialValues: QuoteFormValues = {
    id: quote.id,
    number: quote.number,
    createdAt: quote.createdAt,
    validityDays: quote.validityDays,
    client: quote.client,
    lines: quote.lines as QuoteFormValues['lines'],
    globalDiscountPercent: quote.globalDiscountPercent,
    shippingCost: quote.shippingCost,
    notes: quote.notes ?? ''
  };

  return (
    <section className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-slate-900">Editar orçamento</h1>
        <p className="text-slate-600">Atualize qualquer informação e exporte novamente.</p>
      </header>
      <QuoteForm mode="edit" initialValues={initialValues} settings={settings} />
    </section>
  );
}
