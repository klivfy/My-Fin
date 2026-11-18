#!/usr/bin/env python3
"""b3-plano: entrada, stop, alvo e saída ANTES da entrada, para o pacote trader-b3. Só biblioteca padrão.

    python plano.py plano --ticker BBAS3 --estilo swing --entrada 17.20 --stop fundo:16.43 --write
    python plano.py plano --ticker BBAS3 --entrada 17.20 --stop atr:2 --alvo 2R --prazo 10
    python plano.py plano --ticker PETR4 --estilo day --hora 10:30 --entrada 45.80 --or-high 45.70 --or-low 45.20
    python plano.py gatilho BBAS3 --nivel 17.20 --data 2026-11-06      # swing: fechamento diário acima do nível?
    python plano.py gatilho PETR4 --estilo day --barras mt5.csv --data 2026-11-10 --at 10:45
    python plano.py mostrar

Entrada: só compra. Gatilho só em barra FECHADA acima do nível (diária no swing, 5 min no day).
Stops (compra; arredonda para BAIXO no tick de R$ 0,01):
  fundo:X   um tick abaixo do fundo X informado      pct:X   X% abaixo da entrada
  preco:X   o preço X                                atr:K   K vezes o ATR(14) (diário no swing, 5 min no day)
  or-mid    meio da faixa de abertura (day)          or-low  mínima da faixa de abertura (day)
Alvo: 2R (padrão), 1.5R, 3R... ou preco:X; arredonda meio para cima no tick.
Recusa, com o motivo: stop maior ou igual à entrada; alvo menor ou igual à entrada; risco abaixo
de 0,3% do preço; quantidade zero ou reward:risk abaixo do mínimo depois dos custos de ida e volta;
entrada fora da janela do b3-relogio; dia sem calendário ou grade.
Day trade: zerar até o horário do b3-relogio (padrão 17:40). Swing: prazo em pregões (padrão 10)
e lista de eventos no prazo (vencimento de opções e os que você informar com --evento).
No modo simulado com "custo_alto_no_simulado": "avisar", recusa por custo vira aviso; o resto não.
Stop é plano, não garantia. Nunca envia ordem. Material educacional; não é recomendação de investimento.
"""

import argparse
import datetime as dt
import os
import re
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)
import b3comum as c  # noqa: E402

NOTA_STOP = "Stop é plano, não garantia: gap, leilão ou mercado rápido podem executar pior."


class PlanoErro(c.B3Erro):
    pass


# ---------------------------------------------------------------- regras

def ler_stop(texto):
    t = str(texto or "").strip().lower()
    if t in ("or-mid", "or_mid"):
        return "or_mid", None
    if t in ("or-low", "or_low"):
        return "or_low", None
    m = re.match(r"^(fundo|pct|preco|preço|atr):\s*([0-9]+(?:[.,][0-9]+)?)$", t)
    if not m:
        raise PlanoErro("--stop é fundo:X, pct:X, preco:X, atr:K, or-mid ou or-low (recebi %r)" % texto)
    tipo = "preco" if m.group(1) == "preço" else m.group(1)
    v = c.D(m.group(2))
    if v <= 0:
        raise PlanoErro("--stop %s precisa de número maior que zero" % tipo)
    if tipo == "pct" and v >= 100:
        raise PlanoErro("--stop pct:X precisa de X menor que 100")
    return tipo, v


def ler_alvo(texto):
    t = str(texto or "2R").strip()
    m = re.match(r"^([0-9]+(?:[.,][0-9]+)?)\s*[Rr]$", t)
    if m:
        r = c.D(m.group(1))
        if r <= 0:
            raise PlanoErro("--alvo precisa de múltiplo de R maior que zero")
        return "r", r
    m = re.match(r"^(preco|preço):\s*([0-9]+(?:[.,][0-9]+)?)$", t.lower())
    if m:
        return "preco", c.D(m.group(2))
    raise PlanoErro("--alvo é 2R, 1.5R... ou preco:X (recebi %r)" % texto)


def calcular(ref, entrada, regra, param, alvo_regra, alvo_param, or_high=None, or_low=None, atr=None, atr_n=None):
    """Stop, alvo e risco em centavos exatos. Levanta PlanoErro com o motivo."""
    tk = c.tick(ref)
    e = c.meio_para_cima(entrada, tk)
    if e <= 0:
        raise PlanoErro("a entrada precisa ser maior que zero")
    detalhe = ""
    if regra in ("or_mid", "or_low"):
        if or_high is None or or_low is None:
            raise PlanoErro("stop %s precisa da faixa de abertura (--or-high e --or-low)" % regra.replace("_", "-"))
        oh, ol = c.D(or_high), c.D(or_low)
        if oh <= ol:
            raise PlanoErro("a máxima da faixa (%s) precisa ser maior que a mínima (%s)" % (c.num(oh), c.num(ol)))
        bruto = (oh + ol) / 2 if regra == "or_mid" else ol
        rotulo = "meio da faixa de abertura" if regra == "or_mid" else "mínima da faixa de abertura"
        if regra == "or_mid":
            detalhe = "(%s + %s) / 2 = %s" % (c.num(oh), c.num(ol), c.num(bruto, 3))
    elif regra == "fundo":
        bruto = param - tk
        rotulo = "um tick abaixo do fundo %s" % c.num(param)
    elif regra == "preco":
        bruto, rotulo = param, "preço informado"
    elif regra == "pct":
        bruto = e * (1 - param / 100)
        rotulo = "%s%% abaixo da entrada" % c.num(param)
        detalhe = "%s x (1 - %s%%) = %s" % (c.num(e), c.num(param), c.num(bruto, 4))
    elif regra == "atr":
        if atr is None:
            raise PlanoErro("stop atr precisa das barras para calcular o ATR")
        bruto = e - param * c.D(round(atr, 6))
        rotulo = "%s x ATR(%d) abaixo da entrada" % (c.num(param), atr_n)
        detalhe = "ATR %s em %d barras" % (c.num(atr, 4), atr_n)
    else:
        raise PlanoErro("regra de stop desconhecida: %r" % regra)
    stop = c.para_baixo(bruto, tk)
    if stop != c.D(bruto):
        detalhe = (detalhe + ", arredondado para baixo") if detalhe else "%s arredondado para baixo" % c.num(bruto, 4)
    if stop >= e:
        raise PlanoErro("o stop %s (%s) é maior ou igual à entrada %s: numa compra o stop fica abaixo da entrada"
                        % (c.num(stop), rotulo, c.num(e)))
    if stop <= 0:
        raise PlanoErro("o stop dá %s: escolha um stop acima de zero" % c.num(stop))
    risco = e - stop
    if alvo_regra == "r":
        alvo = c.meio_para_cima(e + alvo_param * risco, tk)
        rr = c.num(alvo_param, 2).rstrip("0").rstrip(",")
        alvo_rotulo = "%sR (entrada + %s x risco)" % (rr, rr)
    else:
        alvo = c.meio_para_cima(alvo_param, tk)
        alvo_rotulo = "preço informado"
    if alvo <= e:
        raise PlanoErro("o alvo %s é menor ou igual à entrada %s: numa compra o alvo fica acima" % (c.num(alvo),
                                                                                                c.num(e)))
    return {"entrada": e, "stop": stop, "stop_rotulo": rotulo, "stop_detalhe": detalhe, "alvo": alvo,
            "alvo_rotulo": alvo_rotulo, "risco_por_acao": risco, "rr_bruto": c.cent((alvo - e) / risco)}


def classe_do_ticker(t, universo, informada=None):
    if informada:
        return informada
    for x in universo:
        if x.get("ticker") == t:
            return x.get("classe")
    if re.match(r"^[A-Z0-9]{4}3[1-9]$", t):
        return "bdr"
    if re.match(r"^[A-Z]{4}([3-8])$", t):
        return "acao"
    raise PlanoErro("não sei a classe de %s (ação, FII ou BDR): passe --classe ou rode o b3-scanner" % t)


def checar_custos(ref, cfg, calc, classe, estilo):
    """(previsto, avisos). Recusa por custo, salvo modo simulado com aviso configurado."""
    avisos = []
    rr_min = c.D(cfg["rr_min"])
    if calc["rr_bruto"] < rr_min:
        raise PlanoErro("reward:risk bruto %s já está abaixo do mínimo %s: afaste o alvo" % (
            c.num(calc["rr_bruto"]), c.num(rr_min)))
    try:
        dim = c.dimensionar(ref, cfg, calc["entrada"], calc["stop"], calc["alvo"], classe, estilo)
    except c.CustoDesconhecido as e:
        raise PlanoErro(str(e))
    problema = None
    if dim["qtd"] == 0:
        problema = ("quantidade zero: %s de risco por ação mais %s de corretagem de ida e volta não cabem no risco "
                    "de %s" % (c.rs(calc["risco_por_acao"]), c.rs(2 * c.corretagem(cfg, estilo)),
                               c.rs(cfg["risco_por_operacao"])))
    elif dim["rr_liquido"] is not None and dim["rr_liquido"] < rr_min:
        problema = ("reward:risk depois dos custos é %s, abaixo do mínimo %s (bruto %s; custos de ida e volta %s)"
                    % (c.num(dim["rr_liquido"]), c.num(rr_min), c.num(dim["rr_bruto"]), c.rs(dim["custos_alvo"])))
    if not problema:
        return dim, avisos
    if cfg.get("modo") == "simulado" and cfg.get("custo_alto_no_simulado") == "avisar":
        sim = c.dimensionar(ref, cfg, calc["entrada"], calc["stop"], calc["alvo"], classe, estilo, ignorar_custos=True)
        if sim["qtd"] > 0:
            real = c.custos_estimados(ref, cfg, estilo, sim["qtd"], calc["entrada"], calc["stop"], calc["alvo"])
            sim["custos_reais"] = real
            avisos.append("SIMULADO: na conta real este plano seria BLOQUEADO por custo (%s). No simulado o tamanho "
                          "ignora a corretagem; o diário registra os custos reais (%s no stop, %s no alvo)" % (
                              problema, c.rs(real["custos_stop"]), c.rs(real["custos_alvo"])))
            sim["custo_alto_simulado"] = True
            return sim, avisos
    raise PlanoErro(problema)


# ---------------------------------------------------------------- barras

def barras_diarias(fontes, ticker, ate):
    regs = c.registros_cotahist(fontes, [ticker])
    return [b for b in c.serie_diaria(regs, ticker) if b["data"] < ate]


def barras_intradiarias(caminho, ref, dia, ate_slot=None, fuso=None):
    dias = c.sessoes_intradiarias(c.carregar_barras(caminho, ref, fuso), ref)
    s = dias.get(dia.isoformat()) or {}
    return [s[k] for k in sorted(s) if ate_slot is None or k <= ate_slot]


# ---------------------------------------------------------------- plano

def resolver_data(ref, cfg, a, agora):
    if a.data:
        d = c.data(a.data)
    else:
        ok, _, _ = c.checar_janela(ref, cfg, agora)
        if ok:
            d = agora.date()
        else:
            d, mot = c.proximo_pregao(ref, agora.date())
            if d is None:
                raise PlanoErro("não sei o próximo pregão: %s" % mot)
    ses, mot = c.sessao(ref, d)
    if not ses:
        raise PlanoErro("sem pregão em %s: %s" % (d.isoformat(), mot))
    return d, ses


def eventos_no_prazo(ref, inicio, fim, extras):
    out = []
    v = ref.get("vencimentos_opcoes_acoes") or {}
    for k, lista in v.items():
        if k.startswith("mensais") and isinstance(lista, list):
            out += [{"data": x, "evento": "vencimento mensal de opções sobre ações"} for x in lista
                    if inicio.isoformat() <= x <= fim.isoformat()]
    for e in extras or []:
        m = re.match(r"^(\d{4}-\d{2}-\d{2}):(.+)$", e.strip())
        if not m:
            raise PlanoErro("--evento quer AAAA-MM-DD:descrição (recebi %r)" % e)
        if inicio.isoformat() <= m.group(1) <= fim.isoformat():
            out.append({"data": m.group(1), "evento": m.group(2).strip()})
    return sorted(out, key=lambda x: x["data"])


def montar_plano(a, agora):
    ref = c.carregar_referencia(a.ref)
    cfg = c.carregar_config(a.config)
    universo = (c.ler_json(a.universo, obrigatorio=False) or {}).get("ativos") or []
    t = c.ticker_base(a.ticker)
    classe = classe_do_ticker(t, universo, a.classe)
    estilo = a.estilo
    d, ses = resolver_data(ref, cfg, a, agora)
    lim = c.limites_do_dia(ref, cfg, ses)
    avisos = []
    hora = None
    if estilo == "day":
        hora = c.hora(a.hora, "--hora") if a.hora else agora.time().replace(second=0, microsecond=0)
        if hora < lim["nao_antes"] or hora > lim["nao_depois"]:
            raise PlanoErro("entrada às %s fora da janela de %s a %s em %s" % (
                c.hm(hora), c.hm(lim["nao_antes"]), c.hm(lim["nao_depois"]), d.isoformat()))
    regra_txt = a.stop or ("or-mid" if estilo == "day" and a.or_high is not None else None)
    if not regra_txt:
        raise PlanoErro("diga o stop: --stop fundo:X, pct:X, preco:X ou atr:K (no day com faixa, or-mid é o padrão)")
    regra, param = ler_stop(regra_txt)
    alvo_regra, alvo_param = ler_alvo(a.alvo)
    atr = atr_n = None
    if regra == "atr":
        if estilo == "swing":
            bs = barras_diarias(a.fontes, t, d.isoformat())
            if len(bs) < 15:
                raise PlanoErro("stop atr precisa de 15 pregões de %s no COTAHIST antes de %s; há %d" % (
                    t, d.isoformat(), len(bs)))
        else:
            if not a.barras:
                raise PlanoErro("stop atr no day precisa de --barras (arquivo de 5 min)")
            corte = int((dt.datetime.combine(d, hora) - dt.datetime.combine(d, ses["abertura"])).total_seconds()
                        ) // c.CINCO_MIN - 1
            bs = barras_intradiarias(a.barras, ref, d, corte, a.fuso_csv)
            if len(bs) < 3:
                raise PlanoErro("stop atr precisa de pelo menos 3 barras fechadas antes da entrada; há %d" % len(bs))
        atr, atr_n = c.atr(bs)
    if a.entrada is None:
        raise PlanoErro("diga a entrada: --entrada PREÇO (o nível em que a ordem limitada fica)")
    calc = calcular(ref, a.entrada, regra, param, alvo_regra, alvo_param, a.or_high, a.or_low, atr, atr_n)
    piso_pct = c.D(cfg.get("risco_min_pct_preco", 0.3))
    piso = calc["entrada"] * piso_pct / 100
    if calc["risco_por_acao"] < piso:
        raise PlanoErro("risco de %s por ação é menor que %s%% do preço (%s): apertado demais para o spread e o "
                        "ruído da B3. Afaste o stop." % (c.rs(calc["risco_por_acao"]), c.num(piso_pct, 1),
                                                         c.rs(c.cent(piso))))
    previsto, av = checar_custos(ref, cfg, calc, classe, estilo)
    avisos += av
    plano = {"criado_por": "b3-plano", "criado_em": agora.strftime("%Y-%m-%d %H:%M"), "modo": cfg.get("modo"),
             "ticker": t, "classe": classe, "estilo": estilo, "setup": a.setup or ("orb" if a.or_high else "nivel"),
             "data": d.isoformat(), "lado": "compra", "entrada": float(calc["entrada"]), "regra_stop": regra_txt,
             "stop": float(calc["stop"]), "stop_rotulo": calc["stop_rotulo"], "stop_detalhe": calc["stop_detalhe"],
             "alvo": float(calc["alvo"]), "alvo_rotulo": calc["alvo_rotulo"],
             "alvo_r": float(alvo_param) if alvo_regra == "r" else float(calc["rr_bruto"]),
             "risco_por_acao": float(calc["risco_por_acao"]),
             "risco_pct": float(c.cent(calc["risco_por_acao"] / calc["entrada"] * 100)),
             "rr_bruto": float(calc["rr_bruto"]),
             "previsto": {"qtd": previsto["qtd"], "perda_total": float(previsto["perda_total"]),
                          "custos_stop": float(previsto["custos_stop"]), "custos_alvo": float(previsto["custos_alvo"]),
                          "ganho_liquido": float(previsto["ganho_liquido"]),
                          "rr_liquido": float(previsto["rr_liquido"]) if previsto["rr_liquido"] is not None else None,
                          "ignorou_custos": previsto["ignorou_custos"],
                          "perda_total_real": float(previsto["custos_reais"]["perda_total"])
                          if previsto.get("custos_reais") else None,
                          "rr_liquido_real": float(previsto["custos_reais"]["rr_liquido"])
                          if previsto.get("custos_reais") and previsto["custos_reais"]["rr_liquido"] is not None
                          else None},
             "custo_alto_simulado": bool(previsto.get("custo_alto_simulado")),
             "janela": [c.hm(lim["nao_antes"]), c.hm(lim["nao_depois"])], "nota": NOTA_STOP}
    if atr is not None:
        plano.update({"atr": round(atr, 4), "atr_barras": atr_n})
    if a.or_high is not None:
        plano["faixa_abertura"] = {"maxima": a.or_high, "minima": a.or_low, "minutos": 15}
    if estilo == "day":
        plano.update({"hora_entrada": c.hm(hora), "zerar_ate": c.hm(lim["zerar_ate"])})
    else:
        prazo = int(a.prazo or cfg.get("prazo_swing_pregoes", 10))
        vence, mot = c.somar_pregoes(ref, d, prazo)
        if vence is None:
            avisos.append("o prazo de %d pregões cruza um ano sem calendário: %s" % (prazo, mot))
            fim = d + dt.timedelta(days=int(prazo * 1.5))
        else:
            fim = vence
        plano.update({"prazo_pregoes": prazo, "vence_em": vence.isoformat() if vence else None})
        ev = eventos_no_prazo(ref, d, fim, a.evento)
        plano["eventos_no_prazo"] = ev
        if ev:
            avisos.append("eventos no prazo (risco de gap): " + "; ".join("%s %s" % (x["data"], x["evento"])
                                                                          for x in ev))
        avisos.append("a ordem limitada deve ser digitada entre %s e %s do pregão" % tuple(plano["janela"]))
    if d != agora.date():
        avisos.append("plano para %s, não para hoje (%s)" % (d.isoformat(), agora.date().isoformat()))
    plano["avisos"] = avisos
    return plano


def descrever(p):
    linhas = ["Plano %s %s (%s), %s, compra, setup %s." % (p["ticker"], p["estilo"], p["classe"], p["data"],
                                                          p["setup"])]
    linhas.append("  Entrada       %s%s (ordem limitada)" % (c.rs(p["entrada"]),
                                                            (" às %s" % p["hora_entrada"]) if p.get("hora_entrada")
                                                            else ""))
    linhas.append("  Stop          %s  %s%s" % (c.rs(p["stop"]), p["stop_rotulo"],
                                                (": " + p["stop_detalhe"]) if p.get("stop_detalhe") else ""))
    linhas.append("  Alvo          %s  %s" % (c.rs(p["alvo"]), p["alvo_rotulo"]))
    linhas.append("  Risco/ação    %s (%s da entrada); reward:risk bruto %s" % (
        c.rs(p["risco_por_acao"]), c.pct(p["risco_pct"]), c.num(p["rr_bruto"])))
    pv = p["previsto"]
    if pv["qtd"] and pv["ignorou_custos"]:
        linhas.append("  Previsto      %d unidades (simulado, tamanho sem corretagem); perda no stop %s sem custos, "
                      "%s com os custos reais; reward:risk líquido real %s" % (
                          pv["qtd"], c.rs(pv["perda_total"]), c.rs(pv.get("perda_total_real") or 0),
                          c.num(pv["rr_liquido_real"]) if pv.get("rr_liquido_real") is not None else "n/d"))
    elif pv["qtd"]:
        linhas.append("  Previsto      %d unidades; perda no stop com custos %s; reward:risk líquido %s" % (
            pv["qtd"], c.rs(pv["perda_total"]), c.num(pv["rr_liquido"]) if pv["rr_liquido"] is not None else "n/d"))
    if p["estilo"] == "day":
        linhas.append("  Saída         zerar até %s, ganhe ou perca" % p["zerar_ate"])
    else:
        linhas.append("  Saída         stop, alvo ou fechamento do %dº pregão (%s)" % (
            p["prazo_pregoes"], p.get("vence_em") or "data desconhecida"))
    linhas.append("Definido antes da entrada. Se o preço tocar o stop, a operação acabou; nunca afaste o stop.")
    linhas.append(NOTA_STOP)
    for x in p.get("avisos") or []:
        linhas.append("Aviso: " + x + ".")
    return linhas


def cmd_plano(a):
    ref = c.carregar_referencia(a.ref)
    agora = c.agora_local(ref, a.agora)
    p = montar_plano(a, agora)
    if a.write:
        c.gravar_json(a.write, p)
    for x in c.rodape(descrever(p) + (["Gravei %s." % a.write] if a.write else []) +
                      ["Próximo passo: b3-replay, depois b3-risco. Nada foi enviado."]):
        print(x)
    return 0


# ---------------------------------------------------------------- gatilho

def gatilho_swing(fontes, ticker, nivel, dia):
    regs = c.registros_cotahist(fontes, [ticker])
    serie = [b for b in c.serie_diaria(regs, ticker) if b["data"] <= dia.isoformat()]
    if not serie or serie[-1]["data"] != dia.isoformat():
        return {"status": "sem-dados", "motivo": "sem fechamento oficial de %s em %s no COTAHIST" % (
            ticker, dia.isoformat())}
    b = serie[-1]
    if b["c"] > nivel:
        return {"status": "disparou", "fechamento": b["c"], "nivel": nivel,
                "motivo": "o fechamento de %s (%s) ficou acima de %s" % (b["data"], c.num(b["c"]), c.num(nivel))}
    return {"status": "aguardando", "fechamento": b["c"], "nivel": nivel,
            "motivo": "o fechamento de %s (%s) não passou de %s" % (b["data"], c.num(b["c"]), c.num(nivel))}


def gatilho_day(ref, cfg, barras, nivel, dia, corte):
    ses, mot = c.sessao(ref, dia)
    if not ses:
        return {"status": "sem-dados", "motivo": mot}
    s = c.sessoes_intradiarias(barras, ref).get(dia.isoformat()) or {}
    lim = c.limites_do_dia(ref, cfg, ses)
    if not s:
        return {"status": "sem-dados", "motivo": "sem barras de %s" % dia.isoformat()}
    for k in sorted(s):
        b = s[k]
        fecha = b["local"] + dt.timedelta(seconds=c.CINCO_MIN)
        if fecha > corte:
            break
        if fecha.time() < lim["nao_antes"] or fecha.time() > lim["nao_depois"]:
            continue
        if b["c"] > nivel:
            return {"status": "disparou", "hora": c.hm(fecha.time()), "preco": b["c"], "nivel": nivel,
                    "motivo": "a barra das %s fechou em %s, acima de %s" % (c.hm(b["local"].time()), c.num(b["c"]),
                                                                          c.num(nivel))}
    if corte.time() > lim["nao_depois"]:
        return {"status": "expirado", "motivo": "nenhum fechamento acima de %s até %s" % (
            c.num(nivel), c.hm(lim["nao_depois"]))}
    return {"status": "aguardando", "motivo": "nenhuma barra fechada acima de %s até %s" % (
        c.num(nivel), c.hm(corte.time()))}


def cmd_gatilho(a):
    ref = c.carregar_referencia(a.ref)
    cfg = c.carregar_config(a.config)
    agora = c.agora_local(ref, a.agora)
    dia = c.data(a.data) if a.data else agora.date()
    nivel = float(c.D(a.nivel))
    t = c.ticker_base(a.ticker)
    if a.estilo == "swing":
        r = gatilho_swing(a.fontes, t, nivel, dia)
    else:
        if not a.barras:
            raise PlanoErro("gatilho day precisa de --barras (5 min)")
        corte = dt.datetime.combine(dia, c.hora(a.at, "--at")) if a.at else agora
        r = gatilho_day(ref, cfg, c.carregar_barras(a.barras, ref, a.fuso_csv), nivel, dia, corte)
    print("%s %s: %s. %s." % (t, a.estilo, r["status"].upper(), r["motivo"]))
    if r["status"] == "disparou":
        print("Disparar não é comprar: monte o plano (stop e alvo) antes, com 'plano.py plano'.")
    print("Dados gratuitos ou de fechamento não cronometram ordem; o gatilho real é visto na plataforma da XP.")
    print(c.AVISO)
    return 0 if r["status"] == "disparou" else 1


def cmd_mostrar(a):
    p = c.ler_json(a.plano, "plano (rode 'plano.py plano --write')")
    for x in c.rodape(descrever(p)):
        print(x)
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description="b3-plano: entrada, stop, alvo e saída antes da entrada.")
    sub = ap.add_subparsers(dest="cmd")

    def comum(p):
        p.add_argument("--ref", default=c.REF_PADRAO)
        p.add_argument("--config", default=c.CONFIG_PADRAO)
        p.add_argument("--agora")
        p.add_argument("--fontes", nargs="*", default=[c.pasta_cotahist()])
        p.add_argument("--fuso-csv", type=float)

    p = sub.add_parser("plano")
    comum(p)
    p.add_argument("--ticker", required=True)
    p.add_argument("--classe", choices=["acao", "fii", "bdr"])
    p.add_argument("--estilo", choices=["swing", "day"], default="swing")
    p.add_argument("--setup")
    p.add_argument("--entrada", type=str)
    p.add_argument("--stop")
    p.add_argument("--alvo", default="2R")
    p.add_argument("--data")
    p.add_argument("--hora")
    p.add_argument("--prazo", type=int)
    p.add_argument("--evento", action="append", help="AAAA-MM-DD:descrição (data-com, resultado...)")
    p.add_argument("--or-high", type=float)
    p.add_argument("--or-low", type=float)
    p.add_argument("--barras", help="arquivo de barras de 5 min para atr no day")
    p.add_argument("--universo", default="trader/universo.json")
    p.add_argument("--write", nargs="?", const="trader/plan.json")
    p = sub.add_parser("gatilho")
    comum(p)
    p.add_argument("ticker")
    p.add_argument("--nivel", required=True)
    p.add_argument("--estilo", choices=["swing", "day"], default="swing")
    p.add_argument("--data")
    p.add_argument("--at")
    p.add_argument("--barras")
    p = sub.add_parser("mostrar")
    p.add_argument("--plano", default="trader/plan.json")
    a = ap.parse_args(argv)
    if not a.cmd:
        ap.print_help()
        return 1
    try:
        return {"plano": cmd_plano, "gatilho": cmd_gatilho, "mostrar": cmd_mostrar}[a.cmd](a)
    except c.B3Erro as e:
        print("plano.py: %s" % e, file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
