# Roadmap técnico contínuo

## CSP estrita com nonce (hoje: CSP estática)

A CSP atual (`next.config.ts`) usa `'unsafe-inline'` em `script-src` porque o
boot do App Router injeta scripts inline (Flight) e o deploy no Netlify serve
rotas estáticas — sem nonce por request. Para migrar para CSP estrita:

1. Tornar as rotas do dashboard 100% dinâmicas (já são `force-dynamic` no
   layout; falta o mesmo para `/login`).
2. Gerar nonce no proxy/edge por request e repassar via header `x-nonce`.
3. `script-src 'self' 'nonce-…' 'strict-dynamic'` e `style-src 'self'
   'nonce-…'`.
4. Validar com <https://csp-evaluator.withgoogle.com>.

Referência: `node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md`
(guia oficial com exemplo de proxy + nonce).

## Observabilidade avançada (opcional)

- Os logs das Server Actions já saem estruturados (JSON, `src/lib/logger.ts`)
  com correlação por `action`/`syncLogId`/`entityId`.
- Para captura de exceções em produção: Sentry self-hosted ou equivalente —
  instalar o SDK só quando houver backend de destino (evita dependência
  ociosa e dados saindo para terceiros sem necessidade).
