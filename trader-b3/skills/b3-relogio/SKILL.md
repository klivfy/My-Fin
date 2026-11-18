---
name: b3-relogio
description: Relógio e calendário da B3 para o pacote trader-b3 (B3 + XP). Diz se o pregão está aberto, em pré-abertura, em call de fechamento ou fechado; se entradas são permitidas agora (janela padrão 10:15 a 17:15); até quando zerar day trade (padrão 17:40, sempre antes do call); qual o próximo pregão; e bloqueia quando o calendário do ano ou a grade horária não estão confirmados. Também prepara a pasta trader/ (init), lista fatos voláteis vencidos (verificar) e testa se as barras gratuitas do Yahoo e da brapi cobrem o pregão inteiro (diagnostico). Use sempre que o usuário perguntar "a bolsa está aberta?", "que horas fecha a B3", "tem pregão amanhã?", "é feriado na bolsa?", "posso entrar agora?", "até que horas zero o day trade?", "horário do call", "horário de verão mudou a B3?", "atualizar feriados", "configurar o trader-b3", ou antes de qualquer b3-scanner, b3-plano, b3-risco ou b3-ticket.
metadata:
  argument-hint: "[init|status|janela|zerar-ate|verificar|diagnostico] [--agora 'AAAA-MM-DD HH:MM']"
---

# b3-relogio

O relógio é a primeira peça do fluxo `b3-relogio -> b3-scanner -> b3-noticias ->
b3-plano -> b3-replay -> b3-risco -> b3-ticket -> b3-diario`. Ele nunca adivinha:
grade horária, feriados, sessões especiais e fuso vêm de
`trader/referencia_b3.json`, com a URL do ofício da B3 e a data em que cada fato
foi conferido. Sem calendário do ano ou com a grade vencida, entradas ficam
bloqueadas e a resposta diz o motivo.

`${CLAUDE_SKILL_DIR}` é a pasta desta skill. No Windows, troque `python3` por
`python` ou `py`.

```bash
python3 "${CLAUDE_SKILL_DIR}/relogio.py" init                 # cria trader/ com referência e config
python3 "${CLAUDE_SKILL_DIR}/relogio.py" status               # estado, janela, zerar, próximo pregão
python3 "${CLAUDE_SKILL_DIR}/relogio.py" janela               # sai 0 se pode entrar agora, 1 se não
python3 "${CLAUDE_SKILL_DIR}/relogio.py" zerar-ate --data 2026-11-10
python3 "${CLAUDE_SKILL_DIR}/relogio.py" verificar            # fatos vencidos ou perto de vencer
python3 "${CLAUDE_SKILL_DIR}/relogio.py" diagnostico --ticker PETR4 --write
```

`--agora "2026-11-10 10:20"` fixa o relógio (horário de Brasília) para testes e
estudo de um pregão passado.

## O que lê e escreve

| arquivo | uso |
| --- | --- |
| `trader/referencia_b3.json` | fuso (UTC-3, sem horário de verão), grades com datas de validade, feriados por ano, sessões especiais (Quarta de Cinzas abre 13h), endpoints |
| `trader/config.json` | `janela` (minutos após a abertura e antes do fim), `zerar_minutos_antes_do_fim` ou `zerar_ate` |
| `trader/state/diagnostico.json` | com `diagnostico --write`: primeira e última barra por pregão e comparação com o fechamento oficial |

## Regras

- Janela e horário de zerar são **relativos à grade do dia**: 15 min após a
  abertura, 40 min antes do fim, zerar 15 min antes do fim. Hoje dá 10:15, 17:15
  e 17:40. Em março, quando a B3 mudar a grade, acompanha sozinho.
- `zerar_ate` explícito no config tem que ser antes do fim da negociação; se não
  for, o relógio recusa e explica.
- Ano sem lista de feriados: "calendário desconhecido", entradas bloqueadas.
- Grade sem data final passa a valer só até `reverificar_ate`; depois disso,
  "grade não confirmada", entradas bloqueadas, até alguém atualizar a referência
  com o ofício novo.
- `verificar` lista fatos com `reverificar_ate` vencido ou a 30 dias de vencer,
  consultas com mais de 180 dias, corretagem nula e pendências do IR.

## Passos

1. Na primeira vez: `init`. Depois, peça ao usuário para conferir
   `trader/config.json`, principalmente a corretagem da nota.
2. Para "posso entrar agora?": rode `janela` e leia a resposta como está.
3. Para dúvida sobre dado gratuito: rode `diagnostico` na máquina do usuário.
   Se o veredito for INCOMPLETO, diga que o ORB de 10:00 a 10:15 e o fim do
   pregão não podem ser estudados com esse dado, e que o caminho é exportar
   barras do MetaTrader 5 (grátis na XP, Windows) para o b3-replay ler.
4. Uma vez por mês, e sempre em dezembro e em março, rode `verificar` e siga
   `docs/MANUTENCAO.md`. Ao atualizar a referência, grave a URL e a data.

## Exemplo

```
$ relogio.py status --agora "2026-11-09 10:20"
B3 às 09/11/2026 10:20 (Brasília): ABERTO.
Negociação 10:00 a 17:55; call de fechamento até 18:00 (grade padrao_eua_2026_2027).
Janela de entradas: 10:15 a 17:15. Zerar day trade até 17:40.
Entradas agora: permitidas.
Próximo pregão: 2026-11-10.
```

## O que nunca faz

Nunca envia ordem, nunca inventa feriado ou horário que não esteja na referência,
nunca libera entrada com calendário ou grade desconhecidos e nunca trata dado
gratuito com atraso como cronômetro de ordem: o gatilho real é visto na
plataforma da XP. Também nunca diz comprar ou vender.

Material educacional; não é recomendação de investimento.
