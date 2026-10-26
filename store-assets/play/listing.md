# Listagem — Google Play Store

## Nome do app
My-Fin — Gerenciador Financeiro

## Descrição curta (máx. 80 caracteres)
Controle financeiro pessoal: extrato unificado, cartões, orçamentos e metas.

## Descrição completa
O My-Fin é um gerenciador financeiro pessoal (PFM) completo e de código
aberto, com foco em precisão e privacidade:

• Dashboard consolidado com patrimônio líquido, fluxo de caixa realizado
  vs. projetado e despesas por categoria.
• Extrato unificado com importação de OFX/CSV, conciliação e ações em lote.
• Contas e cartões de crédito com faturas, parcelamentos e limite.
• Orçamentos mensais por categoria com alerta de ritmo de gasto.
• Metas de poupança com acompanhamento de progresso.
• Lançamentos recorrentes (mensal/semanal) com materialização automática.
• Relatórios: comparativo mês a mês, médias por categoria e maiores gastos.
• Regras de categorização automática.
• Exportação CSV e backup completo em JSON.

Precisão monetária exata (aritmética decimal, nunca ponto flutuante) e
deduplicação determinística de importações — reimportar o mesmo extrato
nunca duplica uma transação.

Seus dados ficam no SEU banco de dados: o app é self-hosted (open source).
O acesso é protegido por token pessoal.

## Categoria
Finanças

## Classificação de conteúdo
Livre (sem conteúdo sensível).

## Público-alvo
Adultos que gerenciam finanças pessoais.

## Gráficos necessários
- Ícone de alta resolução: `public/icons/icon-512.png`
- Feature graphic 1024×500: gerar a partir do logo (`public/icons/`)
- Screenshots: dashboard, extrato, contas e orçamentos (capturar em
  Pixel 7 via Playwright: `npm run test:e2e` ou device real).

## Política de privacidade
Hospedar a URL de política de privacidade do deploy (ver docs/PRIVACY.md).
