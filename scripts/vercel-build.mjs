// Build da Vercel (vercel.json -> buildCommand).
//
// Produção: aplica as migrações pendentes (`prisma migrate deploy`, via
// DIRECT_URL) e só então gera o build. Se a migração falhar, o deploy falha
// e a versão anterior continua no ar: o código novo nunca roda contra um
// schema velho.
//
// Preview e desenvolvimento: só o build. Um preview nunca altera o banco,
// mesmo que alguém aponte as variáveis de Preview para o banco de produção.
import { spawnSync } from "node:child_process";

function run(cmd, args) {
  console.log(`> ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const env = process.env.VERCEL_ENV ?? "development";

if (env === "production") {
  if (!process.env.DIRECT_URL) {
    console.error("DIRECT_URL não configurada: o deploy de produção precisa dela para migrar o banco.");
    process.exit(1);
  }
  run("npx", ["prisma", "migrate", "deploy"]);
} else {
  console.log(`VERCEL_ENV=${env}: migrações puladas (só produção migra o banco).`);
}

run("npx", ["next", "build"]);
