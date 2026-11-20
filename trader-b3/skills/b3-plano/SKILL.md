---
name: b3-plano
description: 'Planeja a operação ANTES da entrada no pacote trader-b3 (B3 + XP): gatilho só em barra fechada acima do nível (diária no swing, 5 min no day), stop por fundo, percentual, preço, ATR ou faixa de abertura, alvo em R (padrão 2R), arredondamento ao tick de R$ 0,01, prazo do swing em pregões com eventos no prazo, e horário de zerar do day trade. Recusa stop acima da entrada, alvo abaixo, risco menor que 0,3% do preço, custo que derruba o reward:risk abaixo de 1,5 e entrada fora da janela. Grava trader/plan.json. Substitui a skill trader-b3-plano-saida. Use quando o usuário disser "onde ponho o stop?", "planejar a saída", "stop e alvo", "quanto arrisco por ação?", "qual o meu R?", "plano para BBAS3", "o setup disparou?", "rompeu o nível?", "até quando seguro o swing?", ou logo depois do b3-scanner e do b3-noticias, antes do b3-replay.'
metadata:
  argument-hint: "plano --ticker X --entrada P --stop fundo:X|pct:X|preco:X|atr:K|or-mid [--alvo 2R] [--estilo swing|day]"
---

# b3-plano

O stop é onde o setup falhou; o alvo é o que você veio buscar. Os dois são
escritos antes da entrada para ninguém decidir nada no meio de um movimento.
Absorve a metodologia da skill `trader-b3-plano-saida` e a do trader-entry e
trader-exit do original, com regras da B3.

`${CLAUDE_SKILL_DIR}` é a pasta desta skill. No Windows, use `python` ou `py`.

```bash
python3 "${CLAUDE_SKILL_DIR}/plano.py" gatilho BBAS3 --nivel 16.90 --data 2026-11-06
python3 "${CLAUDE_SKILL_DIR}/plano.py" plano --ticker BBAS3 --entrada 17.20 --stop fundo:16.43 --setup repique --write
python3 "${CLAUDE_SKILL_DIR}/plano.py" plano --ticker BBAS3 --entrada 17.20 --stop atr:1.5 --prazo 10 \
    --evento "2026-11-13:resultado 3T26"
python3 "${CLAUDE_SKILL_DIR}/plano.py" plano --ticker PETR4 --estilo day --hora 10:30 --entrada 45.80 \
    --or-high 45.70 --or-low 45.20 --write
python3 "${CLAUDE_SKILL_DIR}/plano.py" mostrar
```

## Regras

| tema | regra |
| --- | --- |
| lado | só compra |
| gatilho | barra FECHADA acima do nível: fechamento diário oficial no swing; barra de 5 min dentro da janela no day. Pavio acima não conta |
| stop | `fundo:X` um tick abaixo do fundo; `pct:X`; `preco:X`; `atr:K` (ATR 14 diário no swing, de 5 min no day com `--barras`); `or-mid` e `or-low` da faixa 10:00 a 10:15 (day) |
| arredondamento | stop para baixo no tick; alvo meio para cima |
| alvo | `2R` padrão, `1.5R`, `3R` ou `preco:X` |
| recusas | stop maior ou igual à entrada; alvo menor ou igual; risco abaixo de 0,3% do preço; reward:risk bruto abaixo de 1,5; quantidade zero ou reward:risk líquido abaixo de 1,5 depois dos custos; day fora da janela (10:15 a 17:15); dia sem calendário ou grade |
| day trade | zerar até o horário do b3-relogio (17:40 hoje), ganhe ou perca |
| swing | sai no stop, no alvo ou no fechamento do último pregão do prazo (padrão 10); lista vencimento de opções e os eventos passados em `--evento` |
| custo alto | no modo simulado com `"custo_alto_no_simulado": "avisar"`, a recusa por custo vira aviso "na conta real seria BLOQUEADO"; o tamanho ignora a corretagem e o diário registra os custos reais |

## Passos

1. Rode `gatilho` primeiro. Disparar não é comprar.
2. Antes de planejar swing, rode o b3-noticias e passe com `--evento` cada data
   de resultado ou data-com que cair no prazo.
3. Escolha o stop com o usuário. Para setup de nível, ele precisa dizer o stop;
   sugira `fundo:` com o fundo relevante que ele apontar.
4. `plano --write`. Leia entrada, stop e regra, alvo, risco por ação, reward:risk
   bruto e líquido, quantidade prevista, saída e avisos.
5. Se recusar, diga o motivo e o que mudaria (stop mais longe, alvo mais longe,
   outro ativo). Nunca afrouxe regra por conta própria.
6. Diga uma vez: stop é plano, não garantia.
7. Próximo passo: b3-replay, depois b3-risco.

## Exemplo real (BBAS3, fechamento de 06/11/2026, modo simulado, corretagem R$ 4,90)

```
Plano BBAS3 swing (acao), 2026-11-09, compra, setup repique.
  Entrada       R$ 17,20 (ordem limitada)
  Stop          R$ 16,42  um tick abaixo do fundo 16,43
  Alvo          R$ 18,76  2R (entrada + 2 x risco)
  Risco/ação    R$ 0,78 (4,53% da entrada); reward:risk bruto 2,00
  Previsto      6 unidades (simulado, tamanho sem corretagem); perda no stop R$ 4,74 sem custos,
                R$ 14,60 com os custos reais; reward:risk líquido real -0,03
  Saída         stop, alvo ou fechamento do 10º pregão (2026-11-24)
Aviso: SIMULADO: na conta real este plano seria BLOQUEADO por custo (quantidade zero: R$ 0,78 de risco por
ação mais R$ 9,80 de corretagem de ida e volta não cabem no risco de R$ 5,00) ...
Aviso: eventos no prazo (risco de gap): 2026-11-19 vencimento mensal de opções sobre ações.
```

Leia o reward:risk líquido real de -0,03 em voz alta: com R$ 4,90 por ordem,
mesmo acertando o alvo esta operação perderia dinheiro depois dos custos.

## O que nunca faz

Nunca envia ordem, nunca dimensiona sozinho para executar (isso é do b3-risco),
nunca afasta o stop depois da entrada, nunca encolhe o stop para caber no risco,
nunca planeja venda a descoberto, nunca chama stop de garantia e nunca diz
comprar ou vender.

Material educacional; não é recomendação de investimento.
