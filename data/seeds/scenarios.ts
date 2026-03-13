import type { Scenario } from '@/types/scenario';

const now = new Date().toISOString();

export const seedScenarios: Scenario[] = [
  {
    id: 'seed-particular',
    nome: 'T2 Porto - Particular',
    createdAt: now,
    updatedAt: now,
    acquisition: {
      precoCompra: 180000,
      imtRegime: 'normal',
      imtManualEnabled: false,
      imtManual: 0,
      escrituraRegisto: 1800,
      honorariosJuridicos: 1200,
      comissaoCompra: 0,
      financiamento: {
        entradaPropria: 60000,
        montanteFinanciado: 120000,
        comissaoBancaria: 600,
        avaliacao: 300,
        impostoSeloCredito: 960,
        jurosEstimados: 4800
      }
    },
    renovation: {
      custoBaseObra: 45000,
      ivaTaxa: 23,
      projetoArquitetura: 2500,
      engenhariasEspecialidades: 1800,
      fiscalizacao: 1200,
      licencasComunicacaoPrevia: 900,
      taxasCamararias: 700,
      seguroObra: 450,
      entulhoLimpezaResiduos: 650,
      ligacoesUtilidades: 500,
      imprevistosModo: 'percentagem',
      imprevistosValor: 0,
      imprevistosPercentagem: 8
    },
    holding: {
      mesesDetencao: 8,
      imiAnual: 640,
      condominioMensal: 55,
      aguaLuzMensal: 65,
      seguroMultirriscos: 280,
      outrosMensais: 30
    },
    sale: {
      precoVendaPrevisto: 320000,
      comissaoPercentagem: 5,
      ivaComissaoPercentagem: 23,
      certificadoEnergetico: 220,
      custosDocumentaisFinais: 350,
      outrosCustosVenda: 0
    },
    taxSettings: {
      mode: 'particular',
      particular: {
        taxaEfetivaIRS: 21,
        deduzirDespesasAquisicao: true,
        deduzirDespesasVenda: true,
        deduzirDespesasValorizacao: true,
        despesasValorizacaoDocumentadas: 12000
      },
      empresa: {
        isPme: false,
        aplicarDerramaMunicipal: false,
        derramaMunicipalPercentagem: 1.5,
        aplicarDerramaEstadual: false,
        derramaEstadualPercentagem: 3
      }
    }
  },
  {
    id: 'seed-empresa',
    nome: 'Moradia Braga - Empresa com isenção IMT',
    createdAt: now,
    updatedAt: now,
    acquisition: {
      precoCompra: 230000,
      imtRegime: 'isencao_revenda',
      imtManualEnabled: false,
      imtManual: 0,
      escrituraRegisto: 2200,
      honorariosJuridicos: 1400,
      comissaoCompra: 2000,
      financiamento: {
        entradaPropria: 90000,
        montanteFinanciado: 140000,
        comissaoBancaria: 800,
        avaliacao: 350,
        impostoSeloCredito: 1120,
        jurosEstimados: 6200
      }
    },
    renovation: {
      custoBaseObra: 70000,
      ivaTaxa: 23,
      projetoArquitetura: 4000,
      engenhariasEspecialidades: 3200,
      fiscalizacao: 1800,
      licencasComunicacaoPrevia: 1500,
      taxasCamararias: 1200,
      seguroObra: 600,
      entulhoLimpezaResiduos: 900,
      ligacoesUtilidades: 850,
      imprevistosModo: 'valor',
      imprevistosValor: 6000,
      imprevistosPercentagem: 10
    },
    holding: {
      mesesDetencao: 10,
      imiAnual: 980,
      condominioMensal: 40,
      aguaLuzMensal: 80,
      seguroMultirriscos: 360,
      outrosMensais: 45
    },
    sale: {
      precoVendaPrevisto: 430000,
      comissaoPercentagem: 4,
      ivaComissaoPercentagem: 23,
      certificadoEnergetico: 240,
      custosDocumentaisFinais: 500,
      outrosCustosVenda: 300
    },
    taxSettings: {
      mode: 'empresa',
      particular: {
        taxaEfetivaIRS: 20,
        deduzirDespesasAquisicao: true,
        deduzirDespesasVenda: true,
        deduzirDespesasValorizacao: false,
        despesasValorizacaoDocumentadas: 0
      },
      empresa: {
        isPme: true,
        aplicarDerramaMunicipal: false,
        derramaMunicipalPercentagem: 1.5,
        aplicarDerramaEstadual: false,
        derramaEstadualPercentagem: 3
      }
    }
  }
];
