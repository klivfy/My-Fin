---
name: b3-ticket
description: Mostra UMA ordem APROVADA hoje pelo b3-risco para o usuário digitar ele mesmo na XP (App, Home Broker ou MetaTrader 5), campo a campo, com a venda stop e o alvo, marcando SIMULADO em letra grande. Só aceita fingerprint aprovado hoje e íntegro, exige a palavra literal "digitei", registra a execução, atualiza trader/portfolio.json e, na saída, grava a linha do trader/diario.csv com os custos reais. Lista o que precisa ser zerado. Nunca envia ordem. Use quando o usuário disser "como eu digito essa ordem?", "me passa o ticket", "monta a boleta", "digitei", "executou a 17,18", "cancela a ordem", "o que preciso zerar?", ou logo depois de um APROVADO do b3-risco.
metadata:
  argument-hint: "mostrar [--plataforma app|home_broker|mt5] | confirmar FP digitei | executado FP --preco P [--quantidade N] [--emocao X] | cancelar FP | zerar | log"
---

# b3-ticket

O pacote decide se a ordem pode existir; quem digita e envia é você. Este
script transforma a ordem aprovada em passos que você copia na plataforma, e
registra o que aconteceu. Não existe caminho de código que envie ordem
(ADR 0001).

`${CLAUDE_SKILL_DIR}` é a pasta desta skill. No Windows, use `python` ou `py`.

```bash
python3 "${CLAUDE_SKILL_DIR}/ticket.py" mostrar --plataforma home_broker
python3 "${CLAUDE_SKILL_DIR}/ticket.py" confirmar 0cab4d45f1fa86f6 digitei
python3 "${CLAUDE_SKILL_DIR}/ticket.py" executado 0cab4d45f1fa86f6 --preco 17.20
python3 "${CLAUDE_SKILL_DIR}/ticket.py" cancelar 0cab4d45f1fa86f6 --motivo "não executou"
python3 "${CLAUDE_SKILL_DIR}/ticket.py" zerar
python3 "${CLAUDE_SKILL_DIR}/ticket.py" log
```

## Regras

| tema | regra |
| --- | --- |
| origem | só ordem de hoje em `orders.json` com veredito APROVADO hoje em `state/risk.json` |
| integridade | a ordem precisa bater com o próprio fingerprint; editou depois do risco, é recusada |
| uma por vez | mostra a pendente (mostrada ou digitada); só depois a próxima |
| entrada fora da janela | recusada no `mostrar`; rode o b3-risco de novo |
| saída | sempre mostrada, a qualquer hora (com o aviso do risco) |
| confirmação | só a palavra literal `digitei`; "ok", "Digitei" ou "sim" não registram nada |
| execução | compra limitada não executa acima do limite; venda limitada não executa abaixo; aceita execução parcial |
| carteira | compra executada vira posição; venda baixa por ordem de entrada (FIFO) |
| diário | cada lote fechado vira uma linha com custos reais da corretagem, mesmo no simulado |
| log | `state/ticket.json` só recebe acréscimos: mostrado, digitado, executado, recusado, cancelado |
| simulado | "SIMULADO: NÃO DIGITE NA CONTA REAL"; anote no papel ou na conta demo do MT5 |

## Passos

1. `mostrar` com a plataforma do usuário. Leia o ticket inteiro, em ordem.
2. Diga para conferir na tela ativo, lado, quantidade, preço e validade. Os
   nomes dos campos variam entre App, Home Broker e MT5.
3. Espere o usuário escrever `digitei`. Qualquer outra resposta: não confirme.
4. Quando ele disser o preço executado, rode `executado` com `--preco`. Na
   saída, pergunte como ele estava e passe em `--emocao`.
5. Depois da compra, lembre da venda stop: protege, não garante preço.
6. Para sair: b3-risco `saida`, depois `mostrar`, `confirmar`, `executado`.
7. Antes do fim do pregão, rode `zerar`. Day trade sai até o horário do
   b3-relogio (17:40 hoje), ganhe ou perca.

## Exemplo real (fluxo de BBAS3, modo simulado; preços de execução hipotéticos)

```
SIMULADO: NÃO DIGITE NA CONTA REAL. COMPRA 6 BBAS3F
Fingerprint 0cab4d45f1fa86f6; entrada de 2026-11-09; plataforma: Home Broker XP (web).
  1. Ativo: BBAS3F (fracionário)
  2. Compra, quantidade 6
  3. Tipo: limitada a R$ 17,20; validade: do dia
  Depois que a compra executar, proteja a posição:
  4. Venda stop de 6 BBAS3F: disparo R$ 16,42; limite R$ 16,37 (5 ticks abaixo ...)
  5. Alvo: venda limitada de 6 a R$ 18,76, ou stop gain com OCO ...
Perda prevista no stop: R$ 4,74 (sem corretagem; com a real, R$ 14,60).

(12/11, saída no alvo)
Fechado: BBAS3 6 de R$ 17,20 a R$ 18,76; custos reais R$ 9,86; resultado -R$ 0,50 (-0,11R); SIMULADO.
```

Acertar o alvo e perder dinheiro: é o que a corretagem de R$ 4,90 faz com uma
posição de R$ 103. O diário guarda esse resultado real.

## O que nunca faz

Nunca envia ordem, nunca se conecta a MetaTrader 5, ProfitDLL ou API de
corretora, nunca mostra ordem BLOQUEADA ou de outro dia, nunca aceita
confirmação que não seja a palavra literal, nunca apaga o log, nunca pede
senha, token ou assinatura eletrônica e nunca diz comprar ou vender.

Material educacional; não é recomendação de investimento.
