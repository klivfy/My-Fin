# Listagem — Microsoft Store (Windows 10/11 via PWABuilder)

## Nome
My-Fin — Gerenciador Financeiro

## Descrição
Gerenciador financeiro pessoal completo: dashboard consolidado, extrato
unificado com conciliação, contas e cartões de crédito com parcelamentos,
orçamentos mensais, metas de poupança, lançamentos recorrentes e relatórios.

Instalação como app nativo do Windows (janela própria, atalho no menu
Iniciar, jump list com "Nova transação" e "Orçamentos") — por baixo é o
mesmo PWA, sempre atualizado.

## Pacote
1. Acesse <https://www.pwabuilder.com> e informe a URL de produção.
2. Baixe o pacote **Windows** (`.msixbundle`).
3. No Partner Center, crie o app "My-Fin" e faça upload do pacote.

## Requisitos do manifest (já atendidos)
- `display: standalone`, ícones 192/512 + maskable, `shortcuts`
  (jump list), `protocol_handlers` (`web+myfin:`), `launch_handler`.
- Screenshots Windows 1366×768+ recomendados: capturar via Playwright
  (projeto `chromium`).

## Notas
- `handle_links: preferred` faz links do domínio abrirem no app instalado.
- Conta de desenvolvedor individual da Microsoft Store: registro único
  (gratuito ou taxa simbólica conforme região).
