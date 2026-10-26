# My-Fin — Android (TWA / Play Store)

Este diretório contém a configuração do **Trusted Web Activity** que empacota
o PWA para a Play Store via [Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap).

## Pré-requisitos

1. App em produção com HTTPS (ex.: `https://my-fin.netlify.app`).
2. JDK 17+ e Android SDK (o Bubblewrap oferece instalar ambos).
3. Keystore de assinatura do app (guardar com segurança — a perda impede
   futuras atualizações na Play Store).

## Passos

```bash
# 1. Instale a CLI
npm install -g @bubblewrap/cli

# 2. Ajuste `twa-manifest.json`: `host`, URLs absolutas dos ícones e
#    `packageId` definitivos.

# 3. Gere a keystore (uma vez) — NÃO commitar
keytool -genkeypair -v -keystore myfin.keystore -alias myfin \
  -keyalg RSA -keysize 2048 -validity 10000

# 4. Extraia o SHA-256 e atualize public/.well-known/assetlinks.json
keytool -list -v -keystore myfin.keystore -alias myfin | grep SHA256

# 5. Inicialize e construa
bubblewrap init --manifest ./twa-manifest.json
bubblewrap build        # gera app-release-signed.apk / .aab

# 6. Valide o TWA
bubblewrap install      # instala num device/emulador conectado
```

## Play Console

- Faça upload do `.aab` (Android App Bundle).
- minSdk 24 (Android 8.0+) — cobre ~98% dos devices ativos.
- A listagem (descrição, screenshots) está em `store-assets/play/`.
- O `assetlinks.json` precisa estar acessível em
  `https://<host>/.well-known/assetlinks.json` **antes** de abrir o app —
  sem ele o TWA cai para Custom Tabs com barra de URL visível.
