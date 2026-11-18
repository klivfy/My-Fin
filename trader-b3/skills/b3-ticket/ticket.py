#!/usr/bin/env python3
"""b3-ticket: mostra UMA ordem APROVADA hoje pelo b3-risco para VOCÊ digitar na XP, no pacote trader-b3.
Nunca envia nada: não há integração com MetaTrader 5, ProfitDLL nem API de corretora. Só biblioteca padrão.

    python ticket.py mostrar [--plataforma app|home_broker|mt5]   # a próxima ordem aprovada, campo a campo
    python ticket.py confirmar FINGERPRINT digitei                # só a palavra literal "digitei" vale
    python ticket.py executado FINGERPRINT --preco 17.18          # atualiza a carteira; saída vai ao diário
    python ticket.py cancelar FINGERPRINT --motivo "não executou"
    python ticket.py zerar                                        # o que precisa sair hoje (day trade, prazo)
    python ticket.py log                                          # eventos de hoje

Regras: só fingerprint APROVADO hoje em state/risk.json; a ordem precisa bater com o próprio fingerprint
(editou orders.json depois do risco, é recusada); uma por vez; ENTRADA fora da janela é recusada (refaça o
risco); SAÍDA nunca é recusada. state/ticket.json é só de acréscimo.
Material educacional; não é recomendação de investimento.
"""

import argparse
import os
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)
import b3comum as c  # noqa: E402

D = c.D
LITERAL = "digitei"
FINAIS = ("executado", "cancelado", "recusado")
NOMES = {"app": "App XP (celular)", "home_broker": "Home Broker XP (web)", "mt5": "MetaTrader 5 (Windows)"}


class TicketErro(c.B3Erro):
    pass


# ---------------------------------------------------------------- estado

class Pasta(object):
    def __init__(self, config):
        self.base = os.path.dirname(config) or "."
        self.orders = os.path.join(self.base, "orders.json")
        self.risk = os.path.join(self.base, "state", "risk.json")
        self.log = os.path.join(self.base, "state", "ticket.json")
        self.port = os.path.join(self.base, "portfolio.json")
        self.diario = os.path.join(self.base, "diario.csv")


def eventos(p):
    return (c.ler_json(p.log, obrigatorio=False) or {}).get("eventos", [])


def registrar(p, agora, fp, status, **extra):
    doc = c.ler_json(p.log, obrigatorio=False) or {"eventos": []}
    ev = dict({"em": agora.strftime("%Y-%m-%d %H:%M"), "fingerprint": fp, "status": status}, **extra)
    doc["eventos"].append(ev)
    c.gravar_json(p.log, doc)
    return ev


def ultimo_status(evs, fp):
    st = [e["status"] for e in evs if e.get("fingerprint") == fp]
    return st[-1] if st else None


def ordem_valida(p, fp, hoje):
    """A ordem do dia com esse fingerprint, aprovada hoje e íntegra. Levanta TicketErro com o motivo."""
    od = c.ler_json(p.orders, obrigatorio=False) or {}
    if od.get("data") != hoje:
        raise TicketErro("nenhuma ordem de hoje em orders.json (o arquivo é de %s): rode o b3-risco" % od.get("data"))
    achou = [o for o in od.get("ordens", []) if o.get("fingerprint") == fp]
    if not achou:
        raise TicketErro("fingerprint %s não está nas ordens de hoje" % fp)
    o = achou[0]
    rk = c.ler_json(p.risk, obrigatorio=False) or {}
    vered = [r for r in rk.get("resultados", []) if r.get("fingerprint") == fp] if rk.get("data") == hoje else []
    if not vered or vered[-1].get("veredito") != "APROVADO":
        raise TicketErro("fingerprint %s não foi APROVADO hoje pelo b3-risco: nada a digitar" % fp)
    if c.fingerprint(o) != fp:
        raise TicketErro("a ordem %s foi alterada depois do b3-risco (o fingerprint não bate): recusada; rode o "
                         "b3-risco de novo" % fp)
    return o


# ---------------------------------------------------------------- texto do ticket

def campos(o, plataforma, cfg):
    """Passo a passo por plataforma, numerado. Os nomes dos campos variam: confira na tela."""
    compra = o["lado"] == "compra"
    q, tn = o["quantidade"], o["ticker_negociacao"]
    preco = c.num(o["preco"]) if o.get("preco") else None
    passos, protege = [], []
    if plataforma == "mt5":
        if preco:
            tipo = "Buy Limit" if compra else "Sell Limit"
        else:
            tipo = ("Buy" if compra else "Sell") + " a mercado"
        passos += ["Nova ordem (F9). Símbolo: %s" % tn, "Tipo: %s; volume: %d" % (tipo, q),
                   ("Preço: %s; expiração: hoje" % preco) if preco else "Execução a mercado"]
        if compra and o.get("stop"):
            passos.append("Stop Loss %s e Take Profit %s, se a conta aceitar na ordem pendente; senão, depois de "
                          "executar" % (c.num(o["stop"]), c.num(o["alvo"]) if o.get("alvo") else "vazio"))
    else:
        passos += ["Ativo: %s (%s)" % (tn, "fracionário" if tn.endswith("F") else "lote padrão"),
                   "%s, quantidade %d" % ("Compra" if compra else "Venda", q),
                   "Tipo: %s; validade: %s" % (("limitada a R$ %s" % preco) if preco else "a mercado",
                                               "do dia" if o.get("validade") == "dia" else o.get("validade"))]
    if compra and o.get("stop"):
        margem = int(cfg.get("stop_limite_ticks", 5))
        lim = D(o["stop"]) - D(margem) * D("0.01")
        protege.append("Venda stop de %d %s: disparo R$ %s; limite R$ %s (%d ticks abaixo, para executar em queda "
                       "rápida). Em gap de abertura a ordem pode sair pior ou não executar." % (
                           q, tn, c.num(o["stop"]), c.num(lim), margem))
        if o.get("alvo"):
            protege.append("Alvo: venda limitada de %d a R$ %s, ou stop gain com OCO; sem OCO, não deixe as duas "
                           "vendas valendo ao mesmo tempo" % (q, c.num(o["alvo"])))
    linhas = ["  %d. %s" % (i, x) for i, x in enumerate(passos, 1)]
    if protege:
        linhas.append("  Depois que a compra executar, proteja a posição:")
        linhas += ["  %d. %s" % (i, x) for i, x in enumerate(protege, len(passos) + 1)]
    return linhas


def texto_ticket(o, plataforma, cfg, ref):
    sim = o.get("modo") == "simulado"
    cab = "SIMULADO: NÃO DIGITE NA CONTA REAL." if sim else "DINHEIRO REAL."
    linhas = ["%s %s %d %s" % (cab, o["lado"].upper(), o["quantidade"], o["ticker_negociacao"]),
              "Fingerprint %s; %s de %s; plataforma: %s." % (o["fingerprint"], {"saida": "saída"}.get(o.get("operacao"), o.get("operacao", "ordem")), o["data"],
                                                              NOMES.get(plataforma, plataforma))]
    if sim:
        linhas.append("Anote a ordem no papel ou na conta demo do MetaTrader 5 e registre o preço que teria executado.")
    linhas += campos(o, plataforma, cfg)
    if o["lado"] == "compra":
        real = (" (sem corretagem; com a real, %s)" % c.rs(o["perda_no_stop_real"])
                if o.get("ignorou_custos") and o.get("perda_no_stop_real") is not None else "")
        saida = (("zerar até %s" % o["zerar_ate"]) if o.get("estilo") == "day" else
                 ("stop, alvo ou fechamento de %s" % (o.get("vence_em") or "fim do prazo")))
        linhas.append("Perda prevista no stop: %s%s. Saída: %s." % (c.rs(o["perda_no_stop"]), real, saida))
    nota = (ref.get("plataformas_xp") or {}).get("tipos_de_ordem")
    if nota:
        linhas.append("Nota: %s" % nota)
    linhas += ["Confira na tela ativo, lado, quantidade, preço e validade antes de enviar: quem envia é você.",
               "Quando tiver digitado, rode: ticket.py confirmar %s %s" % (o["fingerprint"], LITERAL)]
    return linhas


# ---------------------------------------------------------------- comandos

def carregar(a):
    ref = c.carregar_referencia(a.ref)
    cfg = c.carregar_config(a.config)
    return ref, cfg, c.agora_local(ref, a.agora), Pasta(a.config)


def proxima(p, hoje):
    """Pendente (mostrado ou digitado) primeiro; senão a primeira aprovada sem status."""
    od = c.ler_json(p.orders, obrigatorio=False) or {}
    if od.get("data") != hoje:
        return None, "nenhuma ordem de hoje: rode o b3-risco"
    evs = eventos(p)
    aprovadas = [o for o in od.get("ordens", []) if o.get("veredito") == "APROVADO"]
    for o in aprovadas:
        if ultimo_status(evs, o["fingerprint"]) in ("mostrado", "digitado"):
            return o, None
    for o in aprovadas:
        if ultimo_status(evs, o["fingerprint"]) is None:
            return o, None
    return None, "nenhuma ordem aprovada pendente hoje"


def imprimir(linhas):
    for x in c.rodape(linhas):
        print(x)


def cmd_mostrar(a):
    ref, cfg, agora, p = carregar(a)
    hoje = agora.date().isoformat()
    o, mot = proxima(p, hoje)
    if not o:
        imprimir([mot[0].upper() + mot[1:] + "."])
        return 1
    o = ordem_valida(p, o["fingerprint"], hoje)
    plat = a.plataforma or (cfg.get("plataformas") or ["home_broker"])[0]
    st = ultimo_status(eventos(p), o["fingerprint"])
    if o.get("operacao") == "entrada" and st is None:
        ok, motivos, _ = c.checar_janela(ref, cfg, agora, o.get("classe", "acao"))
        if not ok:
            registrar(p, agora, o["fingerprint"], "recusado", motivo="; ".join(motivos))
            imprimir(["Ticket RECUSADO: entrada fora da janela (%s). Nada a digitar; rode o b3-risco de novo no "
                      "próximo pregão." % "; ".join(motivos)])
            return 2
    if st is None:
        registrar(p, agora, o["fingerprint"], "mostrado", plataforma=plat)
    elif st == "digitado":
        imprimir(["Ticket %s já digitado: rode 'executado' com o preço ou 'cancelar'." % o["fingerprint"]])
        return 0
    imprimir(texto_ticket(o, plat, cfg, ref))
    return 0


def cmd_confirmar(a):
    ref, cfg, agora, p = carregar(a)
    o = ordem_valida(p, a.fingerprint, agora.date().isoformat())
    st = ultimo_status(eventos(p), a.fingerprint)
    if st != "mostrado":
        raise TicketErro("o ticket %s está '%s': só confirma o que foi mostrado e ainda não confirmado" % (
            a.fingerprint, st or "nunca mostrado"))
    resposta = " ".join(a.resposta)
    if resposta.strip() != LITERAL:
        raise TicketErro("resposta %r não é a palavra literal '%s': nada registrado" % (resposta, LITERAL))
    registrar(p, agora, a.fingerprint, "digitado", resposta_literal=resposta)
    imprimir(["Registrado: você digitou %s %d %s%s." % (o["lado"], o["quantidade"], o["ticker_negociacao"],
                                                       " (SIMULADO)" if o.get("modo") == "simulado" else ""),
              "Quando executar: ticket.py executado %s --preco PRECO [--quantidade N]" % a.fingerprint,
              "Se não executar até o fim do dia: ticket.py cancelar %s" % a.fingerprint])
    return 0


def cmd_executado(a):
    ref, cfg, agora, p = carregar(a)
    hoje = agora.date().isoformat()
    o = ordem_valida(p, a.fingerprint, hoje)
    st = ultimo_status(eventos(p), a.fingerprint)
    if st != "digitado":
        raise TicketErro("o ticket %s está '%s': execução só depois de 'confirmar ... %s'" % (
            a.fingerprint, st or "nunca mostrado", LITERAL))
    q = int(a.quantidade or o["quantidade"])
    if not 0 < q <= int(o["quantidade"]):
        raise TicketErro("quantidade executada %d fora de 1 a %d" % (q, int(o["quantidade"])))
    preco = D(a.preco, "preço executado")
    if preco <= 0:
        raise TicketErro("preço executado precisa ser positivo")
    if o.get("preco") and o["lado"] == "compra" and preco > D(o["preco"]):
        raise TicketErro("compra limitada a R$ %s não executa a R$ %s: confira o preço na nota" % (
            c.num(o["preco"]), c.num(preco)))
    if o.get("preco") and o["lado"] == "venda" and preco < D(o["preco"]):
        raise TicketErro("venda limitada a R$ %s não executa a R$ %s: confira o preço na nota" % (
            c.num(o["preco"]), c.num(preco)))
    port = c.ler_portfolio(p.port)
    if o["lado"] == "compra":
        linhas = entrar(port, o, q, preco, hoje)
    else:
        linhas = sair(ref, cfg, p, port, o, q, preco, hoje, a.emocao, a.nota)
    c.gravar_json(p.port, port)
    registrar(p, agora, a.fingerprint, "executado", preco_exec=float(preco), qtd_exec=q)
    imprimir(linhas)
    return 0


def entrar(port, o, q, preco, hoje):
    pos = {k: o.get(k) for k in ("ticker", "classe", "estilo", "setup", "stop", "alvo", "modo", "zerar_ate",
                                 "prazo_pregoes", "vence_em", "fingerprint")}
    pos.update({"quantidade": q, "preco_medio": float(preco), "data_entrada": hoje,
                "ticker_negociacao": c.ticker_negociacao(o["ticker"], o["classe"], q)})
    port["posicoes"].append(pos)
    return ["Carteira atualizada: %s %d a %s%s, stop %s, alvo %s." % (
        pos["ticker"], q, c.rs(preco), " (SIMULADO)" if o.get("modo") == "simulado" else "", c.rs(pos["stop"]),
        c.rs(pos["alvo"]) if pos.get("alvo") else "sem alvo"),
        "Agora coloque a venda stop do ticket. Ela protege; não garante preço."]


def sair(ref, cfg, p, port, o, q, preco, hoje, emocao, nota):
    """Baixa FIFO das posições do ticker e modo; cada lote fechado vira uma linha do diário com custos reais."""
    resto, linhas = q, []
    for pos in [x for x in port["posicoes"] if x["ticker"] == o["ticker"] and c.posicao_do_modo(x, o["modo"])]:
        if resto == 0:
            break
        k = min(resto, int(pos["quantidade"]))
        custos, liq, r = c.resultado_operacao(ref, cfg, pos.get("estilo", "swing"), k, pos["preco_medio"], preco,
                                              pos["stop"])
        c.anexar_diario(p.diario, {
            "data": hoje, "data_entrada": pos.get("data_entrada"), "ativo": pos["ticker"], "classe": pos.get("classe"),
            "estilo": pos.get("estilo"), "setup": pos.get("setup"), "entrada": pos["preco_medio"], "stop": pos["stop"],
            "alvo": pos.get("alvo"), "quantidade": k, "saida": float(preco), "custos": float(custos),
            "resultado_rs": float(liq), "resultado_r": float(r) if r is not None else "",
            "motivo_saida": o.get("motivo_saida"), "emocao": emocao or "", "nota": nota or "", "modo": o["modo"]})
        linhas.append("Fechado: %s %d de %s a %s; custos reais %s; resultado %s (%sR)%s." % (
            pos["ticker"], k, c.rs(pos["preco_medio"]), c.rs(preco), c.rs(custos), c.rs(liq),
            c.num(r, 2) if r is not None else "?", "; SIMULADO" if o["modo"] == "simulado" else ""))
        pos["quantidade"] = int(pos["quantidade"]) - k
        resto -= k
    if resto:
        raise TicketErro("a carteira não tem %d de %s para baixar: confira portfolio.json" % (q, o["ticker"]))
    port["posicoes"] = [x for x in port["posicoes"] if int(x["quantidade"]) > 0]
    linhas += ["Registrei no diario.csv. Cancele na plataforma a venda stop e o alvo que sobraram.",
               "Próximo passo: b3-diario para métricas e a revisão da operação."]
    return linhas


def cmd_cancelar(a):
    ref, cfg, agora, p = carregar(a)
    st = ultimo_status(eventos(p), a.fingerprint)
    if st in FINAIS:
        raise TicketErro("o ticket %s já está '%s'" % (a.fingerprint, st))
    registrar(p, agora, a.fingerprint, "cancelado", motivo=a.motivo)
    imprimir(["Cancelado %s (%s). Se estava digitada, cancele também na plataforma." % (a.fingerprint, a.motivo)])
    return 0


def cmd_zerar(a):
    ref, cfg, agora, p = carregar(a)
    hoje = agora.date().isoformat()
    port = c.ler_portfolio(p.port)
    ses, _ = c.sessao(ref, agora.date())
    zerar = c.hm(c.limites_do_dia(ref, cfg, ses)["zerar_ate"]) if ses else None
    linhas = []
    for pos in port["posicoes"]:
        if pos.get("estilo") == "day":
            motivo, quando = "zerar", ("até %s" % zerar) if zerar else "no próximo pregão"
        elif pos.get("vence_em") and pos["vence_em"] <= hoje:
            motivo, quando = "prazo", "no fechamento de hoje (o prazo do swing vence em %s)" % pos["vence_em"]
        else:
            continue
        linhas.append("%s %d (%s, %s): sair %s. Rode: risco.py saida --ticker %s --motivo %s --write" % (
            pos["ticker"], int(pos["quantidade"]), pos.get("estilo"), pos.get("modo"), quando, pos["ticker"], motivo))
    imprimir(linhas or ["Nada a zerar hoje."])
    return 0


def cmd_log(a):
    ref, cfg, agora, p = carregar(a)
    hoje = agora.date().isoformat()
    linhas = []
    for e in eventos(p):
        if e["em"].startswith(hoje):
            extra = ", ".join("%s=%s" % (k, v) for k, v in e.items() if k not in ("em", "fingerprint", "status"))
            linhas.append("%s  %s  %s%s" % (e["em"][11:], e["fingerprint"], e["status"], ("  " + extra) if extra else ""))
    imprimir(linhas or ["Nenhum evento hoje."])
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description="b3-ticket: você digita, o pacote nunca envia.")
    sub = ap.add_subparsers(dest="cmd")
    comuns = argparse.ArgumentParser(add_help=False)
    comuns.add_argument("--ref", default=c.REF_PADRAO)
    comuns.add_argument("--config", default=c.CONFIG_PADRAO)
    comuns.add_argument("--agora", help="AAAA-MM-DD HH:MM (horário de Brasília); padrão: agora")
    p = sub.add_parser("mostrar", parents=[comuns])
    p.add_argument("--plataforma", choices=sorted(NOMES))
    p = sub.add_parser("confirmar", parents=[comuns])
    p.add_argument("fingerprint")
    p.add_argument("resposta", nargs="+")
    p = sub.add_parser("executado", parents=[comuns])
    p.add_argument("fingerprint")
    p.add_argument("--preco", required=True)
    p.add_argument("--quantidade", type=int)
    p.add_argument("--emocao", help="como você estava (vai para o diário na saída)")
    p.add_argument("--nota")
    p = sub.add_parser("cancelar", parents=[comuns])
    p.add_argument("fingerprint")
    p.add_argument("--motivo", default="não executou")
    sub.add_parser("zerar", parents=[comuns])
    sub.add_parser("log", parents=[comuns])
    a = ap.parse_args(argv)
    if not a.cmd:
        ap.print_help()
        return 1
    try:
        return {"mostrar": cmd_mostrar, "confirmar": cmd_confirmar, "executado": cmd_executado,
                "cancelar": cmd_cancelar, "zerar": cmd_zerar, "log": cmd_log}[a.cmd](a)
    except c.B3Erro as e:
        print("ticket.py: %s" % e, file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
