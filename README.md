# Flip Imobiliário PT

Aplicação web em **Next.js 14 + TypeScript + Tailwind CSS** para análise de rentabilidade de operações de compra, reabilitação e revenda de imóveis em Portugal.

## Funcionalidades principais

- Simulação completa por cenário (aquisição, obra, detenção, venda e fiscalidade).
- Modos de tributação:
  - Particular
  - Empresa / Revenda profissional
- Cálculo em tempo real de:
  - Custo total
  - Lucro bruto e líquido
  - ROI
  - Margem líquida
  - Preço mínimo de venda (break-even)
- Dashboard com cartões resumo, distribuição de custos e comparativo antes/depois de imposto.
- Tabela detalhada de rubricas e cálculos fiscais.
- Persistência local com `localStorage`.
- Ferramentas: guardar, duplicar cenário, reset, exportar PDF, exportar CSV.
- Comparação lado a lado entre dois cenários.
- 2 cenários seed incluídos (particular + empresa com isenção de IMT para revenda).

## Aviso importante

A aplicação não assume automaticamente taxas camarárias, licenças municipais ou enquadramento legal do IVA reduzido sem input do utilizador.
Todos os campos relevantes são parametrizáveis.

## Requisitos

- Node.js 20+
- npm 10+

## Executar localmente

```bash
npm install
npm run dev
```

Depois abrir: `http://localhost:3000`

## Scripts

- `npm run dev` – ambiente de desenvolvimento
- `npm run build` – build de produção
- `npm run start` – execução da build
- `npm run test` – testes Vitest existentes no projeto

## Estrutura técnica relevante

- `types/scenario.ts` – tipos principais (`Scenario`, `AcquisitionCosts`, `RenovationCosts`, `HoldingCosts`, `SaleCosts`, `TaxSettings`, `CalculationResult`).
- `lib/calculations.ts` – lógica de cálculo central e regras automáticas.
- `lib/formatters.ts`, `lib/percentages.ts`, `lib/tax.ts`, `lib/validation.ts`, `lib/scenarioStorage.ts` – utilitários.
- `data/seeds/scenarios.ts` – cenários seed.
- `components/FlipApp.tsx` – interface principal da aplicação.

## Nota legal (rodapé da app)

> “Simulação indicativa. Confirmar enquadramento fiscal, contabilístico e urbanístico com contabilista, advogado e câmara municipal.”
