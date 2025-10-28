# Comercial - Orçamentos Policópia

Aplicação web construída com Next.js 14 (App Router) e Tailwind CSS para criar, gerir e exportar orçamentos comerciais da Policópia.

## Pré-requisitos

- Node.js 20+
- npm 10+

## Instalação e execução

```bash
npm install
npm run dev
```

A aplicação ficará disponível em `http://localhost:3000`.

## Scripts disponíveis

- `npm run dev` – inicia o servidor de desenvolvimento Next.js.
- `npm run build` – cria a versão otimizada para produção.
- `npm run start` – arranca o servidor em modo produção (após `build`).
- `npm run test` – executa os testes unitários de cálculo com Vitest.

## Estrutura principal

- `app/quotes/new` – formulário para novos orçamentos.
- `app/quotes/[id]` – edição de orçamentos guardados.
- `app/quotes` – listagem com pesquisa e ordenação.
- `app/settings` – gestão de logótipo e dados institucionais.
- `components/` – componentes reutilizáveis (formulário, totais, linhas, tabela de orçamentos, definições).
- `lib/calc.ts` – lógica de cálculo (linhas, descontos, IVA) com testes em `lib/calc.test.ts`.
- `data/settings/settings.json` – dados da empresa.
- `data/quotes/*.json` – orçamentos guardados em formato JSON.

## Funcionalidades chave

- Autonumeração diária de orçamentos (`AAAA MM DD-###`).
- Formulário validado com `react-hook-form` + `zod`.
- Gestão de linhas com desconto por linha (€/%) e IVA editável.
- Cálculo automático de base tributável, IVA por taxa, total, desconto global e portes.
- Exportação para PDF (`html2pdf.js`) e DOCX (`docx`).
- Atalho Ctrl+S para guardar rascunho.
- Upload/drag-and-drop de imagens por linha.
- Configuração de logótipo e rodapé institucional.
- Persistência em ficheiros JSON e reabertura de orçamentos.

## Dados

- Ajuste o logótipo e contactos em `/settings` (guardado em `data/settings/settings.json`).
- Os orçamentos são guardados em `data/quotes/` (um ficheiro JSON por orçamento).

## Testes

Os testes unitários cobrem cenários de cálculo (IVA múltiplo, descontos percentuais e valores absolutos). Execute-os com:

```bash
npm run test
```

## Licença

Projeto interno Policópia.
