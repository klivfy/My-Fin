"use client";

import { useEffect } from "react";

/**
 * Registra o service worker e telemetria de instalação do PWA.
 *
 * - Registro só em produção: em dev o SW atrapalharia o HMR.
 * - `appinstalled` é logado de forma estruturada (mesmo padrão do logger do
 *   servidor) — ponto de extensão futuro para analytics opt-in.
 */
export function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Falha de registro não deve afetar o uso do app.
    });

    const onInstalled = () => {
      console.info(
        JSON.stringify({ level: "info", msg: "pwa.installed", at: new Date().toISOString() }),
      );
    };
    window.addEventListener("appinstalled", onInstalled);
    return () => window.removeEventListener("appinstalled", onInstalled);
  }, []);

  return null;
}
