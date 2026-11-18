---
name: b3-noticias
description: 'Notícias oficiais e eventos de risco para ações, FIIs e BDRs da B3 no pacote trader-b3: fatos relevantes, comunicados ao mercado, avisos aos acionistas (proventos, JCP, data-com) e calendário de resultados pelos dados abertos da CVM (IPE, D+1), CNPJ por ticker pelo FCA da CVM, link do Fundos.NET para FIIs, 8-K da empresa-mãe na SEC para BDRs e vencimento de opções da referência. Marca RISCO DE GAP em resultado, provento e evento corporativo. Mostra só o que é novo desde a última consulta. Use quando o usuário perguntar "tem notícia de BBAS3?", "saiu fato relevante?", "quando é o resultado?", "tem data-com?", "vai pagar JCP?", "o que aconteceu com a ação hoje?", "notícias da minha carteira", "comunicado do FII", "8-K da Apple para o AAPL34", "vencimento de opções", ou depois do b3-scanner e antes do b3-plano.'
metadata:
  argument-hint: "[atualizar|listar] [--tickers A,B] [--dias 7] [--todos]"
---

# b3-noticias

Documento entregue à CVM é fato. Manchete de portal é pista. O IPE da CVM é
atualizado uma vez por dia com as entregas do dia anterior (teste de 08/11/2026:
arquivo das 07:00 com entregas até 07/11), então serve para planejar, não para
reagir no minuto.

`${CLAUDE_SKILL_DIR}` é a pasta desta skill. No Windows, use `python` ou `py`.

```bash
python3 "${CLAUDE_SKILL_DIR}/noticias.py" atualizar                   # IPE (12 h) e FCA (7 dias) em cache
python3 "${CLAUDE_SKILL_DIR}/noticias.py" listar                      # watchlist, plano e carteira
python3 "${CLAUDE_SKILL_DIR}/noticias.py" listar --tickers BBAS3,PETR4 --dias 14 --todos
python3 "${CLAUDE_SKILL_DIR}/noticias.py" listar --tickers AAPL34     # BDR: SEC
```

## Fontes e o que cada uma cobre

| classe | fonte | observação |
| --- | --- | --- |
| ação | IPE da CVM, filtrado pelo CNPJ (FCA da CVM) | fato relevante, comunicado, aviso aos acionistas, calendário de eventos, assembleia |
| FII | Fundos.NET (consulta pública) | o pacote gera o link pelo CNPJ do universo; abra a página e leia |
| BDR | 8-K da empresa-mãe na SEC | exige `sec_user_agent` com o nome e e-mail do usuário em `trader/config.json`; nunca preencha por ele |
| todos | `vencimentos_opcoes_acoes` da referência | volatilidade costuma subir no vencimento |
| mesmo dia | busca web do Claude em InfoMoney, Valor, Money Times, Brazil Journal | sempre rotulada como pista |

Etiquetas: proventos, resultado, evento corporativo, gestão, crédito. RISCO DE
GAP aparece em fato relevante, resultado (inclui período de silêncio e "3T26"),
provento e evento corporativo, e em 8-K de resultado ou mudança de controle.

## Passos

1. `atualizar` uma vez por dia (antes do pregão basta).
2. `listar` para os tickers do trabalho. Leia cada item com data e categoria.
3. Para qualquer RISCO DE GAP dentro do prazo do plano (swing), avise que o
   b3-plano vai listar o evento e que o stop pode executar pior num gap.
4. Data-com e data de resultado exatas estão dentro do documento: abra o link e
   cite o trecho. Se não achar, diga que não achou.
5. Para notícia do dia, faça a busca web e diga "pista, não confirmada na CVM".

## O que nunca faz

Nunca envia ordem, nunca trata manchete como fato, nunca diz que a notícia é boa ou ruim para o
preço, nunca diz comprar ou vender, nunca preenche o User-Agent da SEC com dados
inventados e nunca chama o IPE de tempo real.

Material educacional; não é recomendação de investimento.
