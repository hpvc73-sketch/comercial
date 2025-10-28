'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { Quote } from '@/lib/quotes';
import { formatCurrency, formatDate } from '@/lib/format';

type QuotesTableProps = {
  quotes: Quote[];
};

type SortKey = 'createdAt' | 'number' | 'client';

export function QuotesTable({ quotes }: QuotesTableProps) {
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('createdAt');

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const filteredQuotes = normalized
      ? quotes.filter((quote) =>
          [quote.number, quote.client.name, quote.client.email]
            .join(' ')
            .toLowerCase()
            .includes(normalized)
        )
      : quotes;

    const sorted = [...filteredQuotes].sort((a, b) => {
      switch (sortKey) {
        case 'number':
          return a.number.localeCompare(b.number);
        case 'client':
          return a.client.name.localeCompare(b.client.name);
        case 'createdAt':
        default:
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      }
    });

    return sorted;
  }, [quotes, query, sortKey]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <input
          type="search"
          placeholder="Procurar por nº, cliente ou email"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="md:w-1/2"
        />
        <div className="flex items-center gap-2 text-sm">
          <label htmlFor="sort" className="text-slate-600">
            Ordenar por:
          </label>
          <select
            id="sort"
            value={sortKey}
            onChange={(event) => setSortKey(event.target.value as SortKey)}
            className="border border-slate-300 rounded-md px-3 py-2"
          >
            <option value="createdAt">Data</option>
            <option value="number">Nº Orçamento</option>
            <option value="client">Cliente</option>
          </select>
        </div>
      </div>
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3 text-left">Nº</th>
              <th className="px-4 py-3 text-left">Cliente</th>
              <th className="px-4 py-3 text-left">Data</th>
              <th className="px-4 py-3 text-left">Total</th>
              <th className="px-4 py-3 text-left">Estado</th>
              <th className="px-4 py-3 text-right">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {filtered.map((quote) => (
              <tr key={quote.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-medium text-slate-700">{quote.number}</td>
                <td className="px-4 py-3">
                  <p className="text-slate-700">{quote.client.name}</p>
                  <p className="text-xs text-slate-500">{quote.client.email}</p>
                </td>
                <td className="px-4 py-3 text-slate-600">{formatDate(quote.createdAt)}</td>
                <td className="px-4 py-3 text-slate-600">{formatCurrency(quote.totals.grandTotal)}</td>
                <td className="px-4 py-3 text-slate-600">
                  Validade {quote.validityDays} dias
                </td>
                <td className="px-4 py-3 text-right">
                  <Link
                    href={`/quotes/${quote.id}`}
                    className="text-primary-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 rounded"
                  >
                    Abrir
                  </Link>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                  Nenhum orçamento encontrado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
