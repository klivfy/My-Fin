"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function safeNextPath(value: string | null): string {
  // Aceita apenas caminhos internos absolutos: bloqueia URLs externas
  // ("https://…") e protocol-relative ("//evil.com") — open redirect.
  if (value && value.startsWith("/") && !value.startsWith("//")) return value;
  return "/";
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const response = await fetch("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });
    if (!response.ok) {
      if (response.status === 429) {
        const payload = (await response.json().catch(() => null)) as { retryAfterSeconds?: number } | null;
        const wait = payload?.retryAfterSeconds;
        setError(
          wait && wait > 0
            ? `Muitas tentativas. Aguarde ${wait}s antes de tentar novamente.`
            : "Muitas tentativas. Aguarde um pouco antes de tentar novamente.",
        );
        return;
      }
      setError("Token inválido.");
      return;
    }
    router.replace(safeNextPath(searchParams.get("next")));
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="mx-auto flex w-full max-w-sm flex-col gap-4 p-8">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">My-Fin</h1>
        <p className="text-sm text-muted-foreground">
          Informe o token de acesso configurado em <code>APP_ACCESS_TOKEN</code>.
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="token">Token</Label>
        <Input
          id="token"
          type="password"
          autoComplete="current-password"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          required
        />
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <Button type="submit">Entrar</Button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="flex min-h-full items-center justify-center">
      <Suspense fallback={<p className="p-8 text-sm text-muted-foreground">Carregando…</p>}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
