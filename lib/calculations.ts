import { calcPercentOf } from '@/lib/percentages';
import { estimateIrc } from '@/lib/tax';
import type { CalculationResult, Scenario } from '@/types/scenario';

const estimateImt = (purchasePrice: number): number => {
  if (purchasePrice <= 101917) return purchasePrice * 0.02;
  if (purchasePrice <= 139412) return purchasePrice * 0.05;
  if (purchasePrice <= 190086) return purchasePrice * 0.07;
  if (purchasePrice <= 316772) return purchasePrice * 0.08;
  return purchasePrice * 0.06;
};

export const calculateScenario = (scenario: Scenario): CalculationResult => {
  const alerts: string[] = [];
  const impostoSeloCompraAuto = scenario.acquisition.precoCompra * 0.008;
  const imtCalculado =
    scenario.acquisition.imtRegime === 'isencao_revenda'
      ? 0
      : scenario.acquisition.imtManualEnabled
        ? scenario.acquisition.imtManual
        : estimateImt(scenario.acquisition.precoCompra);

  if (scenario.acquisition.imtRegime === 'isencao_revenda') {
    alerts.push(
      'A isenção de IMT pode perder-se se o imóvel tiver destino diferente, não for revendido no prazo de 1 ano, ou for revendido novamente para revenda.'
    );
  }

  const custoAquisicaoTotal =
    scenario.acquisition.precoCompra +
    imtCalculado +
    impostoSeloCompraAuto +
    scenario.acquisition.escrituraRegisto +
    scenario.acquisition.honorariosJuridicos +
    scenario.acquisition.comissaoCompra +
    scenario.acquisition.financiamento.comissaoBancaria +
    scenario.acquisition.financiamento.avaliacao +
    scenario.acquisition.financiamento.impostoSeloCredito +
    scenario.acquisition.financiamento.jurosEstimados;

  const ivaObra = calcPercentOf(scenario.renovation.custoBaseObra, scenario.renovation.ivaTaxa);
  const imprevistos =
    scenario.renovation.imprevistosModo === 'valor'
      ? scenario.renovation.imprevistosValor
      : calcPercentOf(scenario.renovation.custoBaseObra, scenario.renovation.imprevistosPercentagem);

  const custoObraTotal =
    scenario.renovation.custoBaseObra +
    ivaObra +
    scenario.renovation.projetoArquitetura +
    scenario.renovation.engenhariasEspecialidades +
    scenario.renovation.fiscalizacao +
    scenario.renovation.licencasComunicacaoPrevia +
    scenario.renovation.taxasCamararias +
    scenario.renovation.seguroObra +
    scenario.renovation.entulhoLimpezaResiduos +
    scenario.renovation.ligacoesUtilidades +
    imprevistos;

  const custoDetencaoTotal =
    (scenario.holding.imiAnual / 12) * scenario.holding.mesesDetencao +
    scenario.holding.condominioMensal * scenario.holding.mesesDetencao +
    scenario.holding.aguaLuzMensal * scenario.holding.mesesDetencao +
    (scenario.holding.seguroMultirriscos / 12) * scenario.holding.mesesDetencao +
    scenario.holding.outrosMensais * scenario.holding.mesesDetencao;

  const comissaoBase = calcPercentOf(scenario.sale.precoVendaPrevisto, scenario.sale.comissaoPercentagem);
  const ivaComissao = calcPercentOf(comissaoBase, scenario.sale.ivaComissaoPercentagem);
  const comissaoVendaTotal = comissaoBase + ivaComissao;
  const custoVendaTotal =
    comissaoVendaTotal +
    scenario.sale.certificadoEnergetico +
    scenario.sale.custosDocumentaisFinais +
    scenario.sale.outrosCustosVenda;

  const custoTotalProjeto = custoAquisicaoTotal + custoObraTotal + custoDetencaoTotal + custoVendaTotal;
  const lucroBruto = scenario.sale.precoVendaPrevisto - custoTotalProjeto;

  const maisValiaBruta = scenario.sale.precoVendaPrevisto - scenario.acquisition.precoCompra;
  const deducoes =
    (scenario.taxSettings.particular.deduzirDespesasAquisicao ? custoAquisicaoTotal - scenario.acquisition.precoCompra : 0) +
    (scenario.taxSettings.particular.deduzirDespesasVenda ? custoVendaTotal : 0) +
    (scenario.taxSettings.particular.deduzirDespesasValorizacao
      ? scenario.taxSettings.particular.despesasValorizacaoDocumentadas
      : 0);
  const maisValiaTributavel = Math.max(0, maisValiaBruta - deducoes);

  const lucroTributavelEmpresa = lucroBruto;
  const ircEstimadoEmpresa = estimateIrc(lucroTributavelEmpresa, scenario.taxSettings.empresa);

  const impostoEstimado =
    scenario.taxSettings.mode === 'particular'
      ? calcPercentOf(maisValiaTributavel, scenario.taxSettings.particular.taxaEfetivaIRS)
      : ircEstimadoEmpresa;

  const lucroLiquido = lucroBruto - impostoEstimado;
  const roiPercent = custoTotalProjeto > 0 ? (lucroLiquido / custoTotalProjeto) * 100 : 0;
  const margemLiquidaPercent = scenario.sale.precoVendaPrevisto > 0 ? (lucroLiquido / scenario.sale.precoVendaPrevisto) * 100 : 0;

  if (lucroLiquido < 0) alerts.push('Operação em prejuízo: reveja custos ou preço de venda.');
  else if (margemLiquidaPercent < 10) alerts.push('Margem líquida baixa: considere otimizar custos e fiscalidade.');

  return {
    custoAquisicaoTotal,
    custoObraTotal,
    custoDetencaoTotal,
    custoVendaTotal,
    custoTotalProjeto,
    lucroBruto,
    impostoEstimado,
    lucroLiquido,
    roiPercent,
    margemLiquidaPercent,
    precoMinimoVendaBreakEven: custoTotalProjeto + impostoEstimado,
    impostoSeloCompraAuto,
    imtCalculado,
    comissaoVendaTotal,
    maisValiaBruta,
    maisValiaTributavel,
    lucroTributavelEmpresa,
    ircEstimadoEmpresa,
    alertas: alerts
  };
};
