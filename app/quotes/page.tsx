import Link from 'next/link';
import { listQuotes } from '@/lib/quotes';
import { QuotesTable } from '@/components/QuotesTable';

export default async function QuotesPage() {
  const quotes = await listQuotes();

  return (
    <section className="space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Orçamentos</h1>
          <p className="text-slate-600">Consulte, pesquise e abra orçamentos existentes.</p>
        </div>
        <Link
          href="/quotes/new"
          className="inline-flex items-center justify-center rounded-md bg-primary-500 px-4 py-2 font-medium text-white shadow hover:bg-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
        >
          Novo orçamento
        </Link>
      </header>
      <QuotesTable quotes={quotes} />
    </section>
  );
}
