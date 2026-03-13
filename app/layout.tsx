import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'Flip Imobiliário PT',
  description: 'Simulador de rentabilidade para compra, reabilitação e revenda de imóveis em Portugal.'
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-PT">
      <body>
        <main className="mx-auto max-w-7xl px-4 py-8">{children}</main>
        <footer className="mx-auto mt-12 max-w-7xl px-4 pb-8 text-sm text-slate-400">
          Simulação indicativa. Confirmar enquadramento fiscal, contabilístico e urbanístico com contabilista, advogado e câmara municipal.
        </footer>
      </body>
    </html>
  );
}
