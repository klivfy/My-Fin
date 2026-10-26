/** Popup da extensão: links rápidos + configuração da URL base do app. */

const DEFAULT_APP_URL = "https://my-fin.netlify.app";

async function getAppUrl() {
  const { appUrl } = await chrome.storage.sync.get({ appUrl: DEFAULT_APP_URL });
  return appUrl.replace(/\/$/, "");
}

async function init() {
  const base = await getAppUrl();
  document.getElementById("open-app").href = `${base}/`;
  document.getElementById("open-new").href = `${base}/transactions`;
  document.getElementById("open-budgets").href = `${base}/budgets`;

  const input = document.getElementById("app-url");
  input.value = base;
  input.addEventListener("change", async () => {
    const value = input.value.trim() || DEFAULT_APP_URL;
    await chrome.storage.sync.set({ appUrl: value });
    init();
  });
}

document.querySelectorAll("a.link").forEach((anchor) => {
  anchor.addEventListener("click", (event) => {
    event.preventDefault();
    chrome.tabs.create({ url: anchor.href });
  });
});

init();
