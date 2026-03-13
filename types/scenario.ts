export type TaxMode = 'particular' | 'empresa';
export type ImtRegime = 'normal' | 'isencao_revenda';

export interface FinancingCosts {
  entradaPropria: number;
  montanteFinanciado: number;
  comissaoBancaria: number;
  avaliacao: number;
  impostoSeloCredito: number;
  jurosEstimados: number;
}

export interface AcquisitionCosts {
  precoCompra: number;
  imtRegime: ImtRegime;
  imtManualEnabled: boolean;
  imtManual: number;
  escrituraRegisto: number;
  honorariosJuridicos: number;
  comissaoCompra: number;
  financiamento: FinancingCosts;
}

export interface RenovationCosts {
  custoBaseObra: number;
  ivaTaxa: number;
  projetoArquitetura: number;
  engenhariasEspecialidades: number;
  fiscalizacao: number;
  licencasComunicacaoPrevia: number;
  taxasCamararias: number;
  seguroObra: number;
  entulhoLimpezaResiduos: number;
  ligacoesUtilidades: number;
  imprevistosModo: 'valor' | 'percentagem';
  imprevistosValor: number;
  imprevistosPercentagem: number;
}

export interface HoldingCosts {
  mesesDetencao: number;
  imiAnual: number;
  condominioMensal: number;
  aguaLuzMensal: number;
  seguroMultirriscos: number;
  outrosMensais: number;
}

export interface SaleCosts {
  precoVendaPrevisto: number;
  comissaoPercentagem: number;
  ivaComissaoPercentagem: number;
  certificadoEnergetico: number;
  custosDocumentaisFinais: number;
  outrosCustosVenda: number;
}

export interface ParticularTaxSettings {
  taxaEfetivaIRS: number;
  deduzirDespesasAquisicao: boolean;
  deduzirDespesasVenda: boolean;
  deduzirDespesasValorizacao: boolean;
  despesasValorizacaoDocumentadas: number;
}

export interface EmpresaTaxSettings {
  isPme: boolean;
  aplicarDerramaMunicipal: boolean;
  derramaMunicipalPercentagem: number;
  aplicarDerramaEstadual: boolean;
  derramaEstadualPercentagem: number;
}

export interface TaxSettings {
  mode: TaxMode;
  particular: ParticularTaxSettings;
  empresa: EmpresaTaxSettings;
}

export interface Scenario {
  id: string;
  nome: string;
  createdAt: string;
  updatedAt: string;
  acquisition: AcquisitionCosts;
  renovation: RenovationCosts;
  holding: HoldingCosts;
  sale: SaleCosts;
  taxSettings: TaxSettings;
}

export interface CalculationResult {
  custoAquisicaoTotal: number;
  custoObraTotal: number;
  custoDetencaoTotal: number;
  custoVendaTotal: number;
  custoTotalProjeto: number;
  lucroBruto: number;
  impostoEstimado: number;
  lucroLiquido: number;
  roiPercent: number;
  margemLiquidaPercent: number;
  precoMinimoVendaBreakEven: number;
  impostoSeloCompraAuto: number;
  imtCalculado: number;
  comissaoVendaTotal: number;
  maisValiaBruta: number;
  maisValiaTributavel: number;
  lucroTributavelEmpresa: number;
  ircEstimadoEmpresa: number;
  alertas: string[];
}
