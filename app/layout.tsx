import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import './globals.css';
import { getSettings } from '@/lib/settings';

export const metadata: Metadata = {
  title: 'Policópia | Orçamentos',
  description: 'Gestão de orçamentos comerciais da Policópia'
};

export default async function RootLayout({
  children
}: {
  children: ReactNode;
}) {
  const settings = await getSettings();

  return (
    <html lang="pt-PT">
      <body className="min-h-screen flex flex-col">
        <header className="bg-white border-b border-slate-200">
          <div className="max-w-6xl mx-auto flex items-center justify-between gap-6 px-6 py-4">
            <div className="flex items-center gap-3">
              {settings.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={settings.logoUrl} alt={settings.companyName} className="h-12 w-auto object-contain" />
              ) : (
                <div className="h-12 w-12 rounded-full bg-primary-500 text-white flex items-center justify-center text-lg font-semibold">
                  {settings.companyName?.[0] ?? 'P'}
                </div>
              )}
              <div>
                <p className="text-xl font-semibold text-primary-700">{settings.companyName}</p>
                <p className="text-sm text-slate-600">Gestão de orçamentos comerciais</p>
              </div>
            </div>
            <nav className="flex gap-4 text-sm font-medium text-slate-600">
              <Link href="/quotes" className="hover:text-primary-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 rounded">
                Orçamentos
              </Link>
              <Link href="/quotes/new" className="hover:text-primary-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 rounded">
                Novo Orçamento
              </Link>
              <Link href="/settings" className="hover:text-primary-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 rounded">
                Definições
              </Link>
            </nav>
          </div>
        </header>
        <main className="flex-1">
          <div className="max-w-6xl mx-auto w-full px-6 py-8">{children}</div>
        </main>
        <footer className="bg-slate-900 text-slate-100">
          <div className="max-w-6xl mx-auto px-6 py-6 text-sm leading-relaxed">
            <p className="font-semibold text-slate-50">{settings.companyName}</p>
            <p>{settings.address}</p>
            <p>NIF: {settings.vatNumber}</p>
            <p>
              Email: <a className="underline" href={`mailto:${settings.email}`}>{settings.email}</a> | Site:{' '}
              <a className="underline" href={settings.website} target="_blank" rel="noreferrer">
                {settings.website}
              </a>{' '}
              | Tel: {settings.phone}
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
