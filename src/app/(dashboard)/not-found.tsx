import Link from "next/link";

export default function DashboardNotFound() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-on-surface">Página não encontrada</h2>
        <p className="text-sm text-on-surface-variant">
          O recurso que você procurou não existe ou foi movido.
        </p>
      </div>
      <Link href="/" className="text-sm font-medium text-primary hover:underline">
        Voltar ao Dashboard
      </Link>
    </div>
  );
}
