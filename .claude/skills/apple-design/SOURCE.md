# Origem desta skill

- Repositório: https://github.com/dickwu/apple-design-skill
- Commit instalado: `904b0eedc7cc778152f545506075d5bb5219ce77` (`904b0ee fix: update links for custom symbols in HIG documentation`)
- Instalada em: 2026-10-11, por cópia manual (o método "à mão" do README do autor, sem `npx skills`)
- Uso: `/apple-design` no Claude Code, ou pedidos de revisão de design/UI.

## O que foi copiado e o que não foi

Copiados: `SKILL.md`, `README.md`, `references/` (124 arquivos: 123 páginas do HIG + `liquid-glass.md`, mais `hig-lookup.md` e `cross-platform.md`) e `scripts/pull-hig.mjs`.

Não copiados: `.git`, `.gitignore`, `.cursorrules` (ponto de entrada do Cursor) e `AGENTS.md` (manual de contribuição do repositório do autor — dentro de `.claude/skills/` ele poderia ser lido como regra deste projeto).

## Revisão feita antes de instalar

Lidos por inteiro: `SKILL.md`, `README.md`, `AGENTS.md`, `.cursorrules` e `scripts/pull-hig.mjs`; varredura por padrões suspeitos (injeção de instruções, execução de comandos, credenciais, exfiltração) em todos os arquivos, sem ocorrências além de vocabulário de design ("token", "password"). O único script só faz GET em páginas públicas do `developer.apple.com` e escreve em `references/`; não executa nada baixado. Não há hooks nem arquivos executáveis.

## Licença e direitos — leia antes de redistribuir

- O repositório do autor **não tem arquivo de licença**. O README diz apenas que "o texto das diretrizes pertence à Apple Inc." e que o restante é fornecido "como está".
- `references/hig/` reproduz o texto do Human Interface Guidelines, da Apple, com link de origem no topo de cada arquivo. Este projeto não tem afiliação com a Apple.
- Tratar como material de uso interno de revisão de design. Se o repositório for público ou redistribuído, avalie se manter uma cópia do texto da Apple é aceitável; a alternativa é não versionar `references/hig/` e regenerá-lo localmente com `node scripts/pull-hig.mjs`.

## Atualizar

```
node .claude/skills/apple-design/scripts/pull-hig.mjs      # Node 18+, ~170 requisições a developer.apple.com
```
Depois, revise `git diff --stat` antes de commitar (o script apaga páginas que a Apple removeu).
