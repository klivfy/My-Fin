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
  mensal opcional (alimenta a tela de Orçamentos).
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

### Server Actions (`src/actions`)

- `transactions.ts`: CRUD com atualização atômica de `currentBalance`, mais
  ações em lote (recategorizar, conciliar, excluir).
- `transfers.ts`: transferência atômica (`prisma.$transaction`) entre
  contas, com partida dobrada real.
- `credit-cards.ts`: lançamento de compra parcelada (gera as N transações
  filhas já vinculadas às faturas correspondentes) e liquidação de fatura.
- `import-ofx.ts`: recebe o arquivo `.ofx`, deduplica e insere em lote,
  registrando tudo em `SyncLog`.

### UI (`src/app/(dashboard)`)

Shell com Navigation Rail, Top App Bar (seletor de período, indicador de
sincronização, Modo Privacidade, FAB de nova transação) e 4 telas:
Dashboard (KPIs, fluxo de caixa realizado vs. projetado, despesas por
categoria), Extrato (dropzone de OFX, tabela de alta densidade, ações em
lote), Contas (grid de contas + módulo de cartão de crédito com régua de
fatura e parcelamentos ativos) e Orçamentos (progresso por categoria com
alerta de ritmo de queima acelerado).

## Segurança

Em uso local o app fica aberto. Em produção, `APP_ACCESS_TOKEN` é
obrigatório: sem ele o proxy (`src/proxy.ts`) responde 503. Com ele, todas
as rotas (exceto `/login`) exigem login. O cookie de sessão guarda só uma
assinatura HMAC do token com data de emissão (expira em 30 dias; trocar o
token encerra todas as sessões), e `/api/login` aceita 10 tentativas por IP
a cada 15 minutos. Esse limite fica na memória de cada instância da função,
então não é global entre instâncias.

## Deploy (Netlify)

`netlify.toml` já configura o build (`prisma generate && next build`) e o
plugin oficial. Configure `DATABASE_URL` (endpoint com connection pooling,
ex. Supabase porta 6543 ou Neon `-pooler`) e `DIRECT_URL` (conexão direta,
usada só pelo `prisma migrate`) nas variáveis de ambiente do site.
