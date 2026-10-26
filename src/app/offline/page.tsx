import { WifiOff } from "lucide-react";

export const metadata = { title: "Offline — My-Fin" };

/** Fallback do service worker quando a navegação falha sem rede. */
export default function OfflinePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-surface-dim p-8 text-center">
      <WifiOff className="size-10 text-on-surface-variant" />
      <div className="space-y-1">
        <h1 className="text-lg font-semibold text-on-surface">Você está offline</h1>
        <p className="max-w-sm text-sm text-on-surface-variant">
          O My-Fin precisa de conexão para ler e gravar seus dados financeiros. Reconecte-se e tente
          novamente.
        </p>
      </div>
    </main>
  );
}
