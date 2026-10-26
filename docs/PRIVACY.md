# Política de Privacidade — My-Fin

**Última atualização: outubro de 2026**

## Resumo

O My-Fin é um gerenciador financeiro pessoal (PFM) de código aberto e
**auto-hospedado**: os seus dados financeiros ficam no banco de dados que
VOCÊ (ou o administrador do seu deploy) controla. Não há telemetria,
analytics, rastreamento ou envio de dados a terceiros embutido no software.

## Dados coletados

- **Dados financeiros** (contas, transações, faturas, orçamentos, metas):
  inseridos por você ou importados de extratos (OFX/CSV) que você envia.
  Armazenados no banco PostgreSQL configurado pelo deploy.
- **Logs de sincronização e auditoria**: registros técnicos de importações e
  ações (o quê, quando, qual entidade) para depuração e trilha de auditoria.
- **Cookie de sessão**: token derivado criptograficamente, usado apenas para
  autenticação (quando `APP_ACCESS_TOKEN` está configurado).

## O que NÃO fazemos

- Não vendemos, compartilhamos ou alugamos dados.
- Não há analytics de terceiros, pixels de rastreamento ou fingerprinting.
- A extensão de navegador não lê páginas nem envia dados — apenas abre o app.
- Dados financeiros nunca são servidos de cache offline (service worker
  armazena apenas assets estáticos).

## Integrações opcionais

- **API do Banco Inter**: quando configurada por você (credenciais suas, em
  variáveis de ambiente), o app consulta seu extrato diretamente — as
  credenciais nunca saem do seu servidor.
- **Hospedagem** (Netlify ou outro) e **banco** (Supabase/Neon ou outro):
  regidos pelas políticas de privacidade dos respectivos provedores
  escolhidos por quem hospeda.

## Retenção e exclusão

Os dados permanecem enquanto o deploy existir. Excluir transações, contas
(desativar) ou o banco inteiro é decisão do administrador do deploy. O backup
JSON (exportação) permite portabilidade total a qualquer momento.

## Segurança

Ver [SECURITY.md](../SECURITY.md): autenticação por token, comparação em
tempo constante, rate limiting, headers de segurança e auditoria de ações
destrutivas.

## Contato

Abra um Security Advisory no repositório (canal privado) para questões de
privacidade e segurança.
