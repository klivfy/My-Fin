---
name: b3-replay
description: 'Replay estatístico do plano no pacote trader-b3 (B3 + XP), antes de arriscar um real: sorteia barras reais do próprio ativo (diárias do COTAHIST no swing, de 5 min no day trade) e conta quantas vezes o alvo vem antes do stop dentro do prazo, com corretagem, emolumentos e deslizamento em R, gap de abertura saindo na abertura, semente reportada e amostra menor que 30 marcada como INCONCLUSIVA. Também roda a mesma regra do setup nos pregões passados. Lê trader/plan.json e grava trader/replay.json. Porta do trader-timemachine. Use quando o usuário disser "testa esse plano", "qual a chance de bater o alvo?", "replay", "backtest rápido", "simula o trade", "Monte Carlo", "isso costuma funcionar?", ou logo depois do b3-plano e antes do b3-risco.'
metadata:
  argument-hint: "run [--write] [--simulacoes 10000] [--semente 19] [--barras arquivo_5min] [--modo diario|intradiario]"
---

# b3-replay

Antes de arriscar dinheiro, pergunte ao passado do próprio ativo: com este stop,
este alvo e este prazo, o que costuma vir primeiro? A resposta já desconta os
custos da XP. Porta do trader-timemachine do original, com um modo diário novo
para swing.

`${CLAUDE_SKILL_DIR}` é a pasta desta skill. No Windows, use `python` ou `py`.

```bash
python3 "${CLAUDE_SKILL_DIR}/replay.py" run --write                     # swing: modo diário, COTAHIST local
python3 "${CLAUDE_SKILL_DIR}/replay.py" run --semente 7 --simulacoes 20000
python3 "${CLAUDE_SKILL_DIR}/replay.py" run --barras trader/PETR4_M5.csv --write   # day trade, CSV do MT5
```

## Como simula

| tema | regra |
| --- | --- |
| modo | `auto`: swing usa barras diárias; day usa barras de 5 min |
| sorteio diário | barras inteiras (abertura, máxima, mínima, fechamento sobre o fechamento anterior) dos últimos 250 pregões antes da data do plano; mínimo de 60 |
| sorteio intradiário | algoritmo do original: barra do mesmo horário, janela de mais ou menos 2 barras, só pregões com todas as barras depois da entrada; mínimo de 10 |
| gap | abertura abaixo do stop sai NA ABERTURA, pior que o stop; abertura acima do alvo sai no alvo (sem ganho extra) |
| mesma barra | se toca stop e alvo, conta stop |
| fim | swing: fechamento do último pregão do prazo; day: último horário antes de zerar. Se o dado não tem as barras finais, termina no último horário com dados e avisa |
| custos | corretagem do config por ordem, emolumentos da referência, 1 tick de deslizamento no stop; tudo em R sobre o risco planejado |
| eventos corporativos | barras de salto isolado (provável desdobramento ou provento) saem do sorteio; dias de movimento amplo de mercado ficam, com aviso |
| histórico | swing: o mesmo setup diário, nos pregões passados, com a mesma regra de stop e o mesmo alvo em R, sem sobreposição; day: ORB pulado quando o dado não tem os 15 primeiros minutos |
| veredito | compara a fatia do alvo, entre os que tocaram um lado, com a fatia que empata depois dos custos |
| honestidade | semente sempre impressa (padrão 19); sorteio ou histórico com menos de 30: INCONCLUSIVO |

## Passos

1. Confirme que existe `trader/plan.json` (b3-plano com `--write`).
2. Swing: o COTAHIST precisa cobrir cerca de 250 pregões. Se faltar, rode
   `scanner.py baixar --anual`.
3. Day trade: o dado gratuito começa entre 10:15 e 11:00 e termina às 16:55.
   Para replay fiel, exporte barras de 5 min do MetaTrader 5 (Ferramentas,
   Centro de Histórico, exportar) e passe em `--barras`.
4. `run --write`. Leia na ordem: alvo primeiro, stop primeiro (e quanto por gap),
   nenhum, R do alvo e do stop com custos, histórico, veredito, INCONCLUSIVO e
   avisos.
5. Se o R do alvo com custos for negativo, diga isso antes de qualquer
   porcentagem: não há probabilidade que salve o plano.
6. Diga que simulação não é previsão e repita a semente.
7. Próximo passo: b3-risco.

## Exemplo real (plano BBAS3 de 09/11/2026, COTAHIST oficial até 06/11, corretagem R$ 4,90)

```
Replay diário de BBAS3 (swing, 2026-11-09): entrada 17,20, stop 16,42, alvo 18,76, 6 unidades.
10.000 simulações, semente 19, barras sorteadas de 211 pregões (2026-01-05 a 2026-11-06), até o 10º pregão.

  alvo primeiro   17,5%
  stop primeiro   47,4% (8,7% por gap na abertura)
  nenhum          35,1%

Com custos: alvo vale -0,11R, stop vale -3,12R (custos de ida e volta no alvo: R$ 9,86).
R médio líquido -2,314R; pior simulação -10,09R. Preço no fim: mediana 17,17; 90% entre 14,36 e 19,24.

Histórico: o setup repique com a mesma regra, de 2026-01-02 a 2026-11-06, disparou 3 vezes sem
sobreposição: 1 no alvo, 1 no stop, 1 no prazo; R médio líquido -1,621R.

Mesmo no alvo o resultado líquido é negativo (-0,11R): os custos inviabilizam este plano com essa quantidade.
INCONCLUSIVO: histórico com 3 operações (mínimo 30).
Aviso: o sorteio inclui dias de movimento amplo de mercado (2026-10-26): é risco real e fica.
```

Leitura: com 6 ações e R$ 4,90 por ordem, o alvo vale menos que zero. O pior
caso de -10R vem do dia 26/10/2026, quando a BBAS3 abriu 33% abaixo do
fechamento anterior: um gap assim atravessa qualquer stop. Por isso o stop é
plano, não garantia.

## O que nunca faz

Nunca envia ordem, nunca chama simulação de previsão, nunca esconde a semente,
nunca omite custos, nunca apresenta amostra menor que 30 como conclusiva, nunca
tira do sorteio um dia ruim só porque foi ruim, nunca muda stop ou alvo do plano
e nunca diz comprar ou vender.

Material educacional; não é recomendação de investimento.
