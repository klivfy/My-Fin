# My-Fin multiplataforma

O app é um **PWA** (Progressive Web App) — uma única base de código cobre Web,
Windows, Android, iOS/iPadOS e extensões de navegador. Este guia consolida os
passos de empacotamento por plataforma.

## Web 100% (baseline)

Deploy no Netlify (já configurado). Com o PWA ativo:

- **Instalável** em Chrome/Edge (desktop e Android) e Firefox (desktop) —
  botão de instalação na barra de endereço.
- **iOS/iPadOS**: Safari → Compartilhar → "Adicionar à Tela de Início".
- Manifest: `public/manifest.webmanifest` · Service worker: `public/sw.js`
  (apenas assets estáticos em cache; dados financeiros sempre da rede).
- Requisitos de navegador: Chrome/Edge 90+, Firefox 109+, Safari 16.4+.

## Windows 10/11 (Microsoft Store, opcional)

1. Com o app publicado em HTTPS, abra <https://www.pwabuilder.com> e aponte
   a URL de produção.
2. Gere o pacote **Windows** (`.msix`) — o PWABuilder valida o manifest e os
   ícones maskable (já incluídos).
3. Publique no Partner Center (Microsoft Store). Os `shortcuts` do manifest
   viram jump list da taskbar automaticamente.

## Android (Play Store via TWA)

Requer HTTPS + Digital Asset Links.

1. Gere a keystore de assinatura e extraia o SHA-256:
   `keytool -list -v -keystore myfin.keystore`.
2. Atualize `public/.well-known/assetlinks.json` com o fingerprint.
3. `npm i -g @bubblewrap/cli && bubblewrap init --manifest https://<seu-dominio>/manifest.webmanifest`
   depois `bubblewrap build` → gera o `.aab`.
4. Publique na Play Console (conta de desenvolvedor). minSdk 24 (Android 8+).

## iOS / iPadOS

**Caminho sem loja (gratuito, recomendado)**: o app já entrega a experiência
completa via "Adicionar à Tela de Início" — ícone, tela cheia, safe-areas
(notch) tratadas via `viewport-fit=cover` + utilitários `*-safe` no CSS.

**Caminho com loja (pago, Apple Developer)**: wrapper Capacitor
(`@capacitor/ios`) carregando a URL remota. Atenção: a Apple pode rejeitar
"site embrulhado" sem valor nativo — agregue algo (Face ID, haptics) se
seguir por aqui.

## Extensões (Chrome, Edge, Firefox)

Código em `extension/` (Manifest V3):

- **Popup** com links rápidos e URL do app configurável.
- **Omnibox**: digite `fin` + Tab na barra de endereço para abrir o app ou
  buscar no extrato.
- **Firefox**: use `manifest.firefox.json` (renomeie para `manifest.json` ao
  empacotar) — inclui `browser_specific_settings.gecko` (mín. Firefox 109).

Publicação:

- Chrome Web Store: `chrome://extensions` → modo dev para testar; loja via
  ZIP do diretório.
- Edge Add-ons: mesmo pacote do Chrome.
- Firefox Add-ons: `web-ext build` (ou ZIP) com o manifest adaptado.

## Offline

O app é online-first: sem rede, o service worker mostra `/offline`
(informativo). Dados financeiros nunca são servidos de cache.
