#!/usr/bin/env python3
"""b3-scanner: triagem de setups na B3 para o pacote trader-b3. Só biblioteca padrão.

    python scanner.py baixar --dias 60                 # COTAHIST oficial dos últimos 60 pregões (cache)
    python scanner.py baixar --anual 2025              # arquivo anual (cerca de 100 MB) para histórico longo
    python scanner.py universo                         # ações, FIIs e BDRs líquidos e que cabem no capital
    python scanner.py diario                           # setups diários do original sobre o universo
    python scanner.py orb --data 2026-11-10 --at 10:30 --offline barras/   # ORB 10:00 a 10:15, 5 min

Fonte primária do diário: COTAHIST da B3 (oficial, um arquivo por pregão, sem token). Preços do
COTAHIST não são ajustados: datas com salto acima de 35% são tratadas como provável evento
corporativo e o ativo fica fora da triagem até sair da janela, com aviso.

ORB: faixa de abertura = barras das 10:00, 10:05 e 10:10 (15 min, relativo à abertura da grade do
dia). Gatilho só em barra FECHADA acima da máxima da faixa. Sem as barras da faixa, o ativo sai
como 'dados incompletos': o Yahoo e a brapi gratuitos costumam começar depois das 10:15.

Uma triagem é uma lista de gráficos que batem uma regra, não uma lista do que comprar.
Material educacional; não é recomendação de investimento.
"""

import argparse
import csv
import datetime as dt
import io
import os
import sys
import zipfile

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)
import b3comum as c  # noqa: E402

NOTA = "Uma triagem é uma lista de gráficos que batem uma regra, não uma lista do que comprar."
AVISO_DADOS = ("Dados de fechamento oficiais (COTAHIST) servem para triagem depois do pregão. Dados intradiários "
               "gratuitos têm atraso e lacunas; servem para estudo e triagem, não para cronometrar ordem. O gatilho "
               "real é visto na plataforma da XP.")
MINIMOS = {"acao": 5_000_000.0, "fii": 1_000_000.0, "bdr": 1_000_000.0}


# ---------------------------------------------------------------- baixar

def cmd_baixar(a):
    ref = c.carregar_referencia(a.ref)
    pasta = a.pasta or c.pasta_cotahist()
    os.makedirs(pasta, exist_ok=True)
    if a.anual:
        modelo = ref["fontes_de_dados"]["cotahist_diario"]["url_modelo"]
        url = modelo.replace("COTAHIST_D{DDMMAAAA}", "COTAHIST_A%d" % a.anual)
        destino = os.path.join(pasta, "COTAHIST_A%d.ZIP" % a.anual)
        ano_atual = c.agora_local(ref, a.agora).year
        c.com_cache(url, destino, max_idade_h=None if a.anual < ano_atual else 12, timeout=600)
        print("Arquivo anual %d em %s." % (a.anual, destino))
        print(c.AVISO)
        return 0
    ate = c.data(a.ate) if a.ate else c.agora_local(ref, a.agora).date()
    datas, d = [], ate
    while len(datas) < a.dias:
        st, mot = c.info_dia(ref, d)
        if st == "desconhecido":
            print("Parei em %s: %s. Para histórico mais antigo use --anual." % (d.isoformat(), mot))
            break
        if st == "pregao":
            datas.append(d)
        d -= dt.timedelta(days=1)
    novos = falhas = 0
    for d in sorted(datas):
        destino = os.path.join(pasta, "COTAHIST_D%s.ZIP" % d.strftime("%d%m%Y"))
        if os.path.exists(destino):
            continue
        try:
            c.com_cache(c.url_cotahist(ref, d), destino)
            novos += 1
        except c.B3Erro as e:
            falhas += 1
            print("  %s: %s" % (d.isoformat(), e))
    print("COTAHIST: %d pregões pedidos, %d baixados agora, %d já em cache, %d falharam (pasta %s)." % (
        len(datas), novos, len(datas) - novos - falhas, falhas, pasta))
    print("O arquivo do dia sai na noite do pregão; antes disso a B3 pode responder erro.")
    print(c.AVISO)
    return 0 if not falhas else 1


# ---------------------------------------------------------------- universo

def montar_universo(regs, cfg, dias=20, minimos=None, presenca=0.9, fca=None):
    """(itens, contagem, última data). Liquidez = volume financeiro médio dos últimos `dias` pregões."""
    minimos = minimos or MINIMOS
    datas = sorted({r["data"] for r in regs})[-dias:]
    if len(datas) < dias:
        raise c.B3Erro("universo precisa de %d pregões no COTAHIST; há %d. Rode 'scanner.py baixar --dias %d'." % (
            dias, len(datas), dias))
    janela = set(datas)
    por, ultimo = {}, {}
    for r in regs:
        if r["tpmerc"] != "010" or r["data"] not in janela:
            continue
        por.setdefault(r["ticker"], []).append(r)
        if r["ticker"] not in ultimo or r["data"] > ultimo[r["ticker"]]["data"]:
            ultimo[r["ticker"]] = r
    preco_max = float(cfg["capital"]) * float(cfg["posicao_max_pct"]) / 100.0
    itens = []
    cont = {"tickers": len(por), "fora_do_perfil": 0, "iliquidos": 0, "preco": 0, "presenca": 0}
    for t, rs in por.items():
        u = ultimo[t]
        cl = c.classe_cotahist(u)
        if not cl:
            cont["fora_do_perfil"] += 1
            continue
        if len(rs) < presenca * dias:
            cont["presenca"] += 1
            continue
        vol = sum(x["volume"] for x in rs) / float(dias)
        if vol < minimos[cl]:
            cont["iliquidos"] += 1
            continue
        if not 1.0 <= u["c"] <= preco_max:
            cont["preco"] += 1
            continue
        itens.append({"ticker": t, "classe": cl, "nome": u["nome"], "espec": u["espec"], "isin": u["isin"],
                      "preco": u["c"], "data_preco": u["data"], "vol_fin_medio_20d": round(vol, 2),
                      "lote": 100 if cl == "acao" else 1, "fracionario": cl == "acao",
                      "cnpj": (fca or {}).get(t)})
    itens.sort(key=lambda x: (-x["vol_fin_medio_20d"], x["ticker"]))
    cont["no_universo"] = len(itens)
    return itens, cont, datas[-1]


def mapa_fca(caminho):
    """ticker -> CNPJ a partir do fca_cia_aberta_valor_mobiliario (CVM)."""
    if not caminho or not os.path.exists(caminho):
        return {}
    if caminho.lower().endswith(".zip"):
        with zipfile.ZipFile(caminho) as z:
            nome = [n for n in z.namelist() if "valor_mobiliario" in n][0]
            texto = z.read(nome).decode("latin-1")
    else:
        texto = c.ler_texto(caminho)
    out = {}
    for r in csv.DictReader(io.StringIO(texto), delimiter=";"):
        if r.get("Codigo_Negociacao"):
            out[r["Codigo_Negociacao"].strip().upper()] = r["CNPJ_Companhia"]
    return out


def cmd_universo(a):
    c.carregar_referencia(a.ref)
    cfg = c.carregar_config(a.config)
    regs = c.registros_cotahist(a.fontes)
    mins = dict(MINIMOS)
    for cl in mins:
        v = getattr(a, "min_vol_" + cl)
        if v is not None:
            mins[cl] = v
    itens, cont, ultima = montar_universo(regs, cfg, minimos=mins, fca=mapa_fca(a.fca))
    antigos = (c.ler_json(a.out, "universo", obrigatorio=False) or {}).get("ativos") or []
    manuais = [x for x in antigos if x.get("manual") and x["ticker"] not in {i["ticker"] for i in itens}]
    preco_max = float(cfg["capital"]) * float(cfg["posicao_max_pct"]) / 100.0
    doc = {"criado_por": "b3-scanner", "data_ref": ultima, "fonte": "COTAHIST (B3)",
           "criterios": {"vol_fin_medio_20d_min": mins, "preco_max": preco_max, "presenca_min": 0.9},
           "contagem": cont, "ativos": itens + manuais}
    c.gravar_json(a.out, doc)
    por = {k: sum(1 for i in itens if i["classe"] == k) for k in ("acao", "fii", "bdr")}
    print("Universo em %s (COTAHIST, 20 pregões até %s): %d ações, %d FIIs, %d BDRs; %d manuais mantidos." % (
        a.out, ultima, por["acao"], por["fii"], por["bdr"], len(manuais)))
    print("Fora: %d fora do perfil (ETF, BDR de ETF, direitos...), %d ilíquidos, %d acima de %s ou abaixo de "
          "R$ 1, %d com pregões faltando." % (cont["fora_do_perfil"], cont["iliquidos"], cont["preco"],
                                               c.rs(preco_max), cont["presenca"]))
    print(c.AVISO)
    return 0 if itens else 1


# ---------------------------------------------------------------- diário

def triagem_diaria(regs, ativos, data_ref=None, janela_eventos=25):
    """(hits, contagem, data, suspeitos). Usa só barras até data_ref."""
    hits, cont = [], {"ativos": len(ativos), "sem_historico": 0, "evento_suspeito": 0, "analisados": 0}
    suspeitos, ultima = [], None
    amplos = c.dias_de_movimento_amplo(regs)
    cont["dias_de_movimento_amplo"] = sorted(d for d in amplos if not data_ref or d <= data_ref)
    for a in ativos:
        serie = c.serie_diaria(regs, a["ticker"])
        if data_ref:
            serie = [b for b in serie if b["data"] <= data_ref]
        if len(serie) < c.MIN_BARRAS_SETUP:
            cont["sem_historico"] += 1
            continue
        ev = c.eventos_suspeitos(serie[-janela_eventos:], excluir=amplos)
        if ev:
            cont["evento_suspeito"] += 1
            suspeitos.append({"ticker": a["ticker"], "datas": ev})
            continue
        cont["analisados"] += 1
        ultima = max(ultima or serie[-1]["data"], serie[-1]["data"])
        tags, nums, nivel = c.setups_diarios([b["c"] for b in serie])
        if tags:
            u = serie[-1]
            hits.append({"ticker": a["ticker"], "classe": a["classe"], "setups": tags, "data": u["data"],
                         "preco": u["c"], "maxima": u["h"], "minima": u["l"],
                         "nivel": {k: round(v, 2) for k, v in nivel.items()}, "rsi": round(nums["rsi"], 1),
                         "vol_fin_medio_20d": a.get("vol_fin_medio_20d")})
    hits.sort(key=lambda h: (-(h["vol_fin_medio_20d"] or 0), h["ticker"]))
    cont["hits"] = len(hits)
    return hits, cont, ultima, suspeitos


def cmd_diario(a):
    c.carregar_referencia(a.ref)
    if a.tickers:
        alvo = [t.strip().upper() for t in a.tickers.split(",") if t.strip()]
        uni = c.ler_json(a.universo, "universo", obrigatorio=False) or {}
        conhecidos = {x["ticker"]: x for x in uni.get("ativos") or []}
        ativos = [conhecidos.get(t) or {"ticker": t, "classe": "acao"} for t in alvo]
    else:
        uni = c.ler_json(a.universo, "universo (rode 'scanner.py universo')")
        ativos = uni.get("ativos") or []
    regs = c.registros_cotahist(a.fontes, [x["ticker"] for x in ativos])
    hits, cont, ultima, susp = triagem_diaria(regs, ativos, a.data)
    doc = {"criado_por": "b3-scanner", "modo": "diario", "data_ref": ultima, "fonte": "COTAHIST (B3)",
           "nota": NOTA, "aviso_dados": AVISO_DADOS, "contagem": cont, "eventos_suspeitos": susp, "hits": hits}
    if not a.no_write:
        c.gravar_json(a.out, doc)
    print("Triagem diária, fechamentos oficiais até %s: %d ativos, %d analisados, %d com setup." % (
        ultima or "nada", cont["ativos"], cont["analisados"], cont["hits"]))
    nomes = dict(c.SETUPS_DIARIOS)
    for h in hits[:a.mostrar]:
        print("  %-7s %-4s %10s  RSI %5s  %s" % (h["ticker"], h["classe"], c.rs(h["preco"]), c.num(h["rsi"], 1),
                                                  ", ".join(nomes[t] for t in h["setups"])))
    if len(hits) > a.mostrar:
        print("  ... e mais %d em %s." % (len(hits) - a.mostrar, a.out))
    if cont["dias_de_movimento_amplo"]:
        print("Dias de movimento amplo de mercado (mais da metade dos ativos com salto acima de 10%%): %s. "
              "Os setups desses dias refletem o mercado inteiro, não um ativo." % ", ".join(
                  cont["dias_de_movimento_amplo"][-5:]))
    if susp:
        print("Fora por provável evento corporativo (salto acima de 35%%): %s. Confira no b3-noticias." % ", ".join(
            "%s (%s)" % (s["ticker"], s["datas"][-1]) for s in susp[:8]))
    if cont["sem_historico"]:
        print("%d ativos sem 30 pregões no cache: rode 'scanner.py baixar --dias 60'." % cont["sem_historico"])
    if not a.no_write:
        print("Gravei %s." % a.out)
    for x in c.rodape([NOTA, AVISO_DADOS, "Próximo passo: b3-noticias para o ativo escolhido, depois b3-plano."]):
        print(x)
    return 0 if hits else 1


# ---------------------------------------------------------------- ORB

def orb(barras, ref, dia, corte, minutos=15):
    """Resultado do ORB de um ativo em `dia` até `corte` (datetime local). Barras de 5 min."""
    dias = c.sessoes_intradiarias(barras, ref)
    s = dias.get(dia.isoformat())
    if not s:
        return {"status": "sem-dados", "motivo": "nenhuma barra do pregão de %s" % dia.isoformat()}
    n = minutos * 60 // c.CINCO_MIN
    faltam = [k for k in range(n) if k not in s]
    if faltam:
        prim = min(s)
        return {"status": "dados-incompletos",
                "motivo": "faltam barras da faixa de abertura (primeira barra às %s)" % c.hm(s[prim]["local"].time())}
    faixa = [s[k] for k in range(n)]
    maxima, minima = max(b["h"] for b in faixa), min(b["l"] for b in faixa)
    for k in sorted(s):
        if k < n:
            continue
        b = s[k]
        fecha = b["local"] + dt.timedelta(seconds=c.CINCO_MIN)
        if fecha > corte:
            break
        if b["c"] > maxima:
            return {"status": "disparou", "hora": c.hm(fecha.time()), "barra": k, "preco": round(b["c"], 2),
                    "faixa": {"maxima": round(maxima, 2), "minima": round(minima, 2), "minutos": minutos},
                    "acima_pct": round((b["c"] / maxima - 1) * 100, 2)}
    return {"status": "aguardando", "faixa": {"maxima": round(maxima, 2), "minima": round(minima, 2),
                                              "minutos": minutos},
            "motivo": "nenhuma barra fechou acima de %s até %s" % (c.num(maxima), c.hm(corte.time()))}


def cmd_orb(a):
    ref = c.carregar_referencia(a.ref)
    dia = c.data(a.data) if a.data else c.agora_local(ref, a.agora).date()
    ses, mot = c.sessao(ref, dia)
    if not ses:
        raise c.B3Erro("sem pregão em %s: %s" % (dia.isoformat(), mot))
    corte = dt.datetime.combine(dia, c.hora(a.at, "--at")) if a.at else c.agora_local(ref, a.agora)
    if a.tickers:
        tickers = [t.strip().upper() for t in a.tickers.split(",") if t.strip()]
    else:
        uni = c.ler_json(a.universo, "universo (rode 'scanner.py universo')")
        tickers = [x["ticker"] for x in uni["ativos"] if x["classe"] == "acao"][:a.limite]
    res = []
    for t in tickers:
        try:
            if a.offline:
                cam = a.offline
                if os.path.isdir(cam):
                    cands = [os.path.join(cam, n) for n in sorted(os.listdir(cam)) if n.upper().startswith(t)]
                    if not cands:
                        res.append((t, {"status": "sem-dados", "motivo": "sem arquivo em %s" % cam}))
                        continue
                    cam = cands[0]
                barras = c.carregar_barras(cam, ref, a.fuso_csv)
            else:
                url = ref["fontes_de_dados"]["yahoo_chart"]["url_modelo"].replace("{TICKER}", t).replace(
                    "range=60d", "range=5d")
                barras = c.parse_yahoo(c.http_get(url).decode("utf-8", "replace"))
            res.append((t, orb(barras, ref, dia, corte, a.minutos)))
        except (c.B3Erro, ValueError) as e:
            res.append((t, {"status": "erro", "motivo": str(e)}))
    hits = [dict(ticker=t, classe="acao", setups=["orb"], **r) for t, r in res if r["status"] == "disparou"]
    doc = {"criado_por": "b3-scanner", "modo": "orb", "data_ref": "%s %s" % (dia.isoformat(), c.hm(corte.time())),
           "fonte": "arquivo" if a.offline else "yahoo", "nota": NOTA, "aviso_dados": AVISO_DADOS,
           "resultados": {t: r for t, r in res}, "hits": hits}
    if not a.no_write:
        c.gravar_json(a.out, doc)
    print("ORB de %d min em %s até %s: %d ativos." % (a.minutos, dia.isoformat(), c.hm(corte.time()), len(res)))
    for t, r in res:
        if r["status"] == "disparou":
            print("  %-7s DISPAROU %s a %s, faixa %s a %s (%+.2f%%)" % (
                t, r["hora"], c.num(r["preco"]), c.num(r["faixa"]["minima"]), c.num(r["faixa"]["maxima"]),
                r["acima_pct"]))
        else:
            print("  %-7s %s: %s" % (t, r["status"].upper(), r.get("motivo", "")))
    inc = sum(1 for _, r in res if r["status"] == "dados-incompletos")
    if inc:
        print("%d de %d sem a faixa de abertura completa. Com dado gratuito isso é o normal; para estudar ORB, "
              "exporte barras de 5 min do MetaTrader 5 e use --offline." % (inc, len(res)))
    for x in c.rodape([NOTA, AVISO_DADOS]):
        print(x)
    return 0 if hits else 1


def main(argv=None):
    ap = argparse.ArgumentParser(description="b3-scanner: triagem de setups na B3.")
    sub = ap.add_subparsers(dest="cmd")

    def comum(p):
        p.add_argument("--ref", default=c.REF_PADRAO)
        p.add_argument("--config", default=c.CONFIG_PADRAO)
        p.add_argument("--agora")

    p = sub.add_parser("baixar")
    comum(p)
    p.add_argument("--dias", type=int, default=60)
    p.add_argument("--ate", help="último pregão (AAAA-MM-DD)")
    p.add_argument("--anual", type=int, help="baixa o arquivo anual do ano")
    p.add_argument("--pasta")
    p = sub.add_parser("universo")
    comum(p)
    p.add_argument("--fontes", nargs="*", default=[c.pasta_cotahist()])
    p.add_argument("--fca", help="fca_cia_aberta_AAAA.zip ou o CSV de valor mobiliário (CNPJ por ticker)")
    p.add_argument("--min-vol-acao", type=float)
    p.add_argument("--min-vol-fii", type=float)
    p.add_argument("--min-vol-bdr", type=float)
    p.add_argument("--out", default="trader/universo.json")
    p = sub.add_parser("diario")
    comum(p)
    p.add_argument("--fontes", nargs="*", default=[c.pasta_cotahist()])
    p.add_argument("--universo", default="trader/universo.json")
    p.add_argument("--tickers", help="lista separada por vírgula em vez do universo")
    p.add_argument("--data", help="usa só fechamentos até esta data")
    p.add_argument("--mostrar", type=int, default=30)
    p.add_argument("--out", default="trader/watchlist.json")
    p.add_argument("--no-write", action="store_true")
    p = sub.add_parser("orb")
    comum(p)
    p.add_argument("--data")
    p.add_argument("--at", help="corta o relógio neste horário (HH:MM)")
    p.add_argument("--minutos", type=int, default=15)
    p.add_argument("--tickers")
    p.add_argument("--universo", default="trader/universo.json")
    p.add_argument("--limite", type=int, default=40)
    p.add_argument("--offline", help="arquivo ou pasta de barras (Yahoo, brapi, CSV do MT5)")
    p.add_argument("--fuso-csv", type=float, help="offset em horas do CSV do MT5, se não for Brasília")
    p.add_argument("--out", default="trader/watchlist.json")
    p.add_argument("--no-write", action="store_true")
    a = ap.parse_args(argv)
    if not a.cmd:
        ap.print_help()
        return 1
    try:
        return {"baixar": cmd_baixar, "universo": cmd_universo, "diario": cmd_diario, "orb": cmd_orb}[a.cmd](a)
    except c.B3Erro as e:
        print("scanner.py: %s" % e, file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
