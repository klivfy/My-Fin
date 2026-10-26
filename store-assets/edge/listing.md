# Listagem — Microsoft Edge Add-ons

## Nome
My-Fin

## Descrição curta
Atalho para o seu gerenciador financeiro pessoal: app, extrato e orçamentos
a um clique — e busca no extrato pela barra de endereço ("fin" + Tab).

## Descrição
Extensão launcher do My-Fin:

• Popup com acesso rápido (app, nova transação, orçamentos).
• Omnibox "fin": abre o app ou busca direto no extrato.
• URL do app configurável (self-hosted ou deploy oficial).
• Sem telemetria, sem rastreamento; a extensão só abre páginas do app —
  os dados financeiros nunca passam por ela.

## Empacotamento
```bash
# Gera dist/myfin-chromium.zip (mesmo pacote serve na Chrome Web Store)
node scripts/package-extension.mjs chromium
```

## Observações
- Manifest V3 (service worker de background) — requisito atual da loja.
- Permissões mínimas: `storage` somente.
- Mesma listagem serve para Chrome Web Store (mesmo ZIP).
