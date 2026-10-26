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
- **Firefox**: o pacote gerado já troca o manifest pelo adaptado
  (`browser_specific_settings.gecko`, mín. Firefox 109).

Empacotamento (sem dependências — ZIP gerado por script):

```bash
npm run extension:package
# → dist/myfin-chromium.zip (Chrome Web Store + Edge Add-ons)
# → dist/myfin-firefox.zip  (Firefox Add-ons / AMO)
```

Publicação:

- **Chrome Web Store**: teste local em `chrome://extensions` (modo dev,
  "carregar sem compactação" apontando para `extension/`); suba o ZIP na loja.
- **Edge Add-ons**: mesmo ZIP do Chromium no Partner Center.
- **Firefox Add-ons**: suba `myfin-firefox.zip` no AMO — código JS puro, sem
  minificação, revisão rápida.

## Checklist de release por loja

### Play Store (Android)
- [ ] Deploy em produção com HTTPS e domínio definitivo.
- [ ] `twa/twa-manifest.json` com `host`/`packageId` definitivos.
- [ ] Keystore gerada (fora do git) e SHA-256 em `public/.well-known/assetlinks.json` acessível publicamente.
- [ ] `bubblewrap build` → `.aab` assinado.
- [ ] Listagem de `store-assets/play/listing.md` + feature graphic (gerado) + screenshots.
- [ ] URL da política de privacidade (hospedar `docs/PRIVACY.md`).

### Microsoft Store (Windows)
- [ ] PWABuilder sobre a URL de produção → `.msixbundle`.
- [ ] Partner Center: novo app + upload do pacote + listagem de `store-assets/microsoft/listing.md`.

### Edge Add-ons / Chrome Web Store
- [ ] `npm run extension:package` → subir `dist/myfin-chromium.zip`.
- [ ] Listagem de `store-assets/edge/listing.md`.

### Firefox Add-ons (AMO)
- [ ] `npm run extension:package` → subir `dist/myfin-firefox.zip`.
- [ ] Listagem de `store-assets/firefox/listing.md`.

## Offline

O app é online-first: sem rede, o service worker mostra `/offline`
(informativo). Dados financeiros nunca são servidos de cache.
