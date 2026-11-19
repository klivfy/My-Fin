-- Supabase expõe o schema `public` pela Data API (PostgREST). Sem RLS,
-- qualquer tabela daqui fica legível e gravável por quem tiver a chave
-- `anon` do projeto. O app não usa a Data API: fala com o banco só pelo
-- Prisma, com o dono das tabelas, que ignora RLS (não usamos FORCE).
--
-- Ligar RLS sem nenhuma policy fecha a Data API (anon e authenticated não
-- veem nada) e não muda nada para o Prisma. Em Postgres local, sem
-- Supabase, o efeito é o mesmo: o dono continua com acesso total.
--
-- Toda tabela nova precisa de `ENABLE ROW LEVEL SECURITY` na própria
-- migração; o CI falha se alguma tabela de `public` ficar sem RLS.
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END
$$;
