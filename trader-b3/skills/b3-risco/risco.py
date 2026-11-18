#!/usr/bin/env python3
"""b3-risco: dimensiona e aplica os limites do PERFIL antes de qualquer ordem, no pacote trader-b3.
Absorve a skill trader-b3-risco-tamanho e o trader-risk do original. Só biblioteca padrão.

    python risco.py checar --write                 # ENTRADA do trader/plan.json: APROVADO ou BLOQUEADO
    python risco.py saida --ticker BBAS3 --write   # SAÍDA de posição existente: nunca bloqueada
    python risco.py status                         # perdas do dia e do mês, entradas, pausa, fase verificada

Regras de ENTRADA (qualquer falha BLOQUEIA, com o motivo):
 1 stop ausente ou maior ou igual à entrada; alvo que não fica acima da entrada
 2 custo desconhecido (corretagem nula para o estilo)
 3 perda no stop com deslizamento e custos acima do risco por operação
 4 reward:risk líquido de custos abaixo do mínimo
 5 perdas do dia, mais o risco das posições abertas, mais esta, acima da perda máxima do dia
 6 entradas do dia já no máximo
 7 mês no limite de perda, ou esta levaria além dele, ou pausa após o limite mensal ativa
 8 plano de outro dia, mercado fechado, fora da janela, calendário ou grade desconhecidos
 9 proibidos: minicontratos, termo, venda descoberta, opção vendida, alavancagem (financeiro acima do
   caixa), classe fora do perfil
10 fase verificada pelo diário não permite a classe, o estilo ou o modo
11 quantidade zero (nunca encolhe o stop para caber)
No modo simulado com "custo_alto_no_simulado": "avisar", as falhas 3, 4 e 11 causadas pela corretagem
viram aviso "na conta real seria BLOQUEADA"; o tamanho ignora a corretagem.

SAÍDA nunca é bloqueada. Vender sem posição, ou mais do que a posição, não é saída: é venda descoberta
e é BLOQUEADA como entrada.

Nunca envia ordem. Material educacional; não é recomendação de investimento.
"""

import argparse
import datetime as dt
import os
import re
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)
import b3comum as c  # noqa: E402

D = c.D
CLASSES = ("acao", "fii", "bdr", "opcao")
PROIBIDOS_FIXOS = ("alavancagem", "minicontratos", "venda_descoberta", "aluguel", "termo", "opcao_vendida")
RE_TERMO = re.compile(r"^[A-Z]{4}\d{1,2}T$")


class RiscoErro(c.B3Erro):
    pass


# ---------------------------------------------------------------- contexto do dia

def risco_posicao(ref, cfg, p, com_custos=True):
    """Perda se a posição sair no stop agora: quantidade x (preço médio menos stop com deslizamento), mais custos."""
    q = int(p["quantidade"])
    pm, stop = D(p["preco_medio"]), D(p.get("stop") or 0)
    saida = max(stop - c.tick(ref) * int(cfg.get("deslizamento_ticks", 1)), D(0))
    perda = max(D(0), D(q) * (pm - saida))
    if com_custos:
        try:
            perda += c.custo_ida_volta(ref, cfg, p.get("estilo", "swing"), q, pm, saida)
        except c.CustoDesconhecido:
            pass
    return c.cent(perda)


def contexto(ref, cfg, modo, hoje, diario, port, com_custos=True):
    """Números do dia e do mês, só do modo pedido (simulado e real não se misturam)."""
    h = hoje.isoformat()
    mt = [x for x in diario if x.get("modo") == modo]
    perdas_hoje = sum(-x["resultado_rs"] for x in mt if x.get("data") == h and (x.get("resultado_rs") or 0) < 0)
    abertas = [p for p in port["posicoes"] if c.posicao_do_modo(p, modo)]
    risco_aberto = sum((risco_posicao(ref, cfg, p, com_custos) for p in abertas), D(0))
    entradas_hoje = (sum(1 for x in mt if (x.get("data_entrada") or x.get("data")) == h)
                     + sum(1 for p in abertas if p.get("data_entrada") == h))
    # Acumulado por mês e a data em que cada mês bateu o limite. A pausa conta a partir da
    # batida mais recente, mesmo que seja do mês anterior: ela atravessa a virada do mês.
    fechadas = sorted((x for x in mt if x.get("resultado_rs") is not None and (x.get("data") or "") <= h),
                      key=lambda x: x["data"])
    por_mes, bateu = {}, {}
    for x in fechadas:
        m = x["data"][:7]
        por_mes[m] = por_mes.get(m, 0.0) + x["resultado_rs"]
        if m not in bateu and por_mes[m] <= -float(cfg["perda_max_mes"]):
            bateu[m] = x["data"]
    acum = por_mes.get(h[:7], 0.0)
    atingiu = max(bateu.values()) if bateu else None
    pausa_ate = None
    if atingiu:
        pausa_ate = (c.data(atingiu) + dt.timedelta(days=int(cfg.get("pausa_dias_apos_mes", 7)))).isoformat()
    investido = sum((D(p["quantidade"]) * D(p["preco_medio"]) for p in abertas), D(0))
    realizado = sum((D(repr(x["resultado_rs"])) for x in mt if x.get("resultado_rs") is not None), D(0))
    return {"modo": modo, "data": h, "perdas_hoje": c.cent(perdas_hoje), "risco_aberto": c.cent(risco_aberto),
            "posicoes_abertas": len(abertas), "entradas_hoje": entradas_hoje, "resultado_mes": c.cent(acum),
            "mes_atingiu_limite_em": atingiu, "pausa_ate": pausa_ate,
            "caixa": c.cent(D(cfg["capital"]) + realizado - investido), "investido": c.cent(investido)}


# ---------------------------------------------------------------- entrada

def proibidos(cfg, ticker, classe, lado):
    motivos, avisos = [], []
    t = c.ticker_base(ticker)
    soltos = [p for p in PROIBIDOS_FIXOS if p not in (cfg.get("proibidos") or [])]
    if soltos:
        avisos.append("o config tenta liberar %s: ignorado, o pacote nunca afrouxa proibição" % ", ".join(soltos))
    if c.RE_MINI.match(t):
        motivos.append("9 proibido: minicontrato (%s); o perfil não opera WIN, WDO nem derivativo alavancado" % t)
    if RE_TERMO.match(t):
        motivos.append("9 proibido: operação a termo (%s)" % t)
    if lado != "compra":
        motivos.append("9 proibido: %s sem posição é venda descoberta" % (
            "venda de opção" if classe == "opcao" else "venda"))
    if classe not in CLASSES:
        motivos.append("9 classe '%s' fora do perfil (ações, FIIs, BDRs; opções só compra na fase 3)" % classe)
    return motivos, avisos


def checar_fase(cfg, diario, hoje, classe, estilo, modo):
    f, mot, nums = c.fase_verificada(cfg, diario, hoje)
    motivos, avisos = [], []
    if nums["declarada"] > f:
        avisos.append("o config diz fase %d, mas o diário só comprova a fase %d: %s" % (
            nums["declarada"], f, "; ".join(mot)))
    classes = (cfg.get("classes_por_fase") or {}).get(str(f), ["acao", "fii", "bdr"])
    if classe not in classes:
        motivos.append("10 fase %d não permite a classe %s (permite %s)" % (f, classe, ", ".join(classes)))
    if modo == "real":
        estilos = (cfg.get("estilos_reais_por_fase") or {}).get(str(f), [])
        if estilo not in estilos:
            motivos.append("10 fase %d não permite %s com dinheiro real (%s)" % (
                f, estilo, ("permite " + ", ".join(estilos)) if estilos else "fase 1 é só simulador"))
    return f, nums, motivos, avisos


def dimensionar_opcao(ref, cfg, entrada, estilo, caixa, ignorar_custos):
    """Prêmio conta como perda máxima: quantidade x prêmio mais custos cabem no risco e no prêmio máximo."""
    lt = (ref.get("microestrutura") or {}).get("lote_opcoes")
    if not lt:
        raise RiscoErro("lote de opções desconhecido: registre 'lote_opcoes' com fonte em referencia_b3.json")
    e = D(entrada)
    corr = D(0) if ignorar_custos else c.corretagem(cfg, estilo)
    taxa = D(0) if ignorar_custos else c.taxa_b3_pct(ref, estilo) / 100
    teto = min(D(cfg["risco_por_operacao"]), D((cfg.get("opcoes") or {}).get("premio_max", 50)))
    q = c._inteiro((teto - 2 * corr) / (e * (1 + taxa))) if teto > 2 * corr else 0
    q = min(q, c._inteiro((D(caixa) - D(cfg["capital"]) * D(cfg["caixa_min_pct"]) / 100) / e))
    q = (q // int(lt)) * int(lt)
    premio = c.cent(D(q) * e)
    perda = premio + (c.cent(2 * corr + premio * taxa) if q else D(0))
    return {"qtd": q, "perda_total": perda, "rr_liquido": None, "financeiro": premio,
            "ignorou_custos": ignorar_custos,
            "limites": [{"nome": "prêmio", "qtd": q, "define": True, "como": "teto %s por operação" % c.rs(teto)}]}


def limite_que_define(dim):
    x = [l for l in dim["limites"] if l.get("define")]
    return "; ".join("%s (%s)" % (l["nome"], l["como"]) for l in x) if x else "sem limite"


def problemas_de_custo(dim, cfg):
    """Falhas das regras 11, 3 e 4, já com o número da regra."""
    if dim["qtd"] == 0:
        return ["11 quantidade zero: %s (nunca encolhe o stop para caber)" % limite_que_define(dim)]
    p = []
    if dim["perda_total"] > D(cfg["risco_por_operacao"]):
        p.append("3 perda no stop com custos %s acima de %s" % (c.rs(dim["perda_total"]),
                                                                c.rs(cfg["risco_por_operacao"])))
    if dim.get("rr_liquido") is not None and dim["rr_liquido"] < D(cfg["rr_min"]):
        p.append("4 reward:risk líquido %s abaixo de %s" % (c.num(dim["rr_liquido"]), c.num(cfg["rr_min"])))
    return p


def tamanho(ref, cfg, plano, classe, estilo, caixa, sem_custos):
    e, s, a = plano["entrada"], plano.get("stop"), plano.get("alvo")
    if classe == "opcao":
        return dimensionar_opcao(ref, cfg, e, estilo, caixa, sem_custos)
    return c.dimensionar(ref, cfg, e, s, a, classe, estilo, ignorar_custos=sem_custos, caixa=caixa)


def checar_entrada(ref, cfg, plano, agora, diario, port):
    hoje = agora.date()
    modo = cfg.get("modo") or "simulado"
    t, classe, estilo = plano["ticker"], plano.get("classe", "acao"), plano.get("estilo", "swing")
    entrada, stop, alvo = plano.get("entrada"), plano.get("stop"), plano.get("alvo")
    motivos, avisos = proibidos(cfg, t, classe, plano.get("lado", "compra"))
    _, nums_fase, m, a = checar_fase(cfg, diario, hoje, classe, estilo, modo)
    motivos += m
    avisos += a

    if classe == "opcao":
        precos_ok = entrada is not None and D(entrada) > 0
    else:
        precos_ok = stop is not None and entrada is not None and D(0) < D(stop) < D(entrada)
        if not precos_ok:
            motivos.append("1 sem stop válido: stop %s, entrada %s (o stop fica abaixo da entrada)" % (stop, entrada))
        elif alvo is None or D(alvo) <= D(entrada):
            motivos.append("1 alvo %s não fica acima da entrada %s" % (alvo, entrada))
            precos_ok = False

    sim_avisar = modo == "simulado" and cfg.get("custo_alto_no_simulado") == "avisar"
    ctx = contexto(ref, cfg, modo, hoje, diario, port, com_custos=not sim_avisar)
    try:
        c.corretagem(cfg, estilo)
        custo_ok = True
    except c.CustoDesconhecido as e:
        motivos.append("2 %s" % e)
        custo_ok = False

    dim, custo_alto, reais = None, False, None
    if precos_ok and custo_ok:
        try:
            dim = tamanho(ref, cfg, plano, classe, estilo, ctx["caixa"], False)
            prob = problemas_de_custo(dim, cfg)
            if prob and sim_avisar:
                avisos.append("SIMULADO: na conta real esta entrada seria BLOQUEADA por custo (%s); o tamanho ignora "
                              "a corretagem e o diário registra os custos reais" % "; ".join(x.split(" ", 1)[1] for x in prob))
                dim, custo_alto = tamanho(ref, cfg, plano, classe, estilo, ctx["caixa"], True), True
            motivos += problemas_de_custo(dim, cfg)
        except c.B3Erro as e:
            motivos.append("11 %s" % e)
            dim = None
    qtd = int(dim["qtd"]) if dim else 0
    perda = dim["perda_total"] if qtd else D(0)

    if qtd:
        if dim["financeiro"] > ctx["caixa"]:
            motivos.append("9 proibido: alavancagem (financeiro %s acima do caixa %s)" % (
                c.rs(dim["financeiro"]), c.rs(ctx["caixa"])))
        dia = ctx["perdas_hoje"] + ctx["risco_aberto"] + perda
        if dia > D(cfg["perda_max_dia"]):
            motivos.append("5 limite do dia: perdas de hoje %s + risco aberto %s + esta %s = %s, acima de %s" % (
                c.rs(ctx["perdas_hoje"]), c.rs(ctx["risco_aberto"]), c.rs(perda), c.rs(dia),
                c.rs(cfg["perda_max_dia"])))
    if ctx["entradas_hoje"] >= int(cfg["max_operacoes_dia"]):
        motivos.append("6 já há %d entradas hoje (máximo %d)" % (ctx["entradas_hoje"], int(cfg["max_operacoes_dia"])))
    lim_mes = D(cfg["perda_max_mes"])
    if ctx["pausa_ate"] and hoje.isoformat() < ctx["pausa_ate"]:
        motivos.append("7 pausa: o mês chegou a %s de perda em %s; nenhuma entrada até %s" % (
            c.rs(lim_mes), ctx["mes_atingiu_limite_em"], ctx["pausa_ate"]))
    elif ctx["resultado_mes"] <= -lim_mes:
        motivos.append("7 o mês está em %s, no limite de %s: nenhuma entrada até o mês virar" % (
            c.rs(ctx["resultado_mes"]), c.rs(-lim_mes)))
    elif qtd and ctx["resultado_mes"] - ctx["risco_aberto"] - perda < -lim_mes:
        motivos.append("7 esta entrada levaria o mês além do limite: %s, menos risco aberto %s, menos esta %s, "
                       "passa de %s" % (c.rs(ctx["resultado_mes"]), c.rs(ctx["risco_aberto"]), c.rs(perda),
                                        c.rs(-lim_mes)))

    if plano.get("data") != hoje.isoformat():
        motivos.append("8 o plano é de %s e hoje é %s: refaça o plano com o preço de hoje" % (
            plano.get("data"), hoje.isoformat()))
    ok, mot, _ = c.checar_janela(ref, cfg, agora, "acao" if classe == "opcao" else classe)
    if not ok:
        motivos += ["8 " + x for x in mot]

    ordem = None
    if qtd:
        if classe != "opcao" and custo_ok:
            reais = c.custos_estimados(ref, cfg, estilo, qtd, entrada, stop, alvo)
        avisos += lembrete_fiscal(ref, classe, estilo)
        ordem = montar_ordem(plano, dim, modo, hoje, classe, estilo, reais)
    motivos = ordenar(motivos)
    return {"tipo": "entrada", "veredito": "BLOQUEADO" if motivos else "APROVADO", "motivos": motivos,
            "avisos": avisos, "ordem": ordem, "contexto": ctx, "fase": nums_fase, "custo_alto_simulado": custo_alto,
            "limites": [dict(l, qtd=int(l["qtd"])) for l in dim["limites"]] if dim else [],
            "fingerprint": ordem["fingerprint"] if ordem else None, "ticker": c.ticker_base(t), "modo": modo}


def ordenar(motivos):
    def chave(m):
        n = m.split(" ", 1)[0]
        return int(n) if n.isdigit() else 99
    out = []
    for m in sorted(motivos, key=chave):
        if m not in out:
            out.append(m)
    return out


def lembrete_fiscal(ref, classe, estilo):
    regras = (ref.get("ir") or {}).get("regras") or {}
    chave = {"acao": "acoes", "fii": "fii_ganho_capital", "bdr": "bdr", "opcao": "opcoes"}.get(classe, "acoes")
    if classe != "fii":
        chave += "_day" if estilo == "day" else "_swing"
    r = regras.get(chave)
    if not r:
        return []
    isen = r.get("isencao_vendas_mes_ate")
    return ["IR pela referência (%s): %s sobre o lucro%s; prejuízo só compensa na mesma modalidade. Não substitui "
            "contador nem a nota de corretagem" % (
                chave, c.pct(100 * float(r["aliquota"]), 0),
                ("; vendas de ações no mês até %s são isentas no swing" % c.rs(isen)) if isen else "")]


def montar_ordem(plano, dim, modo, hoje, classe, estilo, reais):
    q = int(dim["qtd"])
    ordem = {"ticker_negociacao": c.ticker_negociacao(plano["ticker"], classe, q),
             "ticker": c.ticker_base(plano["ticker"]), "lado": "compra", "quantidade": q, "tipo": "limitada",
             "preco": float(plano["entrada"]),
             "stop": float(plano["stop"]) if plano.get("stop") is not None else None,
             "alvo": float(plano["alvo"]) if plano.get("alvo") is not None else None, "validade": "dia",
             "estilo": estilo, "classe": classe, "modo": modo, "data": hoje.isoformat(), "setup": plano.get("setup"),
             "financeiro": float(dim["financeiro"]), "perda_no_stop": float(dim["perda_total"]),
             "rr_liquido": float(dim["rr_liquido"]) if dim.get("rr_liquido") is not None else None,
             "ignorou_custos": bool(dim.get("ignorou_custos"))}
    if reais:
        ordem.update({"custos_ida_volta_no_stop": float(reais["custos_stop"]),
                      "custos_ida_volta_no_alvo": float(reais["custos_alvo"]),
                      "perda_no_stop_real": float(reais["perda_total"]),
                      "rr_liquido_real": float(reais["rr_liquido"]) if reais["rr_liquido"] is not None else None})
    if estilo == "day":
        ordem["zerar_ate"] = plano.get("zerar_ate")
    else:
        ordem.update({"prazo_pregoes": plano.get("prazo_pregoes"), "vence_em": plano.get("vence_em")})
    ordem["fingerprint"] = c.fingerprint(ordem)
    return ordem


# ---------------------------------------------------------------- saída

def checar_saida(ref, ticker, qtd, preco, motivo, agora, port, modo):
    base = c.ticker_base(ticker)
    pos = [p for p in port["posicoes"] if c.ticker_base(p["ticker"]) == base and c.posicao_do_modo(p, modo)]
    tem = sum(int(p["quantidade"]) for p in pos)
    q = tem if qtd is None else int(qtd)
    if tem == 0 or q > tem or q <= 0:
        if tem == 0:
            mot = "9 proibido: sem posição de %s no modo %s; vender seria venda descoberta" % (base, modo)
        elif q > tem:
            mot = "9 proibido: vender %d com %d em carteira deixaria %d a descoberto" % (q, tem, q - tem)
        else:
            mot = "1 quantidade de venda precisa ser positiva"
        return {"tipo": "entrada", "veredito": "BLOQUEADO", "motivos": [mot], "avisos": [], "ordem": None,
                "fingerprint": None, "ticker": base, "modo": modo}
    p0 = pos[0]
    avisos = ["saída nunca é bloqueada por limite: os avisos são só informação"]
    em = c.estado_mercado(ref, agora, p0.get("classe", "acao"))
    if em["estado"] in ("fechado", "desconhecido", "pre-abertura"):
        avisos.append("mercado em %s agora: a ordem só vale no próximo pregão (%s)" % (
            em["estado"], em.get("proximo_pregao") or "data desconhecida"))
    elif em["estado"] == "call":
        avisos.append("call de fechamento: o preço sai do leilão")
    if p0.get("estilo") == "day" and p0.get("data_entrada") != agora.date().isoformat():
        avisos.append("day trade de %s ainda aberto: deveria ter sido zerado no dia" % p0.get("data_entrada"))
    ordem = {"ticker_negociacao": c.ticker_negociacao(base, p0.get("classe", "acao"), q), "ticker": base,
             "lado": "venda", "quantidade": q, "tipo": "limitada" if preco else "a mercado",
             "preco": float(preco) if preco else None, "validade": "dia", "estilo": p0.get("estilo", "swing"),
             "classe": p0.get("classe", "acao"), "modo": modo, "data": agora.date().isoformat(),
             "motivo_saida": motivo, "preco_medio": float(p0["preco_medio"]), "stop": p0.get("stop"),
             "alvo": p0.get("alvo"), "data_entrada": p0.get("data_entrada"), "setup": p0.get("setup")}
    ordem["fingerprint"] = c.fingerprint(ordem)
    return {"tipo": "saida", "veredito": "APROVADO", "motivos": [], "avisos": avisos, "ordem": ordem,
            "fingerprint": ordem["fingerprint"], "ticker": base, "modo": modo}


# ---------------------------------------------------------------- arquivos e relatório

def registrar(res, pasta, agora):
    """orders.json e state/risk.json guardam o dia corrente; o mesmo fingerprint é substituído."""
    h = agora.date().isoformat()
    rk = os.path.join(pasta, "state", "risk.json")
    doc = c.ler_json(rk, obrigatorio=False) or {}
    if doc.get("data") != h:
        doc = {"data": h, "resultados": []}
    item = {k: res.get(k) for k in ("fingerprint", "veredito", "tipo", "motivos", "avisos", "ticker", "modo")}
    item["em"] = agora.strftime("%Y-%m-%d %H:%M")
    if res["fingerprint"]:
        doc["resultados"] = [r for r in doc["resultados"] if r.get("fingerprint") != res["fingerprint"]]
    doc["resultados"].append(item)
    c.gravar_json(rk, doc)
    if res.get("ordem"):
        od = os.path.join(pasta, "orders.json")
        o = c.ler_json(od, obrigatorio=False) or {}
        if o.get("data") != h:
            o = {"data": h, "ordens": []}
        o["ordens"] = [x for x in o["ordens"] if x.get("fingerprint") != res["fingerprint"]]
        o["ordens"].append(dict(res["ordem"], veredito=res["veredito"], operacao=res["tipo"], motivos=res["motivos"]))
        c.gravar_json(od, o)


def linha_contexto(ctx, cfg):
    return ("Hoje no modo %s: perdas realizadas %s; risco das posições abertas %s (limite do dia %s); entradas %d de "
            "%d; mês %s (limite %s); caixa %s%s." % (
                ctx["modo"], c.rs(ctx["perdas_hoje"]), c.rs(ctx["risco_aberto"]), c.rs(cfg["perda_max_dia"]),
                ctx["entradas_hoje"], int(cfg["max_operacoes_dia"]), c.rs(ctx["resultado_mes"]),
                c.rs(-D(cfg["perda_max_mes"])), c.rs(ctx["caixa"]),
                ("; pausa até %s" % ctx["pausa_ate"]) if ctx.get("pausa_ate") else ""))


def relatorio(res, cfg):
    o = res.get("ordem")
    marca = "SIMULADO" if res["modo"] == "simulado" else "DINHEIRO REAL"
    linhas = []
    if o:
        linhas.append("%s %s (%s): %s %d %s a %s, ordem %s, validade %s." % (
            {"saida": "SAÍDA"}.get(res["tipo"], res["tipo"].upper()), o["ticker"], marca, o["lado"], o["quantidade"], o["ticker_negociacao"],
            c.rs(o["preco"]) if o.get("preco") else "mercado", o["tipo"], o["validade"]))
        if o["lado"] == "compra":
            linhas.append("  Stop %s, alvo %s; perda no stop %s %s; financeiro %s%s." % (
                c.rs(o["stop"]) if o.get("stop") else "prêmio inteiro", c.rs(o["alvo"]) if o.get("alvo") else "sem alvo",
                c.rs(o["perda_no_stop"]), "sem corretagem" if o["ignorou_custos"] else "com custos",
                c.rs(o["financeiro"]), ("; reward:risk líquido %s" % c.num(o["rr_liquido"]))
                if o.get("rr_liquido") is not None else ""))
            if o["ignorou_custos"] and o.get("perda_no_stop_real") is not None:
                linhas.append("  Com a corretagem real: perda no stop %s; reward:risk líquido %s." % (
                    c.rs(o["perda_no_stop_real"]), c.num(o["rr_liquido_real"])
                    if o.get("rr_liquido_real") is not None else "indefinido"))
    else:
        linhas.append("%s %s (%s): nenhuma ordem montada." % ({"saida": "SAÍDA"}.get(res["tipo"], res["tipo"].upper()), res["ticker"], marca))
    for l in res.get("limites") or []:
        linhas.append("  limite %-15s %4d  %s%s" % (l["nome"], l["qtd"], l["como"],
                                                    "  <- define" if l.get("define") else ""))
    linhas += ["", res["veredito"]]
    for i, m in enumerate(res["motivos"], 1):
        num, txt = m.split(" ", 1) if m[0].isdigit() else ("?", m)
        linhas.append("  %d. regra %s: %s" % (i, num, txt))
    if res.get("contexto"):
        linhas.append(linha_contexto(res["contexto"], cfg))
    for a in res["avisos"]:
        linhas.append("Aviso: %s." % a)
    if res.get("fingerprint"):
        linhas.append("Fingerprint %s." % res["fingerprint"])
    return linhas


# ---------------------------------------------------------------- comandos

def carregar(a):
    ref = c.carregar_referencia(a.ref)
    cfg = c.carregar_config(a.config)
    agora = c.agora_local(ref, a.agora)
    pasta = os.path.dirname(a.config) or "."
    diario = c.ler_diario(os.path.join(pasta, "diario.csv"))
    port = c.ler_portfolio(os.path.join(pasta, "portfolio.json"))
    return ref, cfg, agora, pasta, diario, port


def fim(res, cfg, a, pasta, agora, proximo):
    if a.write:
        registrar(res, pasta, agora)
    extra = ["Gravei orders.json e state/risk.json."] if a.write and res.get("ordem") else \
        (["Gravei state/risk.json."] if a.write else [])
    nxt = [proximo] if res["veredito"] == "APROVADO" else ["Nada a digitar. Corrija o motivo ou espere; não "
                                                            "contorne o limite."]
    for x in c.rodape(relatorio(res, cfg) + extra + nxt):
        print(x)
    return 0 if res["veredito"] == "APROVADO" else 2


def cmd_checar(a):
    ref, cfg, agora, pasta, diario, port = carregar(a)
    plano = c.ler_json(a.plano, "plano (rode o b3-plano com --write)")
    res = checar_entrada(ref, cfg, plano, agora, diario, port)
    return fim(res, cfg, a, pasta, agora, "Próximo passo: b3-ticket mostra a ordem para você digitar na XP.")


def cmd_saida(a):
    ref, cfg, agora, pasta, diario, port = carregar(a)
    res = checar_saida(ref, a.ticker, a.quantidade, a.preco, a.motivo, agora, port, a.modo or cfg.get("modo"))
    return fim(res, cfg, a, pasta, agora, "Próximo passo: b3-ticket mostra a venda para você digitar na XP.")


def cmd_status(a):
    ref, cfg, agora, pasta, diario, port = carregar(a)
    modo = a.modo or cfg.get("modo")
    sim_avisar = modo == "simulado" and cfg.get("custo_alto_no_simulado") == "avisar"
    ctx = contexto(ref, cfg, modo, agora.date(), diario, port, com_custos=not sim_avisar)
    f, mot, nums = c.fase_verificada(cfg, diario, agora.date())
    linhas = [linha_contexto(ctx, cfg),
              "Fase: config diz %d; o diário comprova %d.%s" % (nums["declarada"], f,
                                                                 (" " + "; ".join(mot) + ".") if mot else "")]
    for p in port["posicoes"]:
        if c.posicao_do_modo(p, modo):
            linhas.append("  aberta: %s %d a %s, stop %s, risco %s" % (
                p["ticker"], int(p["quantidade"]), c.rs(p["preco_medio"]), c.rs(p.get("stop") or 0),
                c.rs(risco_posicao(ref, cfg, p, not sim_avisar))))
    for x in c.rodape(linhas):
        print(x)
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description="b3-risco: tamanho e limites do perfil (nunca envia ordem).")
    sub = ap.add_subparsers(dest="cmd")
    comuns = argparse.ArgumentParser(add_help=False)
    comuns.add_argument("--ref", default=c.REF_PADRAO)
    comuns.add_argument("--config", default=c.CONFIG_PADRAO)
    comuns.add_argument("--agora", help="AAAA-MM-DD HH:MM (horário de Brasília); padrão: agora")
    p = sub.add_parser("checar", parents=[comuns])
    p.add_argument("--plano", default="trader/plan.json")
    p.add_argument("--write", action="store_true")
    p = sub.add_parser("saida", parents=[comuns])
    p.add_argument("--ticker", required=True)
    p.add_argument("--quantidade", type=int)
    p.add_argument("--preco", type=float)
    p.add_argument("--motivo", default="manual", choices=["stop", "alvo", "prazo", "zerar", "manual"])
    p.add_argument("--modo", choices=["simulado", "real"])
    p.add_argument("--write", action="store_true")
    p = sub.add_parser("status", parents=[comuns])
    p.add_argument("--modo", choices=["simulado", "real"])
    a = ap.parse_args(argv)
    if not a.cmd:
        ap.print_help()
        return 1
    try:
        return {"checar": cmd_checar, "saida": cmd_saida, "status": cmd_status}[a.cmd](a)
    except c.B3Erro as e:
        print("risco.py: %s" % e, file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
