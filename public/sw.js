/* Service Worker mínimo — installability + tela offline (JavaScript puro,
 * servido estaticamente de /public — nunca TypeScript aqui).
 *
 * Filosofia: o app é ONLINE-FIRST (dados financeiros vêm sempre da rede;
 * nunca servimos dados financeiros de cache potencialmente velhos). O SW só
 * faz:
 *  1. pré-cache do shell estático ("/offline");
 *  2. navegação: network-first com fallback para "/offline";
 *  3. assets `/_next/static` e ícones: cache-first (imutáveis por build).
 *
 * Nada de cache de respostas de páginas/API: evita servir saldo desatualizado.
 */

const VERSION = "v1";
const STATIC_CACHE = `myfin-static-${VERSION}`;
const OFFLINE_URL = "/offline";

const PRECACHE = [OFFLINE_URL, "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== STATIC_CACHE).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Assets imutáveis de build: cache-first.
  if (url.pathname.startsWith("/_next/static") || url.pathname.startsWith("/icons")) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          const clone = response.clone();
          caches.open(STATIC_CACHE).then((cache) => cache.put(request, clone));
          return response;
        });
      }),
    );
    return;
  }

  // Navegações: network-first com fallback offline.
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL)));
  }
});
