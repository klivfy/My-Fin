#!/usr/bin/env python3
"""b3-diario: diário de operações, métricas, fase e apuração de IR por modalidade, no pacote trader-b3.
Absorve o trader-journal do original. Só biblioteca padrão.

    python diario.py registrar --ativo BBAS3 --entrada 17.20 --stop 16.42 --saida 18.76 --quantidade 6 \\
        --data 2026-11-12 --data-entrada 2026-11-09 --setup repique --motivo alvo --emocao calmo
    python diario.py metricas [--modo simulado|real|todos] [--desde 2026-10-01]
    python diario.py fase                      # o que o diário comprova e o que falta
    python diario.py ir --mes 2026-11          # estimativa por modalidade, com prejuízo acumulado

O b3-ticket já grava a saída executada; 'registrar' serve para o que foi feito fora dele (papel, conta
demo). Custos sempre pela corretagem do config e emolumentos da referência. Amostra menor que 30:
INCONCLUSIVA. IR: estimativa pelas regras de referencia_b3.json; não substitui contador nem a nota.
Material educacional; não é recomendação de investimento.
"""

import argparse
import datetime as dt
import os
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)
import b3comum as c  # noqa: E402

D = c.D
AMOSTRA_MIN = 30
GRUPO = {"acoes_swing": "comum", "bdr_swing": "comum", "opcoes_swing": "comum", "acoes_day": "day", "bdr_day": "day",
         "opcoes_day": "day", "fii_ganho_capital": "fii"}
NOME_GRUPO = {"comum": "operações comuns (swing)", "day": "day trade", "fii": "FII"}
AVISO_IR = ("Estimativa pelas regras de referencia_b3.json. Não substitui contador, a nota de corretagem nem o "
            "programa da Receita.")


class DiarioErro(c.B3Erro):
    pass


def modalidade(classe, estilo):
    base = {"acao": "acoes", "bdr": "bdr", "opcao": "opcoes", "fii": "fii_ganho_capital"}.get(classe, "acoes")
    if base == "fii_ganho_capital":
        return base
    return base + ("_day" if estilo == "day" else "_swing")


def imprimir(linhas):
    for x in c.rodape(linhas):
        print(x)


# ---------------------------------------------------------------- registrar

def cmd_registrar(a):
    ref = c.carregar_referencia(a.ref)
    cfg = c.carregar_config(a.config)
    hoje = c.agora_local(ref, a.agora).date().isoformat()
    data = a.data or hoje
    data_ent = a.data_entrada or data
    c.data(data)
    c.data(data_ent)
    if data_ent > data:
        raise DiarioErro("a entrada (%s) não pode ser depois da saída (%s)" % (data_ent, data))
    if a.estilo == "day" and data_ent != data:
        raise DiarioErro("day trade entra e sai no mesmo dia (entrada %s, saída %s)" % (data_ent, data))
    e, s, x = D(a.entrada, "entrada"), D(a.stop, "stop"), D(a.saida, "saída")
    if not 0 < s < e:
        raise DiarioErro("o stop precisa ficar abaixo da entrada: sem stop não há R para medir")
    if a.quantidade <= 0:
        raise DiarioErro("quantidade precisa ser positiva")
    custos, liq, r = c.resultado_operacao(ref, cfg, a.estilo, a.quantidade, e, x, s)
    modo = a.modo or cfg.get("modo") or "simulado"
    linha = {"data": data, "data_entrada": data_ent, "ativo": c.ticker_base(a.ativo), "classe": a.classe,
             "estilo": a.estilo, "setup": a.setup, "entrada": float(e), "stop": float(s),
             "alvo": float(D(a.alvo)) if a.alvo else "", "quantidade": a.quantidade, "saida": float(x),
             "custos": float(custos), "resultado_rs": float(liq), "resultado_r": float(r) if r is not None else "",
             "motivo_saida": a.motivo, "emocao": a.emocao or "", "nota": a.nota or "", "modo": modo}
    c.anexar_diario(a.diario, linha)
    imprimir(["Registrado (%s): %s %d de %s a %s; custos %s; resultado %s (%sR)." % (
        modo.upper(), linha["ativo"], a.quantidade, c.rs(e), c.rs(x), c.rs(custos), c.rs(liq), c.num(r)),
        "O registro conta para os limites do dia e do mês e para a fase."])
    return 0


# ---------------------------------------------------------------- métricas

def metricas(linhas):
    ops = [x for x in linhas if x.get("resultado_rs") is not None]
    n = len(ops)
    if not n:
        return {"n": 0}
    rs = [x["resultado_rs"] for x in ops]
    rr = [x["resultado_r"] for x in ops if x.get("resultado_r") is not None]
    ganhos = [v for v in rs if v > 0]
    perdas = [v for v in rs if v <= 0]
    seq = maior = 0
    for v in rs:
        seq = seq + 1 if v <= 0 else 0
        maior = max(maior, seq)
    pico = acum = dd = 0.0
    for v in rs:
        acum += v
        pico = max(pico, acum)
        dd = min(dd, acum - pico)
    media_g = sum(ganhos) / len(ganhos) if ganhos else 0.0
    media_p = sum(perdas) / len(perdas) if perdas else 0.0
    return {"n": n, "acerto": len(ganhos) / n, "media_ganho": media_g, "media_perda": media_p,
            "payoff": (media_g / abs(media_p)) if ganhos and media_p else None, "expectativa_rs": sum(rs) / n,
            "expectativa_r": (sum(rr) / len(rr)) if rr else None, "resultado": sum(rs),
            "custos": sum(x.get("custos") or 0 for x in ops), "maior_seq_perdas": maior, "drawdown": dd}


def texto_metricas(m, titulo):
    if not m["n"]:
        return ["%s: nenhuma operação." % titulo]
    linhas = ["%s: %d operações; resultado %s; custos pagos %s." % (titulo, m["n"], c.rs(m["resultado"]),
                                                                    c.rs(m["custos"])),
              "  acerto %s; ganho médio %s; perda média %s; payoff %s" % (
                  c.pct(100 * m["acerto"], 1), c.rs(m["media_ganho"]), c.rs(m["media_perda"]),
                  c.num(m["payoff"]) if m["payoff"] is not None else "indefinido"),
              "  expectativa %s por operação%s; maior sequência de perdas %d; maior queda acumulada %s" % (
                  c.rs(m["expectativa_rs"]), (" (%sR)" % c.num(m["expectativa_r"], 3))
                  if m["expectativa_r"] is not None else "", m["maior_seq_perdas"], c.rs(m["drawdown"]))]
    if m["n"] < AMOSTRA_MIN:
        linhas.append("  INCONCLUSIVO: %d operações, menos de %d. Não conclua nada sobre o método ainda." % (
            m["n"], AMOSTRA_MIN))
    return linhas


def agrupar(linhas, chave):
    g = {}
    for x in linhas:
        g.setdefault(x.get(chave) or "?", []).append(x)
    return g


def cmd_metricas(a):
    cfg = c.carregar_config(a.config)
    todas = sorted(c.ler_diario(a.diario), key=lambda x: (x.get("data") or "", x.get("data_entrada") or ""))
    if a.desde:
        todas = [x for x in todas if (x.get("data") or "") >= a.desde]
    modos = ["simulado", "real"] if a.modo == "todos" else [a.modo or cfg.get("modo") or "simulado"]
    out = []
    for modo in modos:
        ls = [x for x in todas if x.get("modo") == modo]
        out += texto_metricas(metricas(ls), "Modo %s" % modo)
        for chave in ("setup", "classe", "estilo"):
            for k, grupo in sorted(agrupar(ls, chave).items()):
                m = metricas(grupo)
                if m["n"]:
                    out.append("  por %-7s %-15s %3d ops; acerto %s; expectativa %s%s" % (
                        chave, k, m["n"], c.pct(100 * m["acerto"], 0), c.rs(m["expectativa_rs"]),
                        "; inconclusivo" if m["n"] < AMOSTRA_MIN else ""))
        emo = [x for x in ls if x.get("emocao")]
        for k, grupo in sorted(agrupar(emo, "emocao").items()):
            out.append("  emoção  %-15s %3d ops; resultado %s" % (k, len(grupo),
                                                                 c.rs(sum(x["resultado_rs"] for x in grupo))))
    imprimir(out)
    return 0


# ---------------------------------------------------------------- fase

def cmd_fase(a):
    ref = c.carregar_referencia(a.ref)
    cfg = c.carregar_config(a.config)
    hoje = c.agora_local(ref, a.agora).date()
    diario = c.ler_diario(a.diario)
    f, mot, nums = c.fase_verificada(cfg, diario, hoje)
    linhas = ["Fase: o config diz %d; o diário comprova %d." % (nums["declarada"], f)]
    semanas = int(cfg.get("semanas_fase1", 4))
    i1 = ((cfg.get("fases") or {}).get("1") or {}).get("inicio")
    if not i1:
        linhas.append("Início da fase 1 não registrado: grave a data em config 'fases'.")
    else:
        sim = {c.data(x["data_entrada"] or x["data"]).isocalendar()[:2] for x in diario
               if x.get("modo") == "simulado" and (x.get("data_entrada") or x.get("data")) >= i1}
        libera = c.data(i1) + dt.timedelta(weeks=semanas)
        linhas.append("Fase 1 desde %s: simulado em %d de %d semanas; tempo mínimo cumprido em %s." % (
            i1, len(sim), semanas, libera.isoformat()))
    i2 = ((cfg.get("fases") or {}).get("2") or {}).get("inicio")
    crit = cfg.get("criterio_fase3") or {}
    if i2:
        dts = [x for x in diario if x.get("modo") == "simulado" and x.get("estilo") == "day"
               and (x.get("data_entrada") or x.get("data")) >= i2]
        m = metricas(dts)
        linhas.append("Critério da fase 3: %d de %d day trades simulados desde %s; expectativa %s (precisa passar "
                      "de %s)." % (m["n"], int(crit.get("operacoes_min", 30)), i2,
                                   c.rs(m["expectativa_rs"]) if m["n"] else "sem dados",
                                   c.rs(crit.get("expectativa_min_rs", 0))))
    linhas += ["Falta: %s." % x for x in mot]
    linhas.append("Mudar de fase é decisão sua no config; o pacote só reconhece o que o diário comprova.")
    imprimir(linhas)
    return 0


# ---------------------------------------------------------------- IR

def apurar_ir(ref, diario, mes, modo):
    """Mês a mês até 'mes', por grupo de compensação (comum, day, FII). Devolve o detalhe do mês pedido."""
    ir = ref.get("ir") or {}
    regras = ir.get("regras") or {}
    darf_min = float((ir.get("darf") or {}).get("valor_minimo") or 0)
    ops = [x for x in diario if x.get("modo") == modo and x.get("resultado_rs") is not None
           and (x.get("data") or "")[:7] <= mes]
    meses = sorted({x["data"][:7] for x in ops} | {mes})
    prejuizo = {"comum": 0.0, "day": 0.0, "fii": 0.0}
    acumulado = 0.0
    detalhe = None
    for m in meses:
        por_mod = {}
        for x in ops:
            if x["data"][:7] != m:
                continue
            d = por_mod.setdefault(modalidade(x.get("classe"), x.get("estilo")), {"lucro": 0.0, "vendas": 0.0, "n": 0})
            d["lucro"] += x["resultado_rs"]
            d["vendas"] += (x.get("quantidade") or 0) * (x.get("saida") or 0)
            d["n"] += 1
        grupos, isentos = {}, []
        for k, d in por_mod.items():
            r = regras.get(k)
            if not r:
                raise DiarioErro("referencia_b3.json não tem regra de IR para '%s'" % k)
            isen = r.get("isencao_vendas_mes_ate")
            if isen and d["vendas"] <= float(isen) and d["lucro"] > 0:
                isentos.append((k, d))
                continue
            g = grupos.setdefault(GRUPO[k], {"lucro": 0.0, "aliquota": float(r["aliquota"])})
            g["lucro"] += d["lucro"]
        imposto_mes, linhas_g = 0.0, []
        for g in ("comum", "day", "fii"):
            if g not in grupos:
                continue
            lucro, aliq = grupos[g]["lucro"], grupos[g]["aliquota"]
            base = lucro + prejuizo[g]
            imp = base * aliq if base > 0 else 0.0
            linhas_g.append((g, lucro, prejuizo[g], base, imp))
            imposto_mes += imp
            prejuizo[g] = min(base, 0.0)
        total = imposto_mes + acumulado
        pagar = total > 0 and total >= darf_min
        if m == mes:
            detalhe = {"por_modalidade": por_mod, "isentos": isentos, "grupos": linhas_g, "imposto_mes": imposto_mes,
                       "acumulado_anterior": acumulado, "total": total, "pagar": pagar,
                       "prejuizo_a_compensar": dict(prejuizo), "darf_min": darf_min}
        acumulado = 0.0 if pagar else total
    return detalhe


def cmd_ir(a):
    ref = c.carregar_referencia(a.ref)
    c.data(a.mes + "-01", "mês")
    det = apurar_ir(ref, c.ler_diario(a.diario), a.mes, a.modo)
    ir = ref.get("ir") or {}
    linhas = ["IR de %s, modo %s%s." % (a.mes, a.modo, " (exercício: simulado não paga imposto)"
                                        if a.modo == "simulado" else "")]
    for k, d in sorted(det["por_modalidade"].items()):
        linhas.append("  %-18s %2d ops; vendas %s; resultado líquido %s" % (k, d["n"], c.rs(d["vendas"]),
                                                                           c.rs(d["lucro"])))
    for k, d in det["isentos"]:
        linhas.append("  %s: vendas de %s no mês, dentro da isenção: lucro de %s isento" % (
            k, c.rs(d["vendas"]), c.rs(d["lucro"])))
    for g, lucro, prej, base, imp in det["grupos"]:
        linhas.append("  %s: resultado %s; prejuízo anterior %s; base %s; imposto %s" % (
            NOME_GRUPO[g], c.rs(lucro), c.rs(prej), c.rs(base), c.rs(imp)))
    if det["acumulado_anterior"]:
        linhas.append("  imposto abaixo do mínimo trazido de meses anteriores: %s" % c.rs(det["acumulado_anterior"]))
    darf = ir.get("darf") or {}
    if det["pagar"]:
        linhas.append("DARF estimado: %s (código %s, vence no %s). Desconte o IRRF que aparece na nota." % (
            c.rs(det["total"]), darf.get("codigo", "?"), darf.get("prazo", "prazo da referência")))
    elif det["total"] > 0:
        linhas.append("Imposto de %s abaixo do mínimo de %s para DARF: acumula para o mês seguinte." % (
            c.rs(det["total"]), c.rs(det["darf_min"])))
    else:
        linhas.append("Sem imposto no mês.")
    prej = [(g, v) for g, v in det["prejuizo_a_compensar"].items() if v < 0]
    if prej:
        linhas.append("Prejuízo a compensar: %s. %s" % (
            "; ".join("%s %s" % (NOME_GRUPO[g], c.rs(v)) for g, v in prej), ir.get("compensacao_prejuizo", "")))
    if ir.get("status_legislativo"):
        linhas.append("Regras: %s" % ir["status_legislativo"])
    if ir.get("pendencia"):
        linhas.append("Pendência da referência: %s" % ir["pendencia"])
    linhas.append(AVISO_IR)
    imprimir(linhas)
    return 0


# ---------------------------------------------------------------- main

def main(argv=None):
    ap = argparse.ArgumentParser(description="b3-diario: diário, métricas, fase e IR.")
    sub = ap.add_subparsers(dest="cmd")
    comuns = argparse.ArgumentParser(add_help=False)
    comuns.add_argument("--ref", default=c.REF_PADRAO)
    comuns.add_argument("--config", default=c.CONFIG_PADRAO)
    comuns.add_argument("--diario", default=os.path.join(c.PASTA, "diario.csv"))
    comuns.add_argument("--agora")
    p = sub.add_parser("registrar", parents=[comuns])
    p.add_argument("--ativo", required=True)
    p.add_argument("--classe", default="acao", choices=["acao", "fii", "bdr", "opcao"])
    p.add_argument("--estilo", default="swing", choices=["swing", "day"])
    p.add_argument("--setup", default="")
    p.add_argument("--entrada", required=True)
    p.add_argument("--stop", required=True)
    p.add_argument("--alvo")
    p.add_argument("--saida", required=True)
    p.add_argument("--quantidade", type=int, required=True)
    p.add_argument("--data")
    p.add_argument("--data-entrada")
    p.add_argument("--motivo", default="manual", choices=["stop", "alvo", "prazo", "zerar", "manual"])
    p.add_argument("--emocao")
    p.add_argument("--nota")
    p.add_argument("--modo", choices=["simulado", "real"])
    p = sub.add_parser("metricas", parents=[comuns])
    p.add_argument("--modo", choices=["simulado", "real", "todos"])
    p.add_argument("--desde")
    sub.add_parser("fase", parents=[comuns])
    p = sub.add_parser("ir", parents=[comuns])
    p.add_argument("--mes", required=True, help="AAAA-MM")
    p.add_argument("--modo", default="real", choices=["simulado", "real"])
    a = ap.parse_args(argv)
    if not a.cmd:
        ap.print_help()
        return 1
    try:
        return {"registrar": cmd_registrar, "metricas": cmd_metricas, "fase": cmd_fase, "ir": cmd_ir}[a.cmd](a)
    except c.B3Erro as e:
        print("diario.py: %s" % e, file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
