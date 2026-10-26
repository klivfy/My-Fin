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
sincronização, Modo Privacidade, FAB de nova transação) e 5 telas:
Dashboard (KPIs, fluxo de caixa realizado vs. projetado, despesas por
categoria), Extrato (dropzones de OFX e CSV com mapeamento de colunas,
exportação CSV/backup JSON, tabela com edição inline e ações em lote),
Contas (CRUD de contas, módulo de cartão de crédito com régua de fatura,
estorno de liquidação, auditoria de saldo e lançamentos recorrentes),
Orçamentos (teto por categoria editável, metas de poupança e regras de
categorização automática) e Relatórios (comparativo mensal, médias por
categoria, maiores despesas).

### Automação

- **Regras de categorização**: padrões (substring, case/accent-insensitive)
  aplicados na ingestão OFX/CSV e sob demanda no extrato.
- **Lançamentos recorrentes**: `ScheduledTransaction` (mensal/semanal,
  ocorrências opcionais) materializada por
  `materializeScheduledTransactions` — Netlify Scheduled Function diária ou
  botão "Processar vencidos" na tela Contas.
- **Integração Inter**: `InterApiAdapter` com OAuth2 + mTLS (cliente HTTP
  injetável; credenciais via env em Base64).

## Plataformas

O app é um **PWA** (Progressive Web App): uma única base cobre Web 100%,
Windows (instalável/Store), Android (TWA/Play Store), iOS/iPadOS (Adicionar
à Tela de Início) e extensões Chromium/Edge/Firefox (`extension/`).

- Manifest + ícones maskable + service worker (offline-first apenas para
  assets; dados financeiros sempre da rede) em `public/`.
- Guia completo de empacotamento por loja: [docs/PLATFORMS.md](docs/PLATFORMS.md).
- Ícones regeneráveis: `npm run icons:generate`.

## Segurança

Em uso local o app fica aberto. Em deploy público (Netlify), defina
`APP_ACCESS_TOKEN` nas variáveis de ambiente — o middleware passa a exigir
login com esse token antes de qualquer rota (exceto `/login`).

### Threat model (resumo)

- **Autenticação**: token único (`APP_ACCESS_TOKEN`) → cookie de sessão
  `__Host-myfin_access` com valor **derivado por HMAC** (o segredo nunca fica
  no navegador). Comparação em tempo constante (`timingSafeEqual`).
- **Brute force**: `/api/login` com rate limiting por IP e backoff
  exponencial (HTTP 429 + `Retry-After`).
- **Defesa em profundidade**: toda Server Action chama `assertAuthorized()`
  — não depende apenas do matcher do middleware.
- **Headers**: CSP, `X-Content-Type-Options: nosniff`, `frame-ancestors
  'none'`, `Referrer-Policy: strict-origin-when-cross-origin`,
  `Permissions-Policy` restritiva e HSTS (produção).
- **Upload OFX**: limitado a 5 MB e 10.000 registros por arquivo; extensão
  `.ofx` validada no servidor; contas de cartão rejeitadas (fluxo próprio).
- **Auditoria**: ações destrutivas (exclusões, reversão de transferência,
  liquidação de fatura, recálculo de saldo) gravam em `audit_logs`; falhas de
  importação guardam mensagem genérica em `sync_logs` (detalhe técnico fica
  no log do servidor).

Limitações e recomendações de hospedagem: ver [SECURITY.md](SECURITY.md).

## Deploy (Netlify)

`netlify.toml` já configura o build (`prisma generate && next build`) e o
plugin oficial. Configure `DATABASE_URL` (endpoint com connection pooling,
ex. Supabase porta 6543 ou Neon `-pooler`) e `DIRECT_URL` (conexão direta,
usada só pelo `prisma migrate`) nas variáveis de ambiente do site.
