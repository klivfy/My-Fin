# trader-b3

Pacote de Claude Skills para estudo e operação disciplinada na B3 pela XP
Investimentos. Copiloto de disciplina: encontra setups, planeja entrada e
saída, simula, dimensiona, bloqueia o que viola os limites do perfil e gera
um ticket para digitação manual. Nada aqui envia ordem.

Fluxo:

```
b3-relogio -> b3-scanner -> b3-noticias -> b3-plano -> b3-replay -> b3-risco -> b3-ticket -> b3-diario
```

## Estrutura

| caminho | conteúdo |
| --- | --- |
| `comum/b3comum.py` | fonte única do módulo compartilhado |
| `skills/<nome>/` | uma skill por pasta: `SKILL.md`, script `.py` e cópia de `b3comum.py` |
| `skills/b3-relogio/referencia_b3.json` | fatos voláteis com fonte e data (grade, feriados, custos, IR, endpoints) |
| `skills/b3-relogio/config.example.json` | modelo dos limites do perfil |

## Uso

Instale cada pasta de `skills/` em `~/.claude/skills/` (ou `.claude/skills/`
do projeto). Numa pasta de trabalho:

```bash
python3 ~/.claude/skills/b3-relogio/relogio.py init     # cria trader/config.json e trader/referencia_b3.json
python3 ~/.claude/skills/b3-relogio/relogio.py status
```

Os dados ficam em `trader/` na pasta de trabalho e nunca são versionados.

## Estado

Importado das skills da conta Claude em 18/11/2026, sem mudança de lógica.
Próximas etapas: script de sincronização do `b3comum.py`, testes `unittest`
offline, job de CI e empacotamento das skills.

Material educacional; não é recomendação de investimento.
