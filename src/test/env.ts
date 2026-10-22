/** Troca variáveis de ambiente durante um teste e devolve a função que restaura. */
export function withEnv(values: Record<string, string | undefined>): () => void {
  const env = process.env as Record<string, string | undefined>;
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, env[key]]));
  const apply = (next: Record<string, string | undefined>) => {
    for (const [key, value] of Object.entries(next)) {
      if (value === undefined) delete env[key];
      else env[key] = value;
    }
  };
  apply(values);
  return () => apply(previous);
}
