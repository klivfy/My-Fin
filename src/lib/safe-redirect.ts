/**
 * Destino pós-login vindo de `?next=`: só aceita caminho interno do app.
 * URL absoluta (`https://...`), protocolo relativo (`//host`), barra
 * invertida (`/\host`, que navegadores tratam como `//`) e caracteres de
 * controle voltam para `/`, fechando o redirecionamento aberto.
 */
export function safeNextPath(value: string | null | undefined): string {
  if (!value || !value.startsWith("/")) return "/";
  if (value.startsWith("//") || value.startsWith("/\\")) return "/";
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return "/";
  return value;
}
