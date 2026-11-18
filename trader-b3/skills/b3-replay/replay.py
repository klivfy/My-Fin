#!/usr/bin/env python3
"""b3-replay: replay estatístico do plano antes de arriscar um real, para o pacote trader-b3.
Porta do trader-timemachine (day-trader-skill, MIT), com custos, deslizamento e um modo diário
para swing. Só biblioteca padrão.

    python replay.py run                              # trader/plan.json; swing = diário, day = intradiário
    python replay.py run --write                      # também grava trader/replay.json
    python replay.py run --simulacoes 20000 --semente 7
    python replay.py run --barras mt5_PETR4_M5.csv    # day trade com barras completas exportadas do MT5

Modo diário (swing): sorteia barras diárias inteiras do próprio ativo (abertura, máxima, mínima e
fechamento como razão do fechamento anterior) dos últimos --pregoes (250) antes da data do plano.
Cada simulação começa na entrada e anda até o prazo do plano. Regras conservadoras: abertura abaixo
do stop sai na ABERTURA (gap pior que o stop); abertura acima do alvo sai NO ALVO; na mesma barra,
stop antes do alvo; no fim do prazo sai no fechamento.
Histórico: a mesma regra do setup (os 5 setups diários) em cada pregão passado, sem sobreposição.

Modo intradiário (day): o algoritmo do original, com barras de 5 min do pregão da B3 e janela de
mais ou menos 2 barras no mesmo horário. Se as barras finais do dia faltam no dado, a simulação
termina no último horário com dados e avisa. Sem a faixa de abertura no dado, o histórico do ORB
é pulado.

Custos: corretagem do config e emolumentos da referência em cada saída, mais deslizamento no stop;
tudo em R sobre o risco planejado. Amostra menor que 30: INCONCLUSIVA.
Mesma semente, mesmo dado: mesmos números. Simulação não é previsão.
Material educacional; não é recomendação de investimento.
"""

import argparse
import datetime as dt
import os
import random
import statistics
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)
import b3comum as c  # noqa: E402

AMOSTRA_MIN = 30
POOL_MIN_DIARIO = 60
POOL_MIN_INTRA = 10
MOEDA = 0.05      # limiares do veredito, os mesmos do original
FORTE = 0.15
MUITOS_NENHUM = 0.40
AVISO_FUTURO = "Simulação não é previsão: o futuro pode não repetir o passado."


class ReplayErro(c.B3Erro):
    pass


def pct(a, q):
    return a[min(len(a) - 1, int(q * len(a)))]


# ---------------------------------------------------------------- custos em R

class Contas(object):
    """Resultado líquido em R de uma saída a um preço, para a quantidade do plano."""

    def __init__(self, ref, cfg, plano):
        self.q = int(plano["previsto"]["qtd"])
        if self.q <= 0:
            raise ReplayErro("o plano tem quantidade prevista zero: nada a simular")
        self.e = float(plano["entrada"])
        self.stop = float(plano["stop"])
        self.alvo = float(plano["alvo"])
        self.estilo = plano["estilo"]
        self.desliz = float(c.tick(ref)) * int(cfg.get("deslizamento_ticks", 1))
        self.risco = self.q * (self.e - self.stop)
        self.taxa = float(c.taxa_b3_pct(ref, self.estilo)) / 100.0
        self.corr = float(c.corretagem(cfg, self.estilo))

    def custo(self, saida):
        return 2 * self.corr + self.q * (self.e + saida) * self.taxa

    def r(self, saida):
        return (self.q * (saida - self.e) - self.custo(saida)) / self.risco

    def resumo(self):
        return {"r_alvo_liquido": round(self.r(self.alvo), 3),
                "r_stop_liquido": round(self.r(self.stop - self.desliz), 3),
                "custo_ida_volta_no_alvo": round(self.custo(self.alvo), 2), "quantidade": self.q,
                "risco_planejado": round(self.risco, 2), "corretagem_por_ordem": self.corr}


def veredito(p_alvo, p_stop, r_alvo, r_stop):
    """Compara a fatia do alvo entre os que tocaram um lado com a fatia que empata, já com custos:
    |R do stop| / (R do alvo + |R do stop|)."""
    if r_alvo <= 0:
        return ("Mesmo no alvo o resultado líquido é negativo (%s): os custos inviabilizam este plano com essa "
                "quantidade." % rfmt(r_alvo))
    if p_alvo + p_stop <= 0:
        return "Nenhuma simulação tocou o alvo ou o stop no prazo: o preço no fim decide todas."
    fatia = p_alvo / (p_alvo + p_stop)
    empate = abs(r_stop) / (r_alvo + abs(r_stop))
    d = fatia - empate
    if abs(d) < MOEDA:
        cab = "Perto do empate"
    elif abs(d) < FORTE:
        cab = "Pende para o alvo" if d > 0 else "Pende para o stop"
    else:
        cab = "Fortemente para o alvo" if d > 0 else "Fortemente para o stop"
    return ("%s: com custos, o alvo precisa vir antes em %s das simulações que tocaram um lado; veio em %s "
            "(alvo primeiro %s, stop primeiro %s)." % (cab, c.pct(100 * empate, 0), c.pct(100 * fatia, 0),
                                                        c.pct(100 * p_alvo, 1), c.pct(100 * p_stop, 1)))


# ---------------------------------------------------------------- caminhada comum

def andar(barras, stop, alvo, desliz):
    """Percorre barras (o, h, l, c) já em preço. Devolve (desfecho, preço de saída, saiu por gap)."""
    for o, h, l, cl in barras:
        if o <= stop:
            return "stop", o - desliz, True
        if o >= alvo:
            return "alvo", alvo, False
        if l <= stop:
            return "stop", stop - desliz, False
        if h >= alvo:
            return "alvo", alvo, False
    return "prazo", barras[-1][3], False


def resumir_mc(desf, rs, finais, n, semente, gaps=None, extra=None):
    srt = sorted(finais)
    out = {"simulacoes": n, "semente": semente, "p_alvo": round(desf.count("alvo") / n, 4),
           "p_stop": round(desf.count("stop") / n, 4), "p_prazo": round(desf.count("prazo") / n, 4),
           "r_medio_liquido": round(statistics.mean(rs), 3), "r_pior": round(min(rs), 3),
           "preco_final_mediana": round(pct(srt, 0.5), 2), "preco_final_p5": round(pct(srt, 0.05), 2),
           "preco_final_p95": round(pct(srt, 0.95), 2)}
    if gaps is not None:
        out["p_stop_por_gap"] = round(gaps / n, 4)
    out.update(extra or {})
    return out


# ---------------------------------------------------------------- modo diário

def pool_diario(serie, excluir=()):
    """Razões (o, h, l, c) sobre o fechamento anterior, sem eventos corporativos de um ativo só."""
    pool, fora = [], []
    for a, b in zip(serie, serie[1:]):
        if a["c"] <= 0:
            continue
        if b["data"] in excluir:
            fora.append(b["data"])
            continue
        pool.append((b["o"] / a["c"], b["h"] / a["c"], b["l"] / a["c"], b["c"] / a["c"]))
    return pool, fora


def simular_diario(pool, contas, prazo, n, semente):
    rng = random.Random(semente)
    escolha = rng.choice
    desf, rs, finais, gaps = [], [], [], 0
    for _ in range(n):
        p, barras = contas.e, []
        for _ in range(prazo):
            o, h, l, cl = escolha(pool)
            barras.append((p * o, p * h, p * l, p * cl))
            p = p * cl
        d, saida, gap = andar(barras, contas.stop, contas.alvo, contas.desliz)
        desf.append(d)
        rs.append(contas.r(saida))
        finais.append(barras[-1][3])
        gaps += 1 if gap else 0
    return resumir_mc(desf, rs, finais, n, semente, gaps=gaps)


def regra_historica(plano):
    """Como o stop do plano vira regra em pregões passados."""
    r = str(plano.get("regra_stop", "")).lower()
    try:
        if r.startswith("atr:"):
            return {"tipo": "atr", "k": float(r.split(":")[1].replace(",", "."))}
        if r.startswith("pct:"):
            return {"tipo": "pct", "pct": float(r.split(":")[1].replace(",", "."))}
    except ValueError:
        pass
    return {"tipo": "pct", "pct": round(100.0 * plano["risco_por_acao"] / plano["entrada"], 4),
            "nota": "stop do plano (%s) vira %s da entrada nos pregões passados" % (
                plano.get("regra_stop"), c.pct(100.0 * plano["risco_por_acao"] / plano["entrada"]))}


def historico_diario(serie, plano, ref, cfg, ignorar_custos, excluir=()):
    setup = plano.get("setup")
    nomes = dict(c.SETUPS_DIARIOS)
    if setup not in nomes:
        return {"amostra": 0, "nota": "só existe para os setups diários (%s); o plano usa '%s'" % (
            ", ".join(nomes), setup)}
    regra = regra_historica(plano)
    prazo = int(plano["prazo_pregoes"])
    alvo_r = float(plano["alvo_r"])
    desliz = float(c.tick(ref)) * int(cfg.get("deslizamento_ticks", 1))
    closes = [b["c"] for b in serie]
    trades, livre = [], 0
    for i in range(c.MIN_BARRAS_SETUP - 1, len(serie) - prazo):
        if i < livre:
            continue
        janela = serie[max(0, i - 25):i + prazo + 1]
        if any(b["data"] in excluir for b in janela):
            continue
        tags, _, _ = c.setups_diarios(closes[:i + 1])
        if setup not in tags:
            continue
        e = round(closes[i], 2)
        if regra["tipo"] == "atr":
            a, _ = c.atr(serie[:i + 1])
            stop = float(c.para_baixo(e - regra["k"] * a))
        else:
            stop = float(c.para_baixo(e * (1 - regra["pct"] / 100.0)))
        if stop <= 0 or stop >= e:
            continue
        alvo = float(c.meio_para_cima(e + alvo_r * (e - stop)))
        try:
            dim = c.dimensionar(ref, cfg, e, stop, alvo, plano["classe"], plano["estilo"],
                                ignorar_custos=ignorar_custos)
        except c.B3Erro:
            continue
        q = dim["qtd"] or 1
        barras = [(b["o"], b["h"], b["l"], b["c"]) for b in serie[i + 1:i + 1 + prazo]]
        d, saida, gap = andar(barras, stop, alvo, desliz)
        custo = float(c.custo_ida_volta(ref, cfg, plano["estilo"], q, e, saida))
        r = (q * (saida - e) - custo) / (q * (e - stop))
        trades.append({"data": serie[i]["data"], "entrada": e, "stop": stop, "alvo": alvo, "qtd": q, "desfecho": d,
                       "saida": round(saida, 2), "gap": gap, "r_liquido": round(r, 3)})
        livre = i + 1 + prazo
    return {"amostra": len(trades), "regra": regra, "alvo": sum(t["desfecho"] == "alvo" for t in trades),
            "stop": sum(t["desfecho"] == "stop" for t in trades),
            "prazo": sum(t["desfecho"] == "prazo" for t in trades),
            "r_medio_liquido": round(statistics.mean(t["r_liquido"] for t in trades), 3) if trades else None,
            "inicio": serie[0]["data"], "fim": serie[-1]["data"], "operacoes": trades}


def replay_diario(a, plano, ref, cfg):
    t = plano["ticker"]
    regs = c.registros_cotahist(a.fontes)
    amplos = c.dias_de_movimento_amplo(regs)
    serie = [b for b in c.serie_diaria(regs, t) if b["data"] < plano["data"]]
    if len(serie) < POOL_MIN_DIARIO + 1:
        raise ReplayErro("o replay diário precisa de %d pregões de %s antes de %s no COTAHIST; há %d. "
                         "Rode 'scanner.py baixar --dias 260' ou '--anual'." % (
                             POOL_MIN_DIARIO + 1, t, plano["data"], len(serie)))
    serie = serie[-(a.pregoes + 1):]
    ev = set(c.eventos_suspeitos(serie, excluir=amplos))
    pool, fora = pool_diario(serie, ev)
    contas = Contas(ref, cfg, plano)
    mc = simular_diario(pool, contas, int(plano["prazo_pregoes"]), a.simulacoes, a.semente)
    hist = historico_diario(serie, plano, ref, cfg, bool(plano.get("custo_alto_simulado")), ev)
    avisos = []
    if fora:
        avisos.append("barras fora do sorteio por provável evento corporativo: %s" % ", ".join(fora))
    dias_amplos = sorted(d for d in amplos if serie[0]["data"] < d < plano["data"])
    if dias_amplos:
        avisos.append("o sorteio inclui dias de movimento amplo de mercado (%s): é risco real e fica" %
                      ", ".join(dias_amplos))
    return mc, hist, {"pool_pregoes": len(pool), "pool_de": serie[1]["data"], "pool_ate": serie[-1]["data"]}, \
        contas, avisos


# ---------------------------------------------------------------- modo intradiário

def slot_de(ses, hora_txt):
    h = c.hora(hora_txt)
    base = dt.date(2000, 1, 3)
    seg = (dt.datetime.combine(base, h) - dt.datetime.combine(base, ses["abertura"])).total_seconds()
    return int(seg) // c.CINCO_MIN


def replay_intradiario(a, plano, ref, cfg):
    if not a.barras:
        raise ReplayErro("o replay de day trade precisa de --barras: arquivo de 5 min (Yahoo, brapi ou CSV exportado "
                         "do MetaTrader 5)")
    for campo in ("hora_entrada", "zerar_ate"):
        if not plano.get(campo):
            raise ReplayErro("plano de day trade sem '%s': refaça com o b3-plano" % campo)
    ses, mot = c.sessao(ref, c.data(plano["data"]))
    if not ses:
        raise ReplayErro("sem sessão em %s: %s" % (plano["data"], mot))
    k = slot_de(ses, plano["hora_entrada"]) - 1        # barra que fecha no horário da entrada
    ultimo = slot_de(ses, plano["zerar_ate"]) - 1      # última barra antes de zerar
    if k < 0 or ultimo <= k:
        raise ReplayErro("horário de entrada %s fora da sessão ou depois do zerar %s" % (
            plano["hora_entrada"], plano["zerar_ate"]))
    dias = c.sessoes_intradiarias(c.carregar_barras(a.barras, ref, a.fuso_csv), ref)
    passados = {d: s for d, s in dias.items() if d < plano["data"]}
    avisos = []

    def completos(ate):
        return [d for d, s in sorted(passados.items()) if all(j in s for j in range(k, ate + 1))]

    fim = ultimo
    while fim > k and len(completos(fim)) < POOL_MIN_INTRA:
        fim -= 1
    if fim <= k:
        raise ReplayErro("o dado não tem %d pregões com barras logo depois da entrada das %s: a primeira barra costuma "
                         "vir tarde no dado gratuito. Exporte barras de 5 min do MT5." % (
                             POOL_MIN_INTRA, plano["hora_entrada"]))
    hora_fim = c.hm(c.mais_min(ses["abertura"], 5 * (fim + 1)))
    if fim < ultimo:
        avisos.append("barras finais ausentes no dado: a simulação termina às %s, último horário com dados, e não "
                      "às %s do zerar" % (hora_fim, plano["zerar_ate"]))
    sessoes = completos(fim)
    pool = {j: [] for j in range(k + 1, fim + 1)}
    for d in sessoes:
        s = passados[d]
        for j in range(k + 1, fim + 1):
            pc = s[j - 1]["c"]
            b = s[j]
            pool[j].append((b["o"] / pc, b["h"] / pc, b["l"] / pc, b["c"] / pc))
    contas = Contas(ref, cfg, plano)
    rng = random.Random(a.semente)
    escolha, janela = rng.choice, 2
    desf, rs, finais = [], [], []
    for _ in range(a.simulacoes):
        p, barras = contas.e, []
        for j in range(k + 1, fim + 1):
            jj = min(fim, max(k + 1, j + rng.randint(-janela, janela)))
            o, h, l, cl = escolha(pool[jj])
            barras.append((p * o, p * h, p * l, p * cl))
            p = p * cl
        d, saida, _ = andar(barras, contas.stop, contas.alvo, contas.desliz)
        desf.append(d)
        rs.append(contas.r(saida))
        finais.append(barras[-1][3])
    mc = resumir_mc(desf, rs, finais, a.simulacoes, a.semente, extra={"janela_barras": janela})
    com_faixa = [d for d, s in passados.items() if all(j in s for j in range(3))]
    if plano.get("setup") == "orb":
        hist = {"amostra": 0, "nota": "ORB pulado: só %d de %d pregões do dado têm as barras de abertura "
                                      "(os 15 primeiros minutos)" % (len(com_faixa), len(passados))}
        if len(com_faixa) >= AMOSTRA_MIN:
            hist["nota"] = ("ORB sem replay histórico nesta versão; %d pregões têm a faixa completa"
                            % len(com_faixa))
    else:
        hist = {"amostra": 0, "nota": "sem replay histórico intradiário para o setup '%s'" % plano.get("setup")}
    return mc, hist, {"pool_pregoes": len(sessoes), "pool_de": sessoes[0], "pool_ate": sessoes[-1],
                      "termina": hora_fim}, contas, avisos


# ---------------------------------------------------------------- run

def executar(a):
    ref = c.carregar_referencia(a.ref)
    cfg = c.carregar_config(a.config)
    plano = c.ler_json(a.plano, "plano (rode o b3-plano com --write)")
    modo = a.modo if a.modo != "auto" else ("intradiario" if plano.get("estilo") == "day" else "diario")
    if modo == "diario":
        if not plano.get("prazo_pregoes"):
            raise ReplayErro("plano sem prazo em pregões: o modo diário é para swing")
        mc, hist, pool, contas, avisos = replay_diario(a, plano, ref, cfg)
    else:
        mc, hist, pool, contas, avisos = replay_intradiario(a, plano, ref, cfg)
    res = contas.resumo()
    motivos = []
    if pool["pool_pregoes"] < AMOSTRA_MIN:
        motivos.append("só %d pregões no sorteio" % pool["pool_pregoes"])
    if hist.get("amostra", 0) < AMOSTRA_MIN:
        motivos.append("histórico com %d operações (mínimo %d)" % (hist.get("amostra", 0), AMOSTRA_MIN))
    if plano.get("custo_alto_simulado"):
        avisos.append("plano simulado com custo alto: os R deste replay já usam a corretagem real de %s por ordem" %
                      c.rs(contas.corr))
    if mc["p_prazo"] > MUITOS_NENHUM:
        avisos.append("%s das simulações não tocaram alvo nem stop: o preço no fim decide essas" %
                      c.pct(100 * mc["p_prazo"], 1))
    return {"criado_por": "b3-replay", "modo": modo,
            "plano": {k: plano.get(k) for k in ("ticker", "classe", "estilo", "setup", "data", "entrada", "stop", "alvo",
                                                "alvo_r", "prazo_pregoes", "hora_entrada", "zerar_ate",
                                                "regra_stop")},
            "pool": pool, "custos": res, "mc": mc, "historico": hist,
            "veredito": veredito(mc["p_alvo"], mc["p_stop"], res["r_alvo_liquido"], res["r_stop_liquido"]),
            "inconclusivo": bool(motivos), "motivos_inconclusivo": motivos, "avisos": avisos, "nota": AVISO_FUTURO}


NOME_MODO = {"diario": "diário", "intradiario": "intradiário"}


def milhar(n):
    return "{:,}".format(n).replace(",", ".")


def relatorio(doc):
    p, m, h, cu = doc["plano"], doc["mc"], doc["historico"], doc["custos"]
    fim = ("até o %dº pregão" % p["prazo_pregoes"]) if doc["modo"] == "diario" else ("até %s" % doc["pool"].get("termina", p["zerar_ate"]))
    linhas = ["Replay %s de %s (%s, %s): entrada %s, stop %s, alvo %s, %d unidades." % (
        NOME_MODO[doc["modo"]], p["ticker"], p["estilo"], p["data"], c.num(p["entrada"]), c.num(p["stop"]), c.num(p["alvo"]),
        cu["quantidade"]),
        "%s simulações, semente %d, barras sorteadas de %d pregões (%s a %s), %s." % (
            milhar(m["simulacoes"]), m["semente"], doc["pool"]["pool_pregoes"], doc["pool"]["pool_de"],
            doc["pool"]["pool_ate"], fim), ""]
    gap = (" (%s por gap na abertura)" % c.pct(100 * m["p_stop_por_gap"], 1)) if m.get("p_stop_por_gap") else ""
    linhas += ["  alvo primeiro   %s" % c.pct(100 * m["p_alvo"], 1),
               "  stop primeiro   %s%s" % (c.pct(100 * m["p_stop"], 1), gap),
               "  nenhum          %s" % c.pct(100 * m["p_prazo"], 1), "",
               "Com custos: alvo vale %s, stop vale %s (custos de ida e volta no alvo: %s)." % (
                   rfmt(cu["r_alvo_liquido"]), rfmt(cu["r_stop_liquido"]), c.rs(cu["custo_ida_volta_no_alvo"])),
               "R médio líquido %s; pior simulação %s. Preço no fim: mediana %s; 90%% entre %s e %s." % (
                   rfmt(m["r_medio_liquido"], 3), rfmt(m["r_pior"]), c.num(m["preco_final_mediana"]),
                   c.num(m["preco_final_p5"]), c.num(m["preco_final_p95"])), ""]
    if h.get("amostra"):
        linhas.append("Histórico: o setup %s com a mesma regra, de %s a %s, disparou %d vezes sem sobreposição: %d no "
                      "alvo, %d no stop, %d no prazo; R médio líquido %s." % (
                          p["setup"], h["inicio"], h["fim"], h["amostra"], h["alvo"], h["stop"], h["prazo"],
                          rfmt(h["r_medio_liquido"], 3)))
        if h.get("regra", {}).get("nota"):
            linhas.append("  (%s)" % h["regra"]["nota"])
    else:
        linhas.append("Histórico: %s." % h.get("nota", "nenhum disparo"))
    linhas += ["", doc["veredito"]]
    if doc["inconclusivo"]:
        linhas.append("INCONCLUSIVO: %s. Leia as porcentagens como ilustração, não como probabilidade." %
                      "; ".join(doc["motivos_inconclusivo"]))
    for x in doc["avisos"]:
        linhas.append("Aviso: %s." % x)
    linhas.append("%s Repita com --semente %d para ver os mesmos números." % (doc["nota"], m["semente"]))
    return linhas


def rfmt(x, casas=2):
    """R com sinal e vírgula decimal: +1,23R."""
    s = ("%+." + str(casas) + "f") % x
    return s.replace(".", ",") + "R"


def cmd_run(a):
    doc = executar(a)
    if a.write:
        c.gravar_json(a.write, doc)
    extra = (["Gravei %s." % a.write] if a.write else []) + ["Próximo passo: b3-risco dimensiona e confere os limites."]
    for x in c.rodape(relatorio(doc) + extra):
        print(x)
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description="b3-replay: replay estatístico do plano (porta do trader-timemachine).")
    sub = ap.add_subparsers(dest="cmd")
    p = sub.add_parser("run")
    p.add_argument("--ref", default=c.REF_PADRAO)
    p.add_argument("--config", default=c.CONFIG_PADRAO)
    p.add_argument("--plano", default="trader/plan.json")
    p.add_argument("--modo", choices=["auto", "diario", "intradiario"], default="auto")
    p.add_argument("--simulacoes", type=int, default=10000)
    p.add_argument("--semente", type=int, default=19)
    p.add_argument("--pregoes", type=int, default=250, help="pregões no sorteio do modo diário")
    p.add_argument("--fontes", nargs="*", default=[c.pasta_cotahist()])
    p.add_argument("--barras", help="barras de 5 min (Yahoo, brapi ou CSV do MT5) para o modo intradiário")
    p.add_argument("--fuso-csv", type=float)
    p.add_argument("--write", nargs="?", const="trader/replay.json")
    a = ap.parse_args(argv)
    if not a.cmd:
        ap.print_help()
        return 1
    if not 1 <= a.simulacoes <= 1000000:
        print("replay.py: --simulacoes entre 1 e 1.000.000", file=sys.stderr)
        return 1
    try:
        return cmd_run(a)
    except c.B3Erro as e:
        print("replay.py: %s" % e, file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
