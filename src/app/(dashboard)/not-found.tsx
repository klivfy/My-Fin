import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export default function DashboardNotFound() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-start gap-3 px-4 py-16">
      <h1 className="text-xl font-semibold tracking-tight">Página não encontrada</h1>
      <p className="text-sm text-on-surface-variant">O endereço não existe ou o item foi excluído.</p>
      <Link href="/" className={buttonVariants()}>Ir para a visão geral</Link>
    </div>
  );
}
