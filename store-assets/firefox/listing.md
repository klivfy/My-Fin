# Listagem — Firefox Add-ons (addons.mozilla.org)

## Nome
My-Fin

## Resumo (máx. 250 caracteres)
Atalho para o My-Fin, seu gerenciador financeiro pessoal: abra o app pelo
popup, busque no extrato digitando "fin" na barra de endereço e configure a
URL do seu deploy self-hosted.

## Descrição
Extensão launcher do My-Fin (gerenciador financeiro pessoal open source):

• Popup com acesso rápido ao app, nova transação e orçamentos.
• Omnibox: digite "fin" + Tab para abrir o app ou buscar no extrato.
• URL do app configurável (self-hosted ou o deploy oficial).
• Nenhum dado financeiro passa pela extensão: ela apenas abre o app —
  toda a lógica e os dados ficam no seu servidor.

Permissões: apenas `storage` (para lembrar a URL do app). Sem rastreamento,
sem analytics, código aberto.

## Categoria
Privacidade e Segurança / Ferramentas

## Empacotamento
```bash
# Gera myfin-firefox.zip com o manifest adaptado (browser_specific_settings)
node scripts/package-extension.mjs firefox
```

## Revisão do AMO
- Código-fonte: este repositório (a extensão é JS puro, sem build/minify —
  revisão rápida).
- Ícones 48/96/128 já incluídos em `extension/icons/`.
