# DESIGN.md

Regras visuais do My-Fin (finanças pessoais e diário de trading na mesma interface). Leia antes de mexer em UI.

## Direção

* Modo **Operar**: escaneabilidade, densidade moderada, marca nos detalhes. Finanças e trading são duas seções do mesmo livro, com o mesmo vocabulário visual.
* Cena: mesa de trabalho, de dia durante o pregão. **Só tema claro, por decisão do usuário**: não adicionar tema escuro, `dark:` nem seletor de tema. A página fixa `color-scheme: light`.
* Evitar os dois trilhos da categoria: o painel genérico de cards com pílulas verdes e o terminal escuro com neon.

## Cor

* Estratégia **Contida**: neutros frios levemente tingidos (matiz 255) e **um** acento de tinta azul (`--primary`) para ação, foco, seleção e série principal de gráfico.
* Ganho e perda: `--income` e `--expense`, sempre com sinal e texto. Cor nunca é o único código.
* `--warning` só para estado que pede atenção (ex.: limites não configurados).
* Tokens em `src/app/globals.css`; componente não usa cor fixa. Todo par de texto e controle é conferido por `src/lib/design/contrast.test.ts` (texto 4.5:1, controle e foco 3:1). Mudou a paleta e o teste falhou: ajuste a luminosidade, não o teste.

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
* A Carteira (`/investimentos`) mostra o que a B3 e a corretora registraram (planilha de negociação e notas em PDF). Arquivos são lidos e descartados; CPF, conta e código de cliente nunca são gravados. Negócio sem nota aparece como "sem nota", nunca com custo inventado.
* Nenhum dado real do perfil (capital, limites, corretagem) entra no repositório: os limites do painel ficam só no banco.

## Carteira (`/investimentos`)

Mesmo mundo do resto do app (modo Operar, tema claro, um acento). Regras próprias da tela:

* **Um único layout para vazio e preenchido.** Grade `1fr + 20rem`: dados à esquerda, painel "Fontes de dados" à direita (fixo ao rolar). Trocar a árvore entre estados remonta o painel e apaga o resultado da importação; por isso o estado vazio só troca o conteúdo da coluna esquerda. No celular o painel vai para o fim quando há dados (os números vêm primeiro).
* **Painel de fontes = lista, não cards.** Uma linha por fonte (planilha B3, notas, Open Finance), separadas por divisor, cada uma com: o que é e onde obter, estado real (última importação, quantas notas, falha) e a ação. Fonte não implementada (Open Finance) diz "Não conectado" e não tem botão.
* **Resultado da ação fica escrito na linha** (`role="status"`, `aria-live`), com ícone e texto; erro em `text-expense` com ícone, nunca só cor e nunca só em toast que some.
* **Senha do PDF só quando pedida.** O campo aparece inline depois que o servidor diz que o PDF tem senha: label visível, foco automático, texto dizendo que a senha não é guardada, "Abrir nota" e "Cancelar". Senha errada mantém o formulário com o erro abaixo.
* **"sem nota" em `text-warning-on-container`** onde faltaria custo; a contagem de negócios sem nota aparece na linha das notas, dizendo a consequência (custo fora do preço médio).
* **Peso pelo custo** é barra fina `bg-primary` sobre `bg-surface-container-high` com a porcentagem em texto ao lado. É peso pelo custo, não pelo valor de mercado (não há cotação): o rótulo diz isso.
* **Tabelas:** `tabular-nums`, números à direita, ativo como `th scope="row"`, rolagem horizontal só dentro da moldura. A de negócios usa células `px-3`, pregão como `dd/mm` e origem curta ("B3 · XP") para caber ao lado do painel em 1280px.
* **Open Finance (Pluggy):** sem credenciais no servidor, a linha diz o que falta e não tem botão. Com credenciais: campo "Id do item no Pluggy" (label visível, mono por ser identificador) até existir conexão; depois, cada conexão com estado em texto (conectada, pede login de novo, falhou) e "Sincronizar agora". O resumo diz o que foi importado, o que já existia e o que ficou de fora (renda fixa, taxas). Origem na tabela: "Pluggy · corretora".
* **Carregamento:** `loading.tsx` espelha o layout (cabeçalho, faixa de 4 números, linhas de tabela, painel) com `aria-busy`, sem spinner de página.

## Dívidas (`/dividas`)

* Plano de quitação, não promessa: a tela compara "só as parcelas", bola de neve (menor primeiro) e avalanche (maior juro primeiro) com o **mesmo orçamento mensal**, e mostra o custo e o prazo de cada um. Quem escolhe o método é o usuário; o padrão é o mais barato (no empate, bola de neve).
* O veredito diz os dois lados em texto: quanto a avalanche economiza e quantos meses antes a bola de neve fecha a segunda dívida. Sem selo de "melhor".
* O mínimo de cada dívida é a parcela inteira. A tela nunca sugere pagar o mínimo da fatura do cartão.
* "Para quitar hoje" é estimativa (valor presente das parcelas) e diz isso. As premissas (desconto de juros ao adiantar, CDC art. 52 § 2º; tabela Price) ficam escritas no fim da página.
* Extra mensal fica na URL (`?extra=`); o atalho "Usar a sobra real" usa a mesma sobra das metas de poupança e avisa para não contar duas vezes.
* "Paguei 1" desconta uma parcela com confirmação; a última quita e tira a dívida do plano.
* Tabelas com `relative` na moldura de rolagem: texto `sr-only` dentro da tabela não pode vazar a largura da página no celular.
