---
name: b3-scanner
description: Triagem de setups em ações, FIIs e BDRs da B3 para o pacote trader-b3. Monta o universo líquido e compatível com o capital a partir do COTAHIST oficial da B3, procura os setups diários do day-trader-skill (rompimento da máxima de 20 dias, bandeira, retomada da média de 20, sobrevenda pelo RSI 14 e repique) e o ORB intradiário com faixa de abertura de 10:00 a 10:15, avisando quando o dado gratuito não cobre a faixa. Grava trader/universo.json e trader/watchlist.json. Use quando o usuário pedir "o que está rompendo?", "procurar setups", "rodar o scanner", "triagem da bolsa", "ações baratas e líquidas para R$ 500", "lista de FIIs líquidos", "quais BDRs cabem no meu capital", "teve ORB hoje?", "atualizar cotações da B3", "baixar COTAHIST", ou antes de b3-noticias e b3-plano.
metadata:
  argument-hint: "[baixar|universo|diario|orb] [--tickers A,B] [--data AAAA-MM-DD]"
---

# b3-scanner

O scanner encontra gráficos que batem uma regra. Ele não escolhe o que comprar.
A fonte primária do diário é o **COTAHIST da B3**: oficial, gratuito, um arquivo
por pregão com todos os ativos. As barras diárias do Yahoo e da brapi bateram
exatamente com ele no teste de 08/11/2026; as intradiárias não (faltam a abertura
e o fim do pregão), por isso o ORB só roda com dado completo.

`${CLAUDE_SKILL_DIR}` é a pasta desta skill. No Windows, use `python` ou `py`.

```bash
python3 "${CLAUDE_SKILL_DIR}/scanner.py" baixar --dias 60        # cache em trader/cache/cotahist
python3 "${CLAUDE_SKILL_DIR}/scanner.py" universo                # -> trader/universo.json
python3 "${CLAUDE_SKILL_DIR}/scanner.py" diario                  # -> trader/watchlist.json
python3 "${CLAUDE_SKILL_DIR}/scanner.py" diario --tickers BBAS3,ITSA4 --data 2026-11-06
python3 "${CLAUDE_SKILL_DIR}/scanner.py" orb --data 2026-11-10 --at 10:45 --offline exportado_mt5/
```

Opcionais: `universo --fca fca_cia_aberta_2026.zip` (CNPJ por ticker, da CVM,
usado pelo b3-noticias), `--min-vol-acao 5000000`, `--min-vol-fii 1000000`,
`--min-vol-bdr 1000000`; `baixar --anual 2025` para histórico longo do replay.

## Regras

| etapa | regra |
| --- | --- |
| universo | à vista (mercado 010); ação = ON, PN, UNT; FII = cota com nome "FII"; BDR = DRN, DR1, DR2, DR3. Fora: ETF, BDR de ETF, direitos, recibos |
| liquidez | volume financeiro médio de 20 pregões: ação R$ 5 milhões, FII e BDR R$ 1 milhão; presente em 18 de 20 pregões |
| preço | de R$ 1 até a posição máxima do perfil (40% de R$ 500 = R$ 200), para caber ao menos 1 unidade (ação no fracionário, sufixo F) |
| setups diários | os 5 do original, sobre fechamentos; precisa de 30 pregões |
| evento corporativo | salto acima de 35% num ativo só: provável desdobramento, grupamento ou bonificação (COTAHIST não é ajustado); o ativo sai da triagem com aviso |
| movimento amplo | dia em que mais da metade dos ativos abriu mais de 10% longe do fechamento anterior: é o mercado, não o ativo; não exclui ninguém, mas é avisado |
| ORB | faixa = 15 min a partir da abertura da grade do dia; gatilho só em barra de 5 min FECHADA acima da máxima da faixa; sem as barras da faixa, "dados incompletos" |

## Passos

1. Depois do pregão (o arquivo do dia sai à noite): `baixar`, `universo` (uma vez
   por semana basta) e `diario`.
2. Mostre os hits como estão: ticker, classe, preço, RSI e setups. Diga uma vez
   que a lista é de gráficos que batem regra, não do que comprar.
3. Se um ativo saiu por evento suspeito, sugira conferir no b3-noticias.
4. Para ORB, só com barras completas (exportação do MetaTrader 5, que é grátis na
   XP no Windows). Com Yahoo ou brapi gratuitos, espere "dados incompletos".
5. Próximo passo: b3-noticias para o ativo escolhido, depois b3-plano.

## Exemplo real (fechamentos até 06/11/2026)

```
$ scanner.py diario --tickers BBAS3,ITSA4,BBDC4,MGLU3,PETR4,MXRF11,ROXO34 --data 2026-11-06
Triagem diária, fechamentos oficiais até 2026-11-06: 7 ativos, 7 analisados, 3 com setup.
  BBAS3   acao   R$ 17,13  RSI  31,7  repique de sobrevenda
  BBDC4   acao   R$ 14,20  RSI  29,8  sobrevenda (RSI 14 abaixo de 30), repique de sobrevenda
  PETR4   acao   R$ 45,36  RSI  29,2  sobrevenda (RSI 14 abaixo de 30)
Dias de movimento amplo de mercado (mais da metade dos ativos com salto acima de 10%): 2026-10-26.
```

Em 26/10/2026 a queda foi ampla (101 ativos com salto acima de 25% no mesmo
pregão). Os três hits são repiques e sobrevendas depois desse dia: refletem o
mercado inteiro, não uma notícia de cada empresa. Diga isso ao mostrar.

## O que nunca faz

Nunca envia ordem, nunca trata hit como recomendação, nunca usa dado gratuito
com atraso para cronometrar ordem (o gatilho real é visto na plataforma da XP),
nunca inventa a faixa de abertura quando faltam barras e nunca diz comprar ou
vender.

Material educacional; não é recomendação de investimento.
