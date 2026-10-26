# Política de Segurança

## Escopo

My-Fin é um PFM (gerenciador financeiro pessoal) single-tenant, pensado para
uso local ou deploy próprio. Não é um serviço multi-usuário: não há contas de
usuário, perfis ou isolamento por tenant.

## Reportando vulnerabilidades

Se você encontrou uma vulnerabilidade de segurança, **não abra uma issue
pública**. Use o canal privado do GitHub:

- **Security Advisories**: abra um relatório em
  `https://github.com/klivfy/My-Fin/security/advisories/new`

Inclua, se possível: descrição do problema, passos de reprodução, impacto
potencial e sugestão de correção. Você receberá uma resposta com a triagem e
o plano de correção.

## O que o gate de acesso protege (e o que não protege)

Quando `APP_ACCESS_TOKEN` está definido (obrigatório em deploy público):

- Middleware exige cookie de sessão `__Host-myfin_access` (token derivado por
  HMAC do segredo — o segredo nunca fica no navegador) ou header
  `Authorization: ******
- A comparação de credenciais é feita em tempo constante
  (`crypto.timingSafeEqual` sobre hashes SHA-256).
- `/api/login` tem rate limiting por IP com backoff exponencial (HTTP 429).
- Toda Server Action revalida a credencial via `assertAuthorized()` —
  defesa em profundidade caso o middleware deixe passar uma rota nova.
- Respostas carregam CSP, `X-Content-Type-Options`, `frame-ancestors 'none'`,
  `Referrer-Policy` restritiva, `Permissions-Policy` e HSTS (produção).

Limitações conhecidas:

- **Não é autenticação multi-fator nem por usuário**: qualquer pessoa com o
  token tem acesso total. Trate o token como senha mestra.
- O rate limit é em memória (por instância serverless): reduz brute force
  online, mas um atacante distribuído pode contorná-lo. Use um token longo
  e aleatório (32+ caracteres).
- A sessão não é revogável individualmente: trocar `APP_ACCESS_TOKEN`
  invalida todas as sessões de uma vez (o token derivado muda).
- Dados em trânsito dependem de HTTPS do provedor de hospedagem; dados em
  repouso dependem do provedor de banco (Supabase/Neon).

## Boas práticas ao hospedar

1. Sempre defina `APP_ACCESS_TOKEN` longo e aleatório em deploy público.
2. Use `DATABASE_URL` com connection pooling e TLS (`sslmode=require`).
3. Nunca commite `.env` — o repositório já ignora `.env*` via `.gitignore`.
4. Mantenha dependências atualizadas (Dependabot + `npm audit` rodam no CI).
