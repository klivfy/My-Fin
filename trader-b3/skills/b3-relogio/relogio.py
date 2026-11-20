#!/usr/bin/env python3
"""b3-relogio: o relógio da B3 para o pacote trader-b3. Só biblioteca padrão.

    python relogio.py init                         # copia referencia_b3.json e config.example.json para trader/
    python relogio.py status                       # aberto, call, fechado; próximo pregão; janela; zerar-até
    python relogio.py status --agora "2026-11-09 10:20"
    python relogio.py janela                       # sai 0 se entradas são permitidas agora, 1 se não
    python relogio.py zerar-ate --data 2026-11-09  # horário de zerar day trade (sempre antes do call)
    python relogio.py verificar                    # fatos voláteis vencidos ou perto de vencer
    python relogio.py diagnostico --ticker PETR4   # testa Yahoo e brapi NA SUA MÁQUINA contra o COTAHIST

Fuso, grade horária, feriados e sessões especiais vêm de trader/referencia_b3.json.
Ano sem calendário: 'calendário desconhecido' e entradas bloqueadas. Grade vencida: idem.
Janela padrão: nada antes de 15 min após a abertura (10:15) e nada depois de 40 min antes
do fim da negociação (17:15). Zerar: 15 min antes do fim (17:40). Tudo relativo à grade do
dia, então acompanha a troca de março sem editar o código.
Nenhuma ordem é enviada. Material educacional; não é recomendação de investimento.
"""

import argparse
import datetime as dt
import json
import os
import shutil
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)
import b3comum as c  # noqa: E402


def cmd_init(a):
    os.makedirs(a.pasta, exist_ok=True)
    feitos = []
    ref_dst = os.path.join(a.pasta, "referencia_b3.json")
    ref_src = os.path.join(AQUI, "referencia_b3.json")
    if not os.path.exists(ref_dst) or a.forcar:
        shutil.copyfile(ref_src, ref_dst)
        feitos.append("copiei %s" % ref_dst)
    else:
        with open(ref_src, encoding="utf-8") as f1, open(ref_dst, encoding="utf-8") as f2:
            if json.load(f1) != json.load(f2):
                feitos.append("%s já existe e difere da versão da skill: compare antes de usar --forcar" % ref_dst)
            else:
                feitos.append("%s já está igual à da skill" % ref_dst)
    cfg_dst = os.path.join(a.pasta, "config.json")
    if not os.path.exists(cfg_dst) or a.forcar:
        with open(os.path.join(AQUI, "config.example.json"), encoding="utf-8") as fh:
            cfg = json.load(fh)
        ref = c.carregar_referencia(ref_dst)
        hoje = c.agora_local(ref, a.agora).date().isoformat()
        cfg["fases"]["1"]["inicio"] = cfg["fases"]["1"].get("inicio") or hoje
        c.gravar_json(cfg_dst, cfg)
        feitos.append("criei %s (fase 1, modo simulado, início da fase 1 em %s)" % (cfg_dst, hoje))
    else:
        feitos.append("%s já existe: não mexi" % cfg_dst)
    for f in feitos:
        print(f)
    print("Revise trader/config.json: capital, limites e a corretagem da sua nota.")
    print(c.AVISO)
    return 0


def resumo_status(ref, cfg, agora):
    ok, motivos, em = c.checar_janela(ref, cfg, agora)
    out = {"agora": agora.strftime("%Y-%m-%d %H:%M"), "estado": em["estado"], "motivo": em.get("motivo"),
           "proximo_pregao": em.get("proximo_pregao"), "entradas_permitidas": ok, "motivos_janela": motivos}
    if "sessao" in em:
        s = em["sessao"]
        out.update({"abertura": c.hm(s["abertura"]), "fim_negociacao": c.hm(s["fim_negociacao"]),
                    "fim_call": c.hm(s["fim_call"]), "grade": s["grade"], "sessao_especial": s.get("especial")})
        lim = em.get("limites") or c.limites_do_dia(ref, cfg, s)
        out.update({"janela": [c.hm(lim["nao_antes"]), c.hm(lim["nao_depois"])], "zerar_ate": c.hm(lim["zerar_ate"])})
    if em.get("motivo_proximo"):
        out["motivo_proximo"] = em["motivo_proximo"]
    return out


NOMES = {"pre-abertura": "PRÉ-ABERTURA", "aberto": "ABERTO", "call": "CALL DE FECHAMENTO", "fechado": "FECHADO",
         "desconhecido": "DESCONHECIDO"}


def cmd_status(a):
    ref = c.carregar_referencia(a.ref)
    cfg = c.carregar_config(a.config)
    agora = c.agora_local(ref, a.agora)
    s = resumo_status(ref, cfg, agora)
    if a.json:
        print(json.dumps(s, indent=2, ensure_ascii=False))
        return 0
    linhas = ["B3 às %s (Brasília): %s." % (agora.strftime("%d/%m/%Y %H:%M"), NOMES[s["estado"]])]
    if s.get("abertura"):
        linhas.append("Negociação %s a %s; call de fechamento até %s (grade %s)." % (
            s["abertura"], s["fim_negociacao"], s["fim_call"], s["grade"]))
        if s.get("sessao_especial"):
            linhas.append("Sessão especial: %s." % s["sessao_especial"])
        linhas.append("Janela de entradas: %s a %s. Zerar day trade até %s." % (s["janela"][0], s["janela"][1],
                                                                           s["zerar_ate"]))
    elif s.get("motivo"):
        linhas.append("Motivo: %s." % s["motivo"])
    if s["entradas_permitidas"]:
        linhas.append("Entradas agora: permitidas.")
    elif s.get("motivo") and s["estado"] in ("desconhecido", "fechado") and not s.get("abertura"):
        linhas.append("Entradas agora: bloqueadas.")
    else:
        linhas.append("Entradas agora: bloqueadas (%s)." % "; ".join(s["motivos_janela"]))
    if s.get("proximo_pregao"):
        linhas.append("Próximo pregão: %s." % s["proximo_pregao"])
    elif s.get("motivo_proximo"):
        mesmo = s.get("motivo_proximo") == s.get("motivo")
        linhas.append("Próximo pregão: desconhecido%s." % ("" if mesmo else " (%s)" % s["motivo_proximo"]))
    for x in c.rodape(linhas):
        print(x)
    return 0


def cmd_janela(a):
    ref = c.carregar_referencia(a.ref)
    cfg = c.carregar_config(a.config)
    agora = c.agora_local(ref, a.agora)
    ok, motivos, em = c.checar_janela(ref, cfg, agora)
    if ok:
        lim = em["limites"]
        print("PERMITIDO: entradas de %s a %s; agora são %s." % (c.hm(lim["nao_antes"]), c.hm(lim["nao_depois"]),
                                                                  agora.strftime("%H:%M")))
    else:
        print("BLOQUEADO: " + "; ".join(motivos) + ".")
    print(c.AVISO)
    return 0 if ok else 1


def cmd_zerar(a):
    ref = c.carregar_referencia(a.ref)
    cfg = c.carregar_config(a.config)
    d = c.data(a.data) if a.data else c.agora_local(ref, a.agora).date()
    ses, mot = c.sessao(ref, d)
    if not ses:
        print("Sem sessão em %s: %s." % (d.isoformat(), mot))
        print(c.AVISO)
        return 1
    lim = c.limites_do_dia(ref, cfg, ses)
    print("Zerar day trade até %s em %s (negociação termina %s; call até %s)." % (
        c.hm(lim["zerar_ate"]), d.isoformat(), c.hm(ses["fim_negociacao"]), c.hm(ses["fim_call"])))
    print(c.AVISO)
    return 0


def _fatos(doc, caminho=""):
    """Itera (caminho, dict) de todo nó com consultado_em ou reverificar_ate."""
    if isinstance(doc, dict):
        if "consultado_em" in doc or "reverificar_ate" in doc:
            yield caminho, doc
        for k, v in doc.items():
            yield from _fatos(v, (caminho + "." + k) if caminho else k)
    elif isinstance(doc, list):
        for i, v in enumerate(doc):
            yield from _fatos(v, "%s[%d]" % (caminho, i))


def verificar(ref, cfg, hoje, idade_max=180, antecedencia=30):
    alertas = []
    for cam, no in _fatos(ref):
        if no.get("reverificar_ate"):
            lim = c.data(no["reverificar_ate"])
            if hoje > lim:
                alertas.append(("VENCIDO", cam, "reverificar até %s" % lim.isoformat()))
            elif (lim - hoje).days <= antecedencia:
                alertas.append(("PERTO", cam, "reverificar até %s (faltam %d dias)" % (lim.isoformat(),
                                                                                     (lim - hoje).days)))
        if no.get("consultado_em"):
            idade = (hoje - c.data(no["consultado_em"])).days
            if idade > idade_max:
                alertas.append(("ANTIGO", cam, "consultado há %d dias (%s)" % (idade, no["consultado_em"])))
    prox = str(hoje.year + 1)
    if not (ref.get("feriados") or {}).get(prox) and hoje.month == 12:
        alertas.append(("PERTO", "feriados." + prox, "calendário de %s ainda não está na referência" % prox))
    if not (ref.get("feriados") or {}).get(str(hoje.year)):
        alertas.append(("VENCIDO", "feriados.%d" % hoje.year, "calendário do ano corrente ausente: entradas bloqueadas"))
    if cfg is not None:
        corr = cfg.get("corretagem") or {}
        for est in ("swing", "day"):
            if corr.get(est) is None:
                alertas.append(("VENCIDO", "config.corretagem." + est,
                                "custo desconhecido: entradas de %s bloqueadas" % est))
    pend = (ref.get("ir") or {}).get("pendencia")
    if pend:
        alertas.append(("PENDENTE", "ir", pend))
    return alertas


def cmd_verificar(a):
    ref = c.carregar_referencia(a.ref)
    cfg = c.carregar_config(a.config, exigir=False) if os.path.exists(a.config) else None
    hoje = c.agora_local(ref, a.agora).date()
    alertas = verificar(ref, cfg, hoje)
    if not alertas:
        print("Nenhum fato vencido ou perto de vencer em %s." % hoje.isoformat())
    for nivel, cam, msg in alertas:
        print("%-8s %s: %s" % (nivel, cam, msg))
    print("Roteiro de reverificação: docs/MANUTENCAO.md.")
    print(c.AVISO)
    return 1 if any(n == "VENCIDO" for n, _, _ in alertas) else 0


# ---------------------------------------------------------------- diagnóstico de dados

def avaliar_intradiario(barras, ref, fechamentos=None):
    """Para cada pregão: primeira e última barra de 5 min, se cobre a sessão, e a diferença entre o
    último fechamento das barras e o fechamento oficial (COTAHIST), quando disponível."""
    dias = c.sessoes_intradiarias(barras, ref)
    out = []
    for d, slots in sorted(dias.items()):
        ses, _ = c.sessao(ref, c.data(d))
        base = dt.date(2000, 1, 3)
        n_total = int((dt.datetime.combine(base, ses["fim_negociacao"]) -
                       dt.datetime.combine(base, ses["abertura"])).total_seconds()) // c.CINCO_MIN
        ks = sorted(slots)
        prim, ult = slots[ks[0]], slots[ks[-1]]
        item = {"data": d, "primeira": c.hm(prim["local"].time()), "ultima": c.hm(ult["local"].time()),
                "barras": len(ks), "esperadas": n_total, "abre_completo": ks[0] == 0,
                "fecha_completo": ks[-1] == n_total - 1, "ultimo_fechamento_barras": ult["c"]}
        if fechamentos and d in fechamentos:
            item["fechamento_oficial"] = fechamentos[d]
            item["diferenca"] = round(ult["c"] - fechamentos[d], 2)
        out.append(item)
    return out


def veredito_intradiario(dias):
    if not dias:
        return "sem barras dentro do pregão"
    abre = sum(1 for d in dias if d["abre_completo"])
    fecha = sum(1 for d in dias if d["fecha_completo"])
    if abre == len(dias) and fecha == len(dias):
        return "completo nos %d pregões: serve para ORB e replay intradiário" % len(dias)
    partes = []
    if abre < len(dias):
        partes.append("faltam barras da abertura em %d de %d pregões (ORB de 15 min fica impossível)" % (
            len(dias) - abre, len(dias)))
    if fecha < len(dias):
        partes.append("faltam barras do fim em %d de %d pregões (replay encerra no último horário com dados)" % (
            len(dias) - fecha, len(dias)))
    return "INCOMPLETO: " + "; ".join(partes)


def cmd_diagnostico(a):
    ref = c.carregar_referencia(a.ref)
    t = c.ticker_base(a.ticker)
    fontes = {}
    if a.offline:
        fontes["arquivo"] = c.carregar_barras(a.offline, ref)
    else:
        if a.fonte in ("yahoo", "ambos"):
            url = ref["fontes_de_dados"]["yahoo_chart"]["url_modelo"].replace("{TICKER}", t).replace(
                "range=60d", "range=1mo")
            try:
                fontes["yahoo"] = c.parse_yahoo(c.http_get(url).decode("utf-8", "replace"))
            except (c.B3Erro, ValueError) as e:
                fontes["yahoo"] = "falhou: %s" % e
        if a.fonte in ("brapi", "ambos"):
            url = ref["fontes_de_dados"]["brapi"]["url_modelo"].replace("{TICKER}", t)
            tok = os.environ.get("BRAPI_TOKEN")
            hdr = {"Authorization": "Bearer " + tok} if tok else None
            try:
                fontes["brapi"] = c.parse_brapi(c.http_get(url, cabecalhos=hdr).decode("utf-8", "replace"))
            except (c.B3Erro, ValueError) as e:
                fontes["brapi"] = "falhou: %s" % e
    fech = {}
    if a.cotahist:
        for r in c.registros_cotahist(a.cotahist, [t]):
            fech[r["data"]] = r["c"]
    rel = {"ticker": t, "gerado_em": c.agora_local(ref, a.agora).strftime("%Y-%m-%d %H:%M"), "fontes": {}}
    for nome, barras in fontes.items():
        if isinstance(barras, str):
            rel["fontes"][nome] = {"erro": barras}
            print("%s: %s" % (nome, barras))
            continue
        dias = avaliar_intradiario(barras, ref, fech)
        ver = veredito_intradiario(dias)
        rel["fontes"][nome] = {"dias": dias, "veredito": ver}
        print("%s, %s, barras de 5 min:" % (nome, t))
        for d in dias[-10:]:
            extra = ""
            if "fechamento_oficial" in d:
                extra = "; último %s vs oficial %s" % (c.num(d["ultimo_fechamento_barras"]),
                                                       c.num(d["fechamento_oficial"]))
            print("  %s  %s a %s  %d de %d barras%s" % (d["data"], d["primeira"], d["ultima"], d["barras"],
                                                       d["esperadas"], extra))
        print("  Veredito: %s." % ver)
    if a.write:
        c.gravar_json(a.write, rel)
        print("Gravei %s." % a.write)
    print("Dados gratuitos com atraso servem para estudo e triagem, não para cronometrar ordem.")
    print(c.AVISO)
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description="b3-relogio: relógio e calendário da B3.")
    sub = ap.add_subparsers(dest="cmd")

    def comum(p):
        p.add_argument("--ref", default=c.REF_PADRAO)
        p.add_argument("--config", default=c.CONFIG_PADRAO)
        p.add_argument("--agora", help='Brasília, "AAAA-MM-DD HH:MM"')

    p = sub.add_parser("init")
    p.add_argument("--pasta", default=c.PASTA)
    p.add_argument("--forcar", action="store_true")
    p.add_argument("--agora")
    p = sub.add_parser("status")
    comum(p)
    p.add_argument("--json", action="store_true")
    p = sub.add_parser("janela")
    comum(p)
    p = sub.add_parser("zerar-ate")
    comum(p)
    p.add_argument("--data")
    p = sub.add_parser("verificar")
    comum(p)
    p = sub.add_parser("diagnostico")
    comum(p)
    p.add_argument("--ticker", default="PETR4")
    p.add_argument("--fonte", choices=["yahoo", "brapi", "ambos"], default="ambos")
    p.add_argument("--offline", help="arquivo de barras (Yahoo, brapi ou CSV do MT5) em vez da rede")
    p.add_argument("--cotahist", nargs="*", default=[c.pasta_cotahist()], help="arquivos ou pastas COTAHIST")
    p.add_argument("--write", nargs="?", const="trader/state/diagnostico.json")
    a = ap.parse_args(argv)
    if not a.cmd:
        ap.print_help()
        return 1
    try:
        return {"init": cmd_init, "status": cmd_status, "janela": cmd_janela, "zerar-ate": cmd_zerar,
                "verificar": cmd_verificar, "diagnostico": cmd_diagnostico}[a.cmd](a)
    except c.B3Erro as e:
        print("relogio.py: %s" % e, file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
