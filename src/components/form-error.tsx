import { AlertCircle } from "lucide-react";

/**
 * Erro de formulário escrito na tela (DESIGN.md: erro nunca só em toast que
 * some, nunca só cor). Some quando `message` é nulo.
 */
export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="flex items-start gap-2 text-sm text-expense">
      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      {message}
    </p>
  );
}
