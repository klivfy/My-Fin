# My-Fin

Personal Financial Management (PFM) completo: dashboard consolidado, extrato
unificado com conciliação, contas e cartões de crédito, e orçamentos
mensais — construído com arquitetura modular, tipagem estrita e precisão
monetária exata (`Decimal`, nunca `Float`/`Number`).

## Stack (zero cost em produção)

| Camada       | Tecnologia                                                   |
| ------------ | ------------------------------------------------------------- |
| Framework    | Next.js 16 (App Router, Server Actions, TypeScript `strict`)   |
| UI           | Tailwind CSS v4 + shadcn/ui (Material Design 3) + Lucide Icons |
| Gráficos     | Recharts                                                       |
| Banco        | PostgreSQL (compatível com Supabase / Neon, com pooling)       |
| ORM          | Prisma 6 (`prisma-client-js`)                                  |
| Dinheiro     | `decimal.js` + `@db.Decimal(12,2)` — nunca `Float`/`Number`    |
| Validação    | Zod (contratos de entrada/saída das Server Actions)            |
| Deploy       | Netlify (`@netlify/plugin-nextjs`)                             |

## Rodando localmente

Pré-requisitos: Node 20+, PostgreSQL 14+.

```bash
npm install                 # instala dependências (gera o Prisma Client via postinstall)
cp .env.example .env        # ajuste DATABASE_URL/DIRECT_URL para o seu Postgres
npx prisma migrate dev      # aplica as migrações
npm run db:seed             # popula categorias, contas e 90 dias de transações
npm run dev                 # http://localhost:3000
```

### Scripts úteis

```bash
npm run build       # build de produção (Next.js)
npm run lint         # ESLint
npm run typecheck    # tsc --noEmit
npm test             # testes unitários (Vitest) do motor financeiro
npm run db:studio    # Prisma Studio (inspeção visual do banco)
npm run db:seed      # popula dados de teste (idempotente — reexecutar não duplica nada)
```

## Arquitetura

### Modelagem (`prisma/schema.prisma`)

- **Account**: `initialBalance`/`currentBalance` em `Decimal(12,2)`; `metadata`
  JSON guarda configurações como o limite do cartão (`creditLimit`).
- **Transaction**: valor assinado (crédito positivo/débito negativo),
  `reconciliationHash` único (chave de deduplicação), parcelamento via
  auto-relação (`parentTransactionId`/`installments`), vínculo opcional a
  `Transfer` e a `CreditCardInvoice`.
- **Transfer**: registro-mãe de uma transferência entre contas próprias —
  as duas pernas (débito/crédito) são `Transaction`s reais do tipo
  `TRANSFER`, nunca contam como receita/despesa nos relatórios.
- **Category**: hierárquica (auto-relação `parentId`), com `budgetLimit`
  mensal opcional (alimenta a tela de Orçamentos) e `nature`
  (Necessidade/Desejo/Poupança, base da regra 50/30/20).
- **RecurrenceIgnore**: chaves de estabelecimento que o usuário marcou
  como "não é recorrente" (a detecção em si é recalculada das transações).
- **CategorizationRule**: trecho da descrição normalizada → categoria,
  aplicado em toda importação. `Transaction.categorizationSource` registra
  quem categorizou (`MANUAL`, `RULE` ou `AI`).
- **CreditCardInvoice**: ciclo `closingDate`/`dueDate`/`status`, com relação
  1:1 à transação de liquidação (`settlementTransactionId`).
- **SyncLog**: auditoria de cada rodada de ingestão (fonte, status,
  processados/inseridos/ignorados, erro).

### Motor de ingestão (`src/lib/financial-engine`)

- `financial-adapter.ts`: contrato `FinancialAdapter` comum a todas as fontes.
- `ofx-adapter.ts`: parser nativo de OFX brasileiro (SGML e XML), com
  detecção de encoding (Windows-1252/UTF-8) via cabeçalho `CHARSET`.
- `mock-adapter.ts`: gerador determinístico (seed fixa) de 90 dias de
  transações realistas — salário no 5º dia útil, assinaturas recorrentes,
  despesas essenciais e parcelamentos.
- `inter-api-adapter.ts`: stub estrutural para a API do Inter, já preparado
  para autenticação mTLS via variáveis de ambiente em Base64.
- `reconciliation.ts`: hash determinístico
  `SHA256(accountId + data + valor + descrição normalizada + fitId)` — a
  mesma importação rodada duas vezes nunca duplica uma transação.
- `categorization.ts`: casamento de regras por substring; vence o padrão
  mais longo (mais específico).
- `recurrence.ts`: detecta contas e assinaturas recorrentes (mensais, por
  meses de calendário, e anuais) com confiança A/M/B, e monta o calendário
  de contas do mês (pago / a vencer / atrasado). Parcelamentos e gastos
  frequentes ficam de fora; confiança baixa vira "confira", nunca conta.
- `budget-rule.ts`: regra 50/30/20 sobre as receitas do período —
  Necessidades/Desejos pela natureza das categorias, Poupança = aportes +
  sobra; recomenda 60/20/20 ou 70/20/10 quando o custo fixo não cabe em
  50% e distribui os cortes sugeridos entre os Desejos.
- `ai-categorizer.ts`: categorização pelo Claude (saída estruturada) do que
  as regras não resolveram. Só envia data, valor e a descrição com números
  longos e e-mails mascarados; sugestões de confiança baixa ficam para
  revisão manual.

### Server Actions (`src/actions`)

- `transactions.ts`: CRUD com atualização atômica de `currentBalance`, mais
  ações em lote (recategorizar, conciliar, excluir).
- `transfers.ts`: transferência atômica (`prisma.$transaction`) entre
  contas, com partida dobrada real.
- `credit-cards.ts`: lançamento de compra parcelada (gera as N transações
  filhas já vinculadas às faturas correspondentes) e liquidação de fatura.
- `import-ofx.ts`: recebe o arquivo `.ofx`, deduplica, aplica as regras de
  categorização e insere em lote, registrando tudo em `SyncLog`.
- `categorization.ts`: categorização manual (com criação opcional de regra
  já aplicada às pendentes), natureza N/D/P das categorias e a IA — um lote
  por chamada, para caber no timeout de funções serverless.

### UI (`src/app/(dashboard)`)

Shell com Navigation Rail, Top App Bar (seletor de período, indicador de
sincronização, Modo Privacidade, FAB de nova transação) e 6 telas:
Dashboard (KPIs, fluxo de caixa realizado vs. projetado, despesas por
categoria), Extrato (dropzone de OFX, tabela de alta densidade, ações em
lote), Revisar (fila do que ficou sem categoria, botão "Categorizar com
IA", natureza N/D/P das categorias e regras automáticas), Recorrentes
(calendário de contas do mês e assinaturas com custo anual), Contas (grid de contas + módulo de cartão de crédito com régua de
fatura e parcelamentos ativos) e Orçamentos (regra 50/30/20 do período com
cortes sugeridos, e progresso por categoria com alerta de ritmo de queima
acelerado).

## Segurança

Em uso local o app fica aberto. Em deploy público (Netlify), defina
`APP_ACCESS_TOKEN` nas variáveis de ambiente — o middleware passa a exigir
login com esse token antes de qualquer rota (exceto `/login`).

## Deploy (Netlify)

`netlify.toml` já configura o build (`prisma generate && next build`) e o
plugin oficial. Configure `DATABASE_URL` (endpoint com connection pooling,
ex. Supabase porta 6543 ou Neon `-pooler`) e `DIRECT_URL` (conexão direta,
usada só pelo `prisma migrate`) nas variáveis de ambiente do site. Para a
categorização com IA, defina também `ANTHROPIC_API_KEY`.
