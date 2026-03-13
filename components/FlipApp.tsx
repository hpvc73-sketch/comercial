'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { seedScenarios } from '@/data/seeds/scenarios';
import { calculateScenario } from '@/lib/calculations';
import { formatCurrency, formatPercent } from '@/lib/formatters';
import { loadScenarios, saveScenarios } from '@/lib/scenarioStorage';
import { clampPercent } from '@/lib/validation';
import type { CalculationResult, Scenario } from '@/types/scenario';

const sectionClass = 'rounded-xl border border-slate-700/60 bg-slate-900/60 p-4 shadow-lg';

const NumberInput = ({ label, value, onChange, step = 1 }: { label: string; value: number; onChange: (v: number) => void; step?: number }) => (
  <label className="grid gap-1 text-sm">
    <span className="text-slate-300">{label}</span>
    <input type="number" value={value} step={step} onChange={(e) => onChange(Number(e.target.value))} className="bg-slate-950 border-slate-700" />
  </label>
);

const SummaryCard = ({ label, value, danger }: { label: string; value: string; danger?: boolean }) => (
  <div className={`rounded-lg border p-3 ${danger ? 'border-rose-500 bg-rose-950/40' : 'border-slate-700 bg-slate-900'}`}>
    <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
    <p className="text-lg font-semibold">{value}</p>
  </div>
);

const cloneScenario = (scenario: Scenario): Scenario => ({
  ...structuredClone(scenario),
  id: crypto.randomUUID(),
  nome: `${scenario.nome} (cópia)`,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
});

const createBlank = (): Scenario => ({
  ...structuredClone(seedScenarios[0]),
  id: crypto.randomUUID(),
  nome: 'Novo cenário',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
});

export default function FlipApp() {
  const [scenarios, setScenarios] = useState<Scenario[]>(seedScenarios);
  const [selectedId, setSelectedId] = useState(seedScenarios[0].id);
  const [compareId, setCompareId] = useState('');
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const pdfRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const stored = loadScenarios();
    if (stored.length) {
      setScenarios(stored);
      setSelectedId(stored[0].id);
    }
    const savedTheme = window.localStorage.getItem('flip-theme');
    if (savedTheme === 'light' || savedTheme === 'dark') setTheme(savedTheme);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('light', theme === 'light');
    window.localStorage.setItem('flip-theme', theme);
  }, [theme]);

  const current = scenarios.find((s) => s.id === selectedId) ?? scenarios[0];
  const comparison = scenarios.find((s) => s.id === compareId);
  const result = useMemo(() => calculateScenario(current), [current]);
  const comparisonResult = useMemo(() => (comparison ? calculateScenario(comparison) : null), [comparison]);

  const patch = (updater: (scenario: Scenario) => Scenario) => {
    setScenarios((prev) =>
      prev.map((scenario) =>
        scenario.id === current.id
          ? { ...updater(scenario), updatedAt: new Date().toISOString() }
          : scenario
      )
    );
  };

  const persistNow = () => saveScenarios(scenarios);

  const exportCSV = () => {
    const rows = [
      ['Cenário', current.nome],
      ['Custo total', result.custoTotalProjeto.toString()],
      ['Lucro bruto', result.lucroBruto.toString()],
      ['Imposto estimado', result.impostoEstimado.toString()],
      ['Lucro líquido', result.lucroLiquido.toString()],
      ['ROI', result.roiPercent.toString()]
    ];
    const content = rows.map((r) => r.join(';')).join('\n');
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${current.nome.replaceAll(' ', '_')}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const exportPDF = async () => {
    if (!pdfRef.current) return;
    const html2pdf = (await import('html2pdf.js')).default as any;
    await html2pdf().from(pdfRef.current).set({ filename: `${current.nome}.pdf`, margin: 10 }).save();
  };

  const distribution = [
    { label: 'Aquisição', value: result.custoAquisicaoTotal, color: 'bg-cyan-500' },
    { label: 'Obra', value: result.custoObraTotal, color: 'bg-indigo-500' },
    { label: 'Detenção', value: result.custoDetencaoTotal, color: 'bg-amber-500' },
    { label: 'Venda', value: result.custoVendaTotal, color: 'bg-rose-500' }
  ];
  const maxDist = Math.max(...distribution.map((d) => d.value), 1);

  return (
    <div className="space-y-6" ref={pdfRef}>
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-700 bg-slate-900 p-4">
        <select className="bg-slate-950 border-slate-700" value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
          {scenarios.map((s) => (
            <option key={s.id} value={s.id}>{s.nome}</option>
          ))}
        </select>
        <input value={current.nome} onChange={(e) => patch((s) => ({ ...s, nome: e.target.value }))} className="bg-slate-950 border-slate-700" />
        <button className="bg-cyan-600 hover:bg-cyan-500" onClick={() => setScenarios((p) => [...p, cloneScenario(current)])}>Duplicar cenário</button>
        <button className="bg-emerald-600 hover:bg-emerald-500" onClick={persistNow}>Guardar cenário</button>
        <button className="bg-violet-600 hover:bg-violet-500" onClick={exportPDF}>Exportar PDF</button>
        <button className="bg-sky-600 hover:bg-sky-500" onClick={exportCSV}>Exportar Excel/CSV</button>
        <button className="bg-rose-700 hover:bg-rose-600" onClick={() => patch(() => createBlank())}>Reset</button>
        <button className="ml-auto border border-slate-600" onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}>Tema {theme === 'dark' ? 'claro' : 'escuro'}</button>
      </div>

      <div className="grid gap-3 md:grid-cols-4 xl:grid-cols-7">
        <SummaryCard label="Custo total" value={formatCurrency(result.custoTotalProjeto)} />
        <SummaryCard label="Lucro bruto" value={formatCurrency(result.lucroBruto)} danger={result.lucroBruto < 0} />
        <SummaryCard label="Imposto estimado" value={formatCurrency(result.impostoEstimado)} />
        <SummaryCard label="Lucro líquido" value={formatCurrency(result.lucroLiquido)} danger={result.lucroLiquido < 0} />
        <SummaryCard label="ROI" value={formatPercent(result.roiPercent)} danger={result.roiPercent < 0} />
        <SummaryCard label="Margem líquida" value={formatPercent(result.margemLiquidaPercent)} danger={result.margemLiquidaPercent < 10} />
        <SummaryCard label="Venda mínima" value={formatCurrency(result.precoMinimoVendaBreakEven)} />
      </div>

      {result.alertas.map((alerta) => (
        <p key={alerta} className="rounded-lg border border-amber-500 bg-amber-500/15 p-3 text-amber-200">{alerta}</p>
      ))}

      <div className="grid gap-6 xl:grid-cols-2">
        <section className={sectionClass}>
          <h2 className="mb-3 font-semibold">Aquisição</h2>
          <div className="grid gap-3 md:grid-cols-2">
            <NumberInput label="Preço de compra" value={current.acquisition.precoCompra} onChange={(v) => patch((s) => ({ ...s, acquisition: { ...s.acquisition, precoCompra: v } }))} />
            <label className="grid gap-1 text-sm"><span>Regime de IMT</span><select value={current.acquisition.imtRegime} onChange={(e) => patch((s) => ({ ...s, acquisition: { ...s.acquisition, imtRegime: e.target.value as any } }))} className="bg-slate-950 border-slate-700"><option value="normal">Normal</option><option value="isencao_revenda">Isenção por aquisição para revenda</option></select></label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={current.acquisition.imtManualEnabled} onChange={(e) => patch((s) => ({ ...s, acquisition: { ...s.acquisition, imtManualEnabled: e.target.checked } }))} /> IMT manual</label>
            <NumberInput label="IMT manual" value={current.acquisition.imtManual} onChange={(v) => patch((s) => ({ ...s, acquisition: { ...s.acquisition, imtManual: v } }))} />
            <NumberInput label="Imposto do selo compra (auto 0,8%)" value={result.impostoSeloCompraAuto} onChange={() => undefined} />
            <NumberInput label="Escritura / registo" value={current.acquisition.escrituraRegisto} onChange={(v) => patch((s) => ({ ...s, acquisition: { ...s.acquisition, escrituraRegisto: v } }))} />
            <NumberInput label="Honorários jurídicos" value={current.acquisition.honorariosJuridicos} onChange={(v) => patch((s) => ({ ...s, acquisition: { ...s.acquisition, honorariosJuridicos: v } }))} />
            <NumberInput label="Comissão de compra" value={current.acquisition.comissaoCompra} onChange={(v) => patch((s) => ({ ...s, acquisition: { ...s.acquisition, comissaoCompra: v } }))} />
          </div>
        </section>

        <section className={sectionClass}>
          <h2 className="mb-3 font-semibold">Obra</h2>
          <div className="grid gap-3 md:grid-cols-2">
            <NumberInput label="Custo base da obra" value={current.renovation.custoBaseObra} onChange={(v) => patch((s) => ({ ...s, renovation: { ...s.renovation, custoBaseObra: v } }))} />
            <NumberInput label="IVA obra (%)" value={current.renovation.ivaTaxa} onChange={(v) => patch((s) => ({ ...s, renovation: { ...s.renovation, ivaTaxa: clampPercent(v, 100) } }))} step={0.1} />
            <div className="flex gap-2"><button className="border border-slate-600" onClick={() => patch((s) => ({ ...s, renovation: { ...s.renovation, ivaTaxa: 6 } }))}>Taxa reduzida</button><button className="border border-slate-600" onClick={() => patch((s) => ({ ...s, renovation: { ...s.renovation, ivaTaxa: 23 } }))}>Taxa normal</button></div>
            <NumberInput label="Projeto de arquitetura" value={current.renovation.projetoArquitetura} onChange={(v) => patch((s) => ({ ...s, renovation: { ...s.renovation, projetoArquitetura: v } }))} />
            <NumberInput label="Engenharias" value={current.renovation.engenhariasEspecialidades} onChange={(v) => patch((s) => ({ ...s, renovation: { ...s.renovation, engenhariasEspecialidades: v } }))} />
            <NumberInput label="Fiscalização" value={current.renovation.fiscalizacao} onChange={(v) => patch((s) => ({ ...s, renovation: { ...s.renovation, fiscalizacao: v } }))} />
            <NumberInput label="Licenças" value={current.renovation.licencasComunicacaoPrevia} onChange={(v) => patch((s) => ({ ...s, renovation: { ...s.renovation, licencasComunicacaoPrevia: v } }))} />
            <NumberInput label="Taxas camarárias" value={current.renovation.taxasCamararias} onChange={(v) => patch((s) => ({ ...s, renovation: { ...s.renovation, taxasCamararias: v } }))} />
            <NumberInput label="Seguro obra" value={current.renovation.seguroObra} onChange={(v) => patch((s) => ({ ...s, renovation: { ...s.renovation, seguroObra: v } }))} />
            <NumberInput label="Entulho/limpeza" value={current.renovation.entulhoLimpezaResiduos} onChange={(v) => patch((s) => ({ ...s, renovation: { ...s.renovation, entulhoLimpezaResiduos: v } }))} />
            <NumberInput label="Ligações/utilidades" value={current.renovation.ligacoesUtilidades} onChange={(v) => patch((s) => ({ ...s, renovation: { ...s.renovation, ligacoesUtilidades: v } }))} />
            <label className="grid gap-1 text-sm"><span>Imprevistos</span><select value={current.renovation.imprevistosModo} onChange={(e) => patch((s) => ({ ...s, renovation: { ...s.renovation, imprevistosModo: e.target.value as any } }))} className="bg-slate-950 border-slate-700"><option value="valor">Valor manual</option><option value="percentagem">Percentagem sobre obra</option></select></label>
            {current.renovation.imprevistosModo === 'valor' ? (
              <NumberInput label="Imprevistos (€)" value={current.renovation.imprevistosValor} onChange={(v) => patch((s) => ({ ...s, renovation: { ...s.renovation, imprevistosValor: v } }))} />
            ) : (
              <NumberInput label="Imprevistos (%)" value={current.renovation.imprevistosPercentagem} onChange={(v) => patch((s) => ({ ...s, renovation: { ...s.renovation, imprevistosPercentagem: v } }))} step={0.1} />
            )}
          </div>
        </section>

        <section className={sectionClass}>
          <h2 className="mb-3 font-semibold">Detenção</h2>
          <div className="grid gap-3 md:grid-cols-2">
            <NumberInput label="Meses de detenção" value={current.holding.mesesDetencao} onChange={(v) => patch((s) => ({ ...s, holding: { ...s.holding, mesesDetencao: v } }))} />
            <NumberInput label="IMI anual" value={current.holding.imiAnual} onChange={(v) => patch((s) => ({ ...s, holding: { ...s.holding, imiAnual: v } }))} />
            <NumberInput label="Condomínio mensal" value={current.holding.condominioMensal} onChange={(v) => patch((s) => ({ ...s, holding: { ...s.holding, condominioMensal: v } }))} />
            <NumberInput label="Água/luz mensal" value={current.holding.aguaLuzMensal} onChange={(v) => patch((s) => ({ ...s, holding: { ...s.holding, aguaLuzMensal: v } }))} />
            <NumberInput label="Seguro multirriscos (anual)" value={current.holding.seguroMultirriscos} onChange={(v) => patch((s) => ({ ...s, holding: { ...s.holding, seguroMultirriscos: v } }))} />
            <NumberInput label="Outros mensais" value={current.holding.outrosMensais} onChange={(v) => patch((s) => ({ ...s, holding: { ...s.holding, outrosMensais: v } }))} />
          </div>
        </section>

        <section className={sectionClass}>
          <h2 className="mb-3 font-semibold">Venda e Fiscalidade</h2>
          <div className="grid gap-3 md:grid-cols-2">
            <NumberInput label="Preço de venda previsto" value={current.sale.precoVendaPrevisto} onChange={(v) => patch((s) => ({ ...s, sale: { ...s.sale, precoVendaPrevisto: v } }))} />
            <NumberInput label="Comissão imobiliária (%)" value={current.sale.comissaoPercentagem} onChange={(v) => patch((s) => ({ ...s, sale: { ...s.sale, comissaoPercentagem: v } }))} step={0.1} />
            <NumberInput label="IVA sobre comissão (%)" value={current.sale.ivaComissaoPercentagem} onChange={(v) => patch((s) => ({ ...s, sale: { ...s.sale, ivaComissaoPercentagem: v } }))} step={0.1} />
            <NumberInput label="Certificado energético" value={current.sale.certificadoEnergetico} onChange={(v) => patch((s) => ({ ...s, sale: { ...s.sale, certificadoEnergetico: v } }))} />
            <NumberInput label="Custos documentais finais" value={current.sale.custosDocumentaisFinais} onChange={(v) => patch((s) => ({ ...s, sale: { ...s.sale, custosDocumentaisFinais: v } }))} />
            <NumberInput label="Outros custos de venda" value={current.sale.outrosCustosVenda} onChange={(v) => patch((s) => ({ ...s, sale: { ...s.sale, outrosCustosVenda: v } }))} />

            <label className="grid gap-1 text-sm"><span>Modo de tributação</span><select value={current.taxSettings.mode} onChange={(e) => patch((s) => ({ ...s, taxSettings: { ...s.taxSettings, mode: e.target.value as any } }))} className="bg-slate-950 border-slate-700"><option value="particular">Particular</option><option value="empresa">Empresa / Revenda profissional</option></select></label>

            {current.taxSettings.mode === 'particular' ? (
              <>
                <NumberInput label="Taxa efetiva IRS estimada (%)" value={current.taxSettings.particular.taxaEfetivaIRS} onChange={(v) => patch((s) => ({ ...s, taxSettings: { ...s.taxSettings, particular: { ...s.taxSettings.particular, taxaEfetivaIRS: clampPercent(v, 100) } } }))} step={0.1} />
                <label className="flex items-center gap-2"><input type="checkbox" checked={current.taxSettings.particular.deduzirDespesasAquisicao} onChange={(e) => patch((s) => ({ ...s, taxSettings: { ...s.taxSettings, particular: { ...s.taxSettings.particular, deduzirDespesasAquisicao: e.target.checked } } }))} /> Deduzir despesas de aquisição</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={current.taxSettings.particular.deduzirDespesasVenda} onChange={(e) => patch((s) => ({ ...s, taxSettings: { ...s.taxSettings, particular: { ...s.taxSettings.particular, deduzirDespesasVenda: e.target.checked } } }))} /> Deduzir despesas de venda</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={current.taxSettings.particular.deduzirDespesasValorizacao} onChange={(e) => patch((s) => ({ ...s, taxSettings: { ...s.taxSettings, particular: { ...s.taxSettings.particular, deduzirDespesasValorizacao: e.target.checked } } }))} /> Deduzir despesas de valorização</label>
                <NumberInput label="Despesas de valorização documentadas" value={current.taxSettings.particular.despesasValorizacaoDocumentadas} onChange={(v) => patch((s) => ({ ...s, taxSettings: { ...s.taxSettings, particular: { ...s.taxSettings.particular, despesasValorizacaoDocumentadas: v } } }))} />
              </>
            ) : (
              <>
                <label className="flex items-center gap-2"><input type="checkbox" checked={current.taxSettings.empresa.isPme} onChange={(e) => patch((s) => ({ ...s, taxSettings: { ...s.taxSettings, empresa: { ...s.taxSettings.empresa, isPme: e.target.checked } } }))} /> PME / Small Mid Cap?</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={current.taxSettings.empresa.aplicarDerramaMunicipal} onChange={(e) => patch((s) => ({ ...s, taxSettings: { ...s.taxSettings, empresa: { ...s.taxSettings.empresa, aplicarDerramaMunicipal: e.target.checked } } }))} /> Derrama municipal</label>
                <NumberInput label="% Derrama municipal" value={current.taxSettings.empresa.derramaMunicipalPercentagem} onChange={(v) => patch((s) => ({ ...s, taxSettings: { ...s.taxSettings, empresa: { ...s.taxSettings.empresa, derramaMunicipalPercentagem: v } } }))} step={0.1} />
                <label className="flex items-center gap-2"><input type="checkbox" checked={current.taxSettings.empresa.aplicarDerramaEstadual} onChange={(e) => patch((s) => ({ ...s, taxSettings: { ...s.taxSettings, empresa: { ...s.taxSettings.empresa, aplicarDerramaEstadual: e.target.checked } } }))} /> Derrama estadual</label>
                <NumberInput label="% Derrama estadual" value={current.taxSettings.empresa.derramaEstadualPercentagem} onChange={(v) => patch((s) => ({ ...s, taxSettings: { ...s.taxSettings, empresa: { ...s.taxSettings.empresa, derramaEstadualPercentagem: v } } }))} step={0.1} />
              </>
            )}
          </div>
        </section>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className={sectionClass}>
          <h3 className="mb-3 font-semibold">Distribuição de custos</h3>
          <div className="space-y-3">
            {distribution.map((item) => (
              <div key={item.label}>
                <div className="mb-1 flex justify-between text-sm"><span>{item.label}</span><span>{formatCurrency(item.value)}</span></div>
                <div className="h-3 rounded bg-slate-800"><div className={`h-3 rounded ${item.color}`} style={{ width: `${(item.value / maxDist) * 100}%` }} /></div>
              </div>
            ))}
          </div>
        </section>
        <section className={sectionClass}>
          <h3 className="mb-3 font-semibold">Lucro antes/depois de imposto</h3>
          <div className="grid gap-3">
            <div className="rounded border border-slate-700 p-3"><p className="text-sm text-slate-400">Antes de imposto</p><p className="text-xl font-semibold">{formatCurrency(result.lucroBruto)}</p></div>
            <div className="rounded border border-slate-700 p-3"><p className="text-sm text-slate-400">Depois de imposto</p><p className="text-xl font-semibold">{formatCurrency(result.lucroLiquido)}</p></div>
          </div>
        </section>
      </div>

      <section className={sectionClass}>
        <h3 className="mb-3 font-semibold">Tabela final detalhada</h3>
        <Detailed result={result} mode={current.taxSettings.mode} />
      </section>

      <section className={sectionClass}>
        <h3 className="mb-3 font-semibold">Comparação de 2 cenários</h3>
        <select value={compareId} onChange={(e) => setCompareId(e.target.value)} className="mb-3 bg-slate-950 border-slate-700">
          <option value="">Selecionar cenário</option>
          {scenarios.filter((s) => s.id !== current.id).map((s) => <option value={s.id} key={s.id}>{s.nome}</option>)}
        </select>
        {comparisonResult && comparison && (
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded border border-slate-700 p-3"><p className="font-medium">{current.nome}</p><p>Lucro líquido: {formatCurrency(result.lucroLiquido)}</p><p>ROI: {formatPercent(result.roiPercent)}</p></div>
            <div className="rounded border border-slate-700 p-3"><p className="font-medium">{comparison.nome}</p><p>Lucro líquido: {formatCurrency(comparisonResult.lucroLiquido)}</p><p>ROI: {formatPercent(comparisonResult.roiPercent)}</p></div>
          </div>
        )}
      </section>
    </div>
  );
}

function Detailed({ result, mode }: { result: CalculationResult; mode: Scenario['taxSettings']['mode'] }) {
  const rows = [
    ['Custo aquisição', result.custoAquisicaoTotal],
    ['Custo obra', result.custoObraTotal],
    ['Custo detenção', result.custoDetencaoTotal],
    ['Custo venda', result.custoVendaTotal],
    ['Custo total projeto', result.custoTotalProjeto],
    ['Lucro bruto', result.lucroBruto],
    ['Imposto estimado', result.impostoEstimado],
    ['Lucro líquido', result.lucroLiquido],
    ['ROI', result.roiPercent],
    ['Margem líquida', result.margemLiquidaPercent]
  ];

  return (
    <table className="w-full text-sm">
      <tbody>
        {rows.map(([label, val]) => (
          <tr key={label as string} className="border-b border-slate-800">
            <td className="py-2 text-slate-300">{label}</td>
            <td className="py-2 text-right font-medium">{label === 'ROI' || label === 'Margem líquida' ? formatPercent(Number(val)) : formatCurrency(Number(val))}</td>
          </tr>
        ))}
        {mode === 'particular' ? (
          <>
            <tr><td className="py-2 text-slate-300">Mais-valia bruta</td><td className="py-2 text-right">{formatCurrency(result.maisValiaBruta)}</td></tr>
            <tr><td className="py-2 text-slate-300">Mais-valia tributável</td><td className="py-2 text-right">{formatCurrency(result.maisValiaTributavel)}</td></tr>
          </>
        ) : (
          <>
            <tr><td className="py-2 text-slate-300">Lucro tributável</td><td className="py-2 text-right">{formatCurrency(result.lucroTributavelEmpresa)}</td></tr>
            <tr><td className="py-2 text-slate-300">IRC estimado</td><td className="py-2 text-right">{formatCurrency(result.ircEstimadoEmpresa)}</td></tr>
          </>
        )}
      </tbody>
    </table>
  );
}
