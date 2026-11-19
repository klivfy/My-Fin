# DESIGN.md

Regras visuais do My-Fin (finanças pessoais e diário de trading na mesma interface). Leia antes de mexer em UI.

## Direção

* Modo **Operar**: escaneabilidade, densidade moderada, marca nos detalhes. Finanças e trading são duas seções do mesmo livro, com o mesmo vocabulário visual.
* Cena: mesa de trabalho, de dia durante o pregão e à noite na revisão. O tema segue o sistema (`next-themes`, `defaultTheme="system"`).
* Evitar os dois trilhos da categoria: o painel genérico de cards com pílulas verdes e o terminal escuro com neon.

## Cor

* Estratégia **Contida**: neutros frios levemente tingidos (matiz 255) e **um** acento de tinta azul (`--primary`) para ação, foco, seleção e série principal de gráfico.
* Ganho e perda: `--income` e `--expense`, sempre com sinal e texto. Cor nunca é o único código.
* `--warning` só para estado que pede atenção (ex.: limites não configurados).
* Tokens em `src/app/globals.css`; componente não usa cor fixa. Todo par de texto e controle é conferido por `src/lib/design/contrast.test.ts` nos dois temas (texto 4.5:1, controle e foco 3:1). Mudou a paleta e o teste falhou: ajuste a luminosidade, não o teste.

## Superfícies

* Elevação por tom e contorno (`border-outline-variant`), sem sombra. Cartões com raio de 12px (`rounded-xl`). Nada de card dentro de card.
* Resumos de período são **uma faixa** com lista de definição (`dl`): rótulo, valor e contexto real. Sem ícone em quadrado colorido, sem pílula de variação, sem sparkline sem escala.
* Gráfico de partes: barras horizontais de uma cor, não rosca colorida.

## Tipografia

* Geist (sans) em escala fixa: título de página `text-xl font-semibold tracking-tight`, título de seção `text-sm font-medium`, rótulo `text-sm text-on-surface-variant`, metadado `text-xs`.
* Rótulos em caixa de frase ("Mês atual", "Nova transação").
* Todo número: `tabular-nums`. Valor em dinheiro: componente `Money` (sinal, cor, `whitespace-nowrap`, modo privacidade).
* Monoespaçada só para código e chaves de config.

## Navegação e controles

* Desktop: barra lateral com grupos "Finanças" e "Trading". Celular: barra inferior com 3 atalhos e "Menu" (sheet com o mapa completo).
* A barra superior só mostra controles que agem na tela atual (período, sincronização, nova transação).
* Seletores de opção única (período, modo real/simulado) usam `role="group"` e `aria-pressed`, com estado real na URL.
* Alvo de toque mínimo 40px nos controles da barra; foco visível sempre (`:focus-visible` com `--ring`).

## Trading: honestidade funcional

* O app só **lê** o `diario.csv` importado. Nunca envia ordens nem escreve no diário.
* O painel de risco **exibe**; quem aprova ou bloqueia é o b3-risco. Todo texto sobre bloqueio diz isso, e diz que saídas nunca são bloqueadas.
* Real e simulado nunca se misturam na mesma conta.
* Nenhum dado real do perfil (capital, limites, corretagem) entra no repositório: os limites do painel ficam só no banco.
