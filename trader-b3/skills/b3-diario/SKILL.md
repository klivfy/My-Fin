---
name: b3-diario
description: 'Diário de operações do pacote trader-b3 (B3 + XP): registra a operação feita fora do b3-ticket com custos reais, calcula métricas honestas (acerto, payoff, expectativa em R$ e em R, maior sequência de perdas, maior queda acumulada, por setup, classe, estilo e emoção, com INCONCLUSIVO abaixo de 30), mostra o que o diário comprova sobre a fase (4 semanas de simulador; 30 day trades simulados com expectativa positiva para a fase 3) e estima o IR do mês por modalidade, com isenção de ações no swing, prejuízo acumulado no mesmo grupo e DARF mínimo. Lê e grava trader/diario.csv. Use quando o usuário disser "registra essa operação", "como estou indo?", "minhas estatísticas", "qual minha taxa de acerto?", "minha expectativa", "posso ir para a fase 2?", "quanto de IR eu pago?", "DARF", "prejuízo a compensar", ou depois de fechar uma operação no b3-ticket.'
metadata:
  argument-hint: "registrar --ativo X --entrada P --stop S --saida P --quantidade N [...] | metricas [--modo simulado|real|todos] | fase | ir --mes AAAA-MM [--modo real|simulado]"
---

# b3-diario

O diário é a única prova do método. Cada operação fechada, simulada ou real,
vira uma linha com custos reais; os limites do b3-risco e a passagem de fase
são lidos daqui. Absorve o trader-journal do original.

`${CLAUDE_SKILL_DIR}` é a pasta desta skill. No Windows, use `python` ou `py`.

```bash
python3 "${CLAUDE_SKILL_DIR}/diario.py" registrar --ativo BBAS3 --entrada 17.20 --stop 16.42 --saida 18.76 \
    --quantidade 6 --data 2026-11-12 --data-entrada 2026-11-09 --setup repique --motivo alvo --emocao calmo
python3 "${CLAUDE_SKILL_DIR}/diario.py" metricas --modo todos
python3 "${CLAUDE_SKILL_DIR}/diario.py" fase
python3 "${CLAUDE_SKILL_DIR}/diario.py" ir --mes 2026-11
```

## Regras

| tema | regra |
| --- | --- |
| registro | o b3-ticket grava a saída executada; `registrar` é para papel ou conta demo. Exige stop abaixo da entrada; day trade entra e sai no mesmo dia |
| custos | corretagem do config e emolumentos da referência, mesmo no simulado |
| modos | simulado e real nunca se misturam nas métricas, nos limites nem no IR |
| métricas | menos de 30 operações: INCONCLUSIVO, também por setup, classe e estilo |
| fase | o config declara; o diário comprova. Mudar de fase é decisão do usuário no config |
| IR | grupos de compensação: comum (swing de ações, BDR e opções), day trade e FII. Ações no swing com vendas no mês até o limite da referência: lucro isento. Prejuízo só compensa no mesmo grupo. Imposto abaixo do DARF mínimo acumula para o mês seguinte |
| fontes do IR | alíquotas, isenção, DARF e a pendência vêm de `referencia_b3.json`; a pendência é sempre impressa |

## Passos

1. Depois de cada saída, pergunte como o usuário estava (emoção) e se seguiu o
   plano; isso vai na nota.
2. `metricas --modo todos`. Leia primeiro o número de operações e o
   INCONCLUSIVO; só depois acerto, payoff e expectativa.
3. Compare a expectativa com os custos pagos: com R$ 4,90 por ordem, o custo
   costuma ser maior que o resultado bruto.
4. `fase` quando perguntarem sobre mudar de fase. Mostre o que falta, sem
   incentivar a pressa.
5. `ir --mes` só para o modo real (o simulado é exercício). Diga sempre que é
   estimativa e não substitui contador nem a nota.
6. Perdeu o limite do mês: lembre que o aporte extra de até R$ 100 exige revisão
   escrita das perdas antes.

## Exemplo real (diário depois do fluxo BBAS3; saída hipotética no alvo em 12/11/2026)

```
Modo simulado: 1 operações; resultado -R$ 0,50; custos pagos R$ 9,86.
  acerto 0,0%; ganho médio R$ 0,00; perda média -R$ 0,50; payoff indefinido
  expectativa -R$ 0,50 por operação (-0,107R); maior sequência de perdas 1; maior queda acumulada -R$ 0,50
  INCONCLUSIVO: 1 operações, menos de 30. Não conclua nada sobre o método ainda.

IR de 2026-11, modo simulado (exercício: simulado não paga imposto).
  acoes_swing         1 ops; vendas R$ 112,56; resultado líquido -R$ 0,50
Prejuízo a compensar: operações comuns (swing) -R$ 0,50. Só na mesma modalidade: ...
```

A operação acertou o alvo e ainda assim entrou como perda: R$ 9,36 de lucro
bruto contra R$ 9,86 de custos.

## O que nunca faz

Nunca envia ordem, nunca apaga ou reescreve linhas do diário, nunca mistura
simulado com real, nunca apresenta menos de 30 operações como conclusão, nunca
muda a fase sozinho, nunca substitui contador nem a nota de corretagem, nunca
pede CPF, senha ou dado bancário e nunca diz comprar ou vender.

Material educacional; não é recomendação de investimento.
