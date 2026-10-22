"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { safeNextPath } from "@/lib/safe-redirect";

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
    if (response.status === 429) {
      setError("Muitas tentativas. Aguarde alguns minutos e tente de novo.");
      return;
    }
    if (!response.ok) {
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
