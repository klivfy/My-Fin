# trader-b3: regras para agentes

Este diretório é o pacote de skills trader-b3 (B3 + XP). As instruções de
Next.js do `AGENTS.md` da raiz não se aplicam aqui.

* Python 3.10+, só biblioteca padrão. Nenhuma dependência externa.
* Nenhum caminho de código envia ordem ou lê credencial de corretora.
* Limites do perfil vêm de `trader/config.json`; fatos voláteis (horários,
  feriados, custos, IR, endpoints) vêm de `referencia_b3.json`. Nada disso
  fica fixo no código.
* `comum/b3comum.py` é a fonte única do módulo compartilhado. Cada skill em
  `skills/` leva uma cópia idêntica porque precisa rodar sozinha quando
  instalada em `~/.claude/skills/`. Altere a fonte e copie para todas.
* A pasta `trader/` (dados pessoais) nunca é versionada.
