import FlipApp from '@/components/FlipApp';

export default function HomePage() {
  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-slate-700 bg-slate-900 p-6">
        <h1 className="text-2xl font-bold">Analisador de Flip Imobiliário</h1>
        <p className="mt-2 text-slate-300">
          Simule compra, reabilitação e revenda de imóveis em Portugal com cálculo em tempo real de custos, fiscalidade e rentabilidade.
        </p>
      </section>
      <FlipApp />
    </div>
  );
}
