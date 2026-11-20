---
name: b3-risco
description: 'Guardião dos limites do PERFIL no pacote trader-b3 (B3 + XP): dimensiona a entrada do trader/plan.json (menor entre risco de R$ 5 com custos e deslizamento, posição máxima de 40% e caixa acima de 5%, sufixo F abaixo de 100 ações) e devolve APROVADO ou BLOQUEADO com o motivo, aplicando 11 regras: stop, custo desconhecido, perda acima do risco, reward:risk líquido abaixo de 1,5, perda do dia, 3 entradas, limite mensal com pausa, janela e calendário, proibidos, fase verificada pelo diário e quantidade zero. Saída de posição existente nunca é bloqueada. Grava trader/orders.json com fingerprint e trader/state/risk.json. Substitui a skill trader-b3-risco-tamanho. Use quando o usuário disser "quantas ações eu compro?", "posso entrar?", "cabe no meu risco?", "tamanho da posição", "checar o risco", "já bati o limite?", "posso operar hoje?", "quero vender/sair", ou logo depois do b3-replay e antes do b3-ticket.'
metadata:
  argument-hint: "checar [--write] | saida --ticker X [--quantidade N] [--preco P] [--motivo stop|alvo|prazo|zerar|manual] [--write] | status"
---

# b3-risco

Os limites do perfil são lei. Este script decide se uma ENTRADA pode existir e
de que tamanho, e nunca deixa uma SAÍDA esperando. Absorve a skill
`trader-b3-risco-tamanho` e o trader-risk do original.

`${CLAUDE_SKILL_DIR}` é a pasta desta skill. No Windows, use `python` ou `py`.

```bash
python3 "${CLAUDE_SKILL_DIR}/risco.py" checar --write                    # entrada do plan.json
python3 "${CLAUDE_SKILL_DIR}/risco.py" saida --ticker BBAS3 --motivo stop --write
python3 "${CLAUDE_SKILL_DIR}/risco.py" status                            # dia, mês, pausa, fase
```

Código de saída: 0 APROVADO, 2 BLOQUEADO, 1 erro de dados.

## Tamanho

Quantidade = menor entre três limites, inteiro:

| limite | conta |
| --- | --- |
| risco | (R$ 5 menos corretagem de ida e volta) / (entrada menos stop com 1 tick de deslizamento, mais emolumentos por ação) |
| posição máxima | 40% do capital / entrada |
| caixa | (caixa menos 5% do capital) / entrada; o caixa sai do capital, do diário e da carteira |

Ações: abaixo de 100 vira o ticker com F (fracionário). FII e BDR: lote 1.
Opção: o prêmio inteiro conta como perda, então o teto é R$ 5; sem
`lote_opcoes` na referência, bloqueia.

## As 11 regras de ENTRADA

| nº | bloqueia quando |
| --- | --- |
| 1 | não há stop, o stop não fica abaixo da entrada ou o alvo não fica acima |
| 2 | a corretagem do estilo está nula no config (custo desconhecido) |
| 3 | perda no stop, com deslizamento e custos, passa de R$ 5 |
| 4 | reward:risk líquido de custos abaixo de 1,5 |
| 5 | perdas realizadas hoje + risco de todas as posições abertas + esta passam de R$ 15 |
| 6 | já houve 3 entradas hoje |
| 7 | o mês chegou a menos R$ 50 (pausa de 7 dias e nada até o mês virar), ou esta levaria além |
| 8 | plano de outro dia, mercado fechado, fora da janela (10:15 a 17:15 hoje), calendário ou grade desconhecidos |
| 9 | minicontrato (WIN, WDO), termo, venda descoberta, opção vendida, alavancagem, classe fora do perfil; vale mesmo se o config tentar liberar |
| 10 | a fase comprovada pelo diário não permite a classe, o estilo ou o dinheiro real |
| 11 | quantidade zero: o stop nunca encolhe para caber |

Simulado e real não se misturam: cada modo tem seus próprios limites do dia e
do mês. A fase é comprovada pelo diário: fase 2 só depois de 4 semanas desde o
início da fase 1 e com operações simuladas em 4 semanas distintas; fase 3 só com
30 day trades simulados desde o início da fase 2 e expectativa positiva.

No modo simulado com `"custo_alto_no_simulado": "avisar"`, as regras 3, 4 e 11
causadas só pela corretagem viram aviso "na conta real seria BLOQUEADA"; o
tamanho ignora a corretagem e o diário guarda os custos reais. No modo real,
bloqueiam.

## SAÍDA

`saida` nunca é bloqueada por limite, janela ou pausa: só avisa (mercado
fechado, call, day trade esquecido aberto). Vender sem posição, ou mais do que a
posição, não é saída: é venda descoberta, e é BLOQUEADO pela regra 9.

## Passos

1. Rode `status` se o usuário perguntar se pode operar hoje.
2. Rode `checar --write` com o mercado aberto, no pregão do plano.
3. Leia a ordem, os três limites (qual define), o veredito e cada motivo com o
   número da regra. Leia em voz alta o aviso de custo do simulado.
4. BLOQUEADO: diga o motivo e o que mudaria. Nunca sugira contornar (outro
   ticker para fugir do limite, encolher o stop, trocar o modo).
5. APROVADO: próximo passo é o b3-ticket, com o fingerprint.
6. Para sair, `saida --ticker X --motivo ... --write`, e depois o b3-ticket.

## Exemplo real (BBAS3, 09/11/2026 às 11:00, modo simulado, corretagem R$ 4,90)

```
ENTRADA BBAS3 (SIMULADO): compra 6 BBAS3F a R$ 17,20, ordem limitada, validade dia.
  Stop R$ 16,42, alvo R$ 18,76; perda no stop R$ 4,74 sem corretagem; financeiro R$ 103,20; reward:risk líquido 1,97.
  Com a corretagem real: perda no stop R$ 14,60; reward:risk líquido -0,03.
  limite risco              6  (R$ 5,00 menos R$ 0,00 de corretagem) / 0,7900 por ação  <- define
  limite posição máxima    11  40% de R$ 500,00 = R$ 200,00 / 17,20
  limite caixa             27  R$ 475,00 acima do caixa mínimo / 17,20

APROVADO
Hoje no modo simulado: perdas realizadas R$ 0,00; risco das posições abertas R$ 0,00 (limite do dia R$ 15,00);
entradas 0 de 3; mês R$ 0,00 (limite -R$ 50,00); caixa R$ 500,00.
Aviso: SIMULADO: na conta real esta entrada seria BLOQUEADA por custo (quantidade zero: ...).
Fingerprint 0cab4d45f1fa86f6.
```

A mesma entrada no modo real sai BLOQUEADO pela regra 11: R$ 9,80 de
corretagem de ida e volta já passam do risco de R$ 5 antes da primeira ação.

## O que nunca faz

Nunca envia ordem, nunca encolhe o stop para caber, nunca arredonda a
quantidade para cima, nunca afrouxa um limite do config nem uma proibição,
nunca bloqueia uma saída, nunca mistura simulado com real nos limites, nunca
aceita fase que o diário não comprova e nunca diz comprar ou vender.

Material educacional; não é recomendação de investimento.
