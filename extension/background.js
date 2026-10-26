/**
 * Background service worker da extensão (MV3).
 *
 * Responsabilidades:
 * - Omnibox: palavra-chave "fin" abre o app (ou o extrato com busca).
 * - A URL base do app fica em chrome.storage (configurável na página de
 *   opções futura); default: mesma origem do deploy de produção.
 */

const DEFAULT_APP_URL = "https://my-fin.netlify.app";

async function getAppUrl() {
  const { appUrl } = await chrome.storage.sync.get({ appUrl: DEFAULT_APP_URL });
  return appUrl.replace(/\/$/, "");
}

chrome.omnibox.onInputEntered.addListener(async (text, disposition) => {
  const base = await getAppUrl();
  const target = text.trim()
    ? `${base}/transactions?search=${encodeURIComponent(text.trim())}`
    : base;
  if (disposition === "currentTab") {
    await chrome.tabs.update({ url: target });
  } else {
    await chrome.tabs.create({ url: target, active: disposition !== "newBackgroundTab" });
  }
});

chrome.omnibox.onInputChanged.addListener((text, suggest) => {
  suggest([
    {
      content: text || " ",
      description: text
        ? `Buscar "${text}" no extrato do My-Fin`
        : "Abrir o My-Fin",
    },
  ]);
});
