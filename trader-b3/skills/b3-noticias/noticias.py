#!/usr/bin/env python3
"""b3-noticias: fatos relevantes, comunicados e eventos para o pacote trader-b3. Só biblioteca padrão.

    python noticias.py atualizar                      # baixa IPE e FCA da CVM (cache)
    python noticias.py listar                         # watchlist + plano + carteira, só o que é novo
    python noticias.py listar --tickers BBAS3,ITSA4 --dias 14 --todos
    python noticias.py listar --tickers AAPL34        # BDR: 8-K da empresa-mãe na SEC (pede sec_user_agent)

Fontes:
  CVM, dados abertos, "Cias Abertas: Documentos: Periódicos e Eventuais (IPE)": fato relevante,
  comunicado ao mercado, aviso aos acionistas, calendário de eventos. Arquivo do ano, D+1
  (entregas até o dia anterior). Ticker para CNPJ pelo FCA (valor mobiliário) da CVM.
  FIIs: link do Fundos.NET pelo CNPJ (consulta pública; o Claude lê a página).
  BDRs: 8-K da empresa-mãe na SEC, com User-Agent obrigatório (nome e e-mail do usuário).
  Vencimento de opções: da referência.
Manchete de portal é pista; documento na CVM é fato. Nada aqui é tempo real.
Material educacional; não é recomendação de investimento.
"""

import argparse
import csv
import datetime as dt
import io
import json
import os
import re
import sys
import xml.etree.ElementTree as ET
import zipfile

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)
import b3comum as c  # noqa: E402

PASTA_CVM = os.path.join(c.PASTA, "cache", "cvm")
CATEGORIAS = ("Fato Relevante", "Comunicado ao Mercado", "Aviso aos Acionistas", "Calendário de Eventos Corporativos",
              "Assembleia", "Dados Econômico-Financeiros", "Reunião da Administração")
ETIQUETAS = [
    ("proventos", r"\bjcp\b|juros sobre (o )?capital|dividend|provento|rendimento"),
    ("resultado", r"\bitr\b|\bdfp\b|resultado|release|demonstra[cç][oõ]es financeiras|trimestr|"
                  r"per[ií]odo de sil[eê]ncio|\b[1-4]t\d{2}\b"),
    ("evento corporativo", r"desdobramento|grupamento|bonifica|incorpora|fus[aã]o|cis[aã]o|\bopa\b|"
                           r"aumento de capital|recompra|oferta p[uú]blica"),
    ("gestão", r"diretor|conselh|renúncia|renuncia|eleição|elei[cç][aã]o"),
    ("crédito", r"debênture|debenture|rating|emiss[aã]o|recupera[cç][aã]o judicial"),
]
RISCO_GAP = {"proventos", "resultado", "evento corporativo"}
ITENS_8K = {"1.01": "contrato relevante", "1.03": "falência", "1.05": "incidente de cibersegurança",
            "2.01": "aquisição ou venda de ativos", "2.02": "resultado", "2.03": "nova dívida",
            "2.05": "reestruturação", "2.06": "impairment", "3.01": "aviso de deslistagem",
            "4.02": "demonstrações passadas não confiáveis", "5.01": "mudança de controle",
            "5.02": "troca de diretor ou conselheiro", "5.07": "resultado de votação", "7.01": "Regulation FD",
            "8.01": "outros eventos"}


# ---------------------------------------------------------------- dados

def url_cvm(ref, chave, ano):
    return ref["fontes_de_dados"][chave]["url_modelo"].replace("{ANO}", str(ano))


def cmd_atualizar(a):
    ref = c.carregar_referencia(a.ref)
    ano = a.ano or c.agora_local(ref, a.agora).year
    os.makedirs(PASTA_CVM, exist_ok=True)
    for chave, idade in (("cvm_ipe", 12), ("cvm_fca_valor_mobiliario", 24 * 7)):
        url = url_cvm(ref, chave, ano)
        destino = os.path.join(PASTA_CVM, os.path.basename(url))
        c.com_cache(url, destino, max_idade_h=idade, timeout=120)
        print("CVM: %s em cache (renova a cada %d h)." % (os.path.basename(url), idade))
    print("O IPE tem entregas até o dia anterior (D+1); não é tempo real.")
    print(c.AVISO)
    return 0


def _csv_de(caminho, prefixo):
    if not caminho or not os.path.exists(caminho):
        return []
    if caminho.lower().endswith(".zip"):
        with zipfile.ZipFile(caminho) as z:
            nomes = [n for n in z.namelist() if n.startswith(prefixo)]
            if not nomes:
                return []
            texto = z.read(nomes[0]).decode("latin-1")
    else:
        texto = c.ler_texto(caminho)
    return list(csv.DictReader(io.StringIO(texto), delimiter=";"))


def achar(pasta, padrao):
    if not os.path.isdir(pasta):
        return None
    nomes = sorted(n for n in os.listdir(pasta) if re.match(padrao, n))
    return os.path.join(pasta, nomes[-1]) if nomes else None


def carregar_ipe(pasta):
    arq = achar(pasta, r"ipe_cia_aberta_\d{4}\.zip$")
    return _csv_de(arq, "ipe_cia_aberta") if arq else []


def carregar_fca(pasta):
    arq = achar(pasta, r"fca_cia_aberta_(valor_mobiliario_)?\d{4}\.(zip|csv)$")
    out = {}
    for r in _csv_de(arq, "fca_cia_aberta_valor_mobiliario") if arq else []:
        if r.get("Codigo_Negociacao"):
            out[r["Codigo_Negociacao"].strip().upper()] = r["CNPJ_Companhia"]
    return out


def etiquetas(texto):
    t = (texto or "").lower()
    return [nome for nome, rx in ETIQUETAS if re.search(rx, t)]


def documentos(ipe, cnpj, desde, ate):
    out = []
    for r in ipe:
        if r.get("CNPJ_Companhia") != cnpj:
            continue
        d = r.get("Data_Entrega") or ""
        if not desde <= d <= ate:
            continue
        cat = r.get("Categoria") or ""
        if not any(cat.startswith(k) for k in CATEGORIAS):
            continue
        tags = etiquetas("%s %s %s" % (cat, r.get("Tipo") or "", r.get("Assunto") or ""))
        out.append({"id": "ipe:%s:%s" % (r.get("Protocolo_Entrega"), r.get("Versao")), "data": d,
                    "categoria": cat, "assunto": (r.get("Assunto") or r.get("Tipo") or "").strip(),
                    "etiquetas": tags, "risco_gap": bool(set(tags) & RISCO_GAP) or cat == "Fato Relevante",
                    "link": r.get("Link_Download")})
    out.sort(key=lambda x: (x["data"], x["id"]), reverse=True)
    return out


# ---------------------------------------------------------------- SEC (só BDR)

def _local(tag):
    return tag.rsplit("}", 1)[-1]


def _texto(el, nome):
    for x in el.iter():
        if _local(x.tag) == nome:
            return (x.text or "").strip()
    return ""


def parse_sec_atom(raw, ticker):
    """Feed Atom de filings da SEC -> itens (mesma leitura do original)."""
    root = ET.fromstring(raw)
    empresa = ""
    for el in root.iter():
        if _local(el.tag) == "conformed-name":
            empresa = (el.text or "").strip()
            break
    out = []
    for e in root.iter():
        if _local(e.tag) != "entry":
            continue
        itens = re.findall(r"\d+\.\d+", _texto(e, "items-desc"))
        rotulos = [ITENS_8K.get(i, "item " + i) for i in itens if i != "9.01"]
        link = ""
        for x in e.iter():
            if _local(x.tag) == "link":
                link = x.get("href", "")
        out.append({"id": "sec:" + _texto(e, "accession-number"), "data": _texto(e, "updated")[:10],
                    "categoria": "SEC " + _texto(e, "filing-type"), "empresa": empresa or ticker,
                    "assunto": ", ".join(rotulos) or _texto(e, "form-name"), "etiquetas": [],
                    "risco_gap": bool({"2.02", "5.01", "1.03", "4.02"} & set(itens)), "link": link})
    return out


def sec_user_agent(cfg):
    ua = (os.environ.get("SEC_USER_AGENT") or cfg.get("sec_user_agent") or "").strip()
    return ua if "@" in ua and "example.com" not in ua else None


def sec_8k(ref, cfg, ticker_eua, offline=None, desde="0000"):
    """(itens, aviso)."""
    fonte = (ref.get("fontes_de_dados") or {}).get("sec_edgar") or {}
    if offline:
        mapa = json.loads(c.ler_texto(os.path.join(offline, "company_tickers.json")))
    else:
        ua = sec_user_agent(cfg)
        if not ua:
            return [], ("SEC pulada: a SEC exige User-Agent com seu nome e e-mail. Preencha sec_user_agent em "
                        "trader/config.json ou SEC_USER_AGENT; o pacote não preenche isso por você.")
        mapa = json.loads(c.com_cache(fonte["tickers"], os.path.join(c.PASTA, "cache", "sec", "company_tickers.json"),
                                      max_idade_h=24 * 7, cabecalhos={"User-Agent": ua}).decode("utf-8"))
    ciks = {v["ticker"].upper(): str(v["cik_str"]).zfill(10) for v in mapa.values()}
    cik = ciks.get(ticker_eua.upper())
    if not cik:
        return [], "SEC: %s não está na lista de tickers da SEC; confira ticker_eua no universo" % ticker_eua
    if offline:
        raw = c.ler_texto(os.path.join(offline, "sec-8-K-%s.xml" % cik)).encode("utf-8")
    else:
        url = fonte["feed_modelo"].replace("{CIK}", cik)
        raw = c.http_get(url, cabecalhos={"User-Agent": sec_user_agent(cfg)})
    itens = [x for x in parse_sec_atom(raw, ticker_eua) if x["data"] >= desde]
    return itens, None


# ---------------------------------------------------------------- listar

def tickers_do_trabalho():
    out = []
    w = c.ler_json(os.path.join(c.PASTA, "watchlist.json"), obrigatorio=False) or {}
    out += [h["ticker"] for h in w.get("hits") or []]
    p = c.ler_json(os.path.join(c.PASTA, "plan.json"), obrigatorio=False) or {}
    if p.get("ticker"):
        out.append(p["ticker"])
    pf = c.ler_json(os.path.join(c.PASTA, "portfolio.json"), obrigatorio=False) or {}
    out += [x["ticker"] for x in pf.get("posicoes") or []]
    vistos = []
    for t in out:
        t = c.ticker_base(t)
        if t not in vistos:
            vistos.append(t)
    return vistos


def vencimentos(ref, hoje, ate):
    v = ref.get("vencimentos_opcoes_acoes") or {}
    datas = []
    for k, lista in v.items():
        if k.startswith("mensais") and isinstance(lista, list):
            datas += [d for d in lista if hoje.isoformat() <= d <= ate.isoformat()]
    return sorted(set(datas))


def classe_de(t, info):
    if info.get("classe"):
        return info["classe"]
    if re.match(r"^[A-Z0-9]{4}3[1-9]$", t):
        return "bdr"
    return "acao"


def cmd_listar(a):
    ref = c.carregar_referencia(a.ref)
    cfg = c.carregar_config(a.config, exigir=False)
    hoje = c.agora_local(ref, a.agora).date()
    tickers = [c.ticker_base(t) for t in a.tickers.split(",") if t.strip()] if a.tickers else tickers_do_trabalho()
    if not tickers:
        raise c.B3Erro("nenhum ticker: passe --tickers ou rode o b3-scanner antes")
    pasta = a.offline or PASTA_CVM
    ipe = carregar_ipe(pasta)
    fca = carregar_fca(pasta)
    uni = {x["ticker"]: x for x in (c.ler_json(a.universo, obrigatorio=False) or {}).get("ativos") or []}
    desde = (hoje - dt.timedelta(days=a.dias)).isoformat()
    estado = c.ler_json(a.estado, obrigatorio=False) or {"vistos": {}}
    blocos, novos_ids, avisos = [], [], []
    if not ipe:
        avisos.append("sem arquivo IPE em %s: rode 'noticias.py atualizar'" % pasta)
    for t in tickers:
        info = uni.get(t) or {}
        classe = classe_de(t, info)
        itens, nota = [], None
        if classe == "bdr":
            eua = info.get("ticker_eua") or re.sub(r"\d+$", "", t)
            try:
                itens, nota = sec_8k(ref, cfg, eua, a.offline, "0000" if a.offline else desde)
            except (c.B3Erro, ET.ParseError, ValueError, OSError) as e:
                nota = "SEC: %s" % e
        elif classe == "fii":
            cnpj = info.get("cnpj")
            modelo = ref["fontes_de_dados"]["fundos_net"]["url_modelo"]
            nota = ("FII: consulte o Fundos.NET em %s" % modelo.replace("{CNPJ}", re.sub(r"\D", "", cnpj))
                    if cnpj else "FII sem CNPJ no universo: adicione 'cnpj' para gerar o link do Fundos.NET")
        else:
            cnpj = info.get("cnpj") or fca.get(t)
            if not cnpj:
                nota = "sem CNPJ para %s: rode 'noticias.py atualizar' (FCA da CVM)" % t
            else:
                itens = documentos(ipe, cnpj, desde, hoje.isoformat())
        if not a.todos:
            itens = [x for x in itens if x["id"] not in estado["vistos"]]
        novos_ids += [x["id"] for x in itens]
        blocos.append({"ticker": t, "classe": classe, "itens": itens, "nota": nota})
    venc = vencimentos(ref, hoje, hoje + dt.timedelta(days=max(a.dias, 21)))
    if not a.no_state:
        for i in novos_ids:
            estado["vistos"][i] = hoje.isoformat()
        corte = (hoje - dt.timedelta(days=60)).isoformat()
        estado["vistos"] = {k: v for k, v in estado["vistos"].items() if v >= corte}
        c.gravar_json(a.estado, estado)
    if a.json:
        print(json.dumps({"hoje": hoje.isoformat(), "blocos": blocos, "vencimentos_opcoes": venc, "avisos": avisos},
                         indent=2, ensure_ascii=False))
        return 0
    print("Notícias oficiais de %s a %s (CVM, D+1)%s:" % (desde, hoje.isoformat(), "" if a.todos else ", só o novo"))
    for b in blocos:
        print("%s (%s)" % (b["ticker"], b["classe"]))
        for x in b["itens"][:a.max]:
            alerta = "  RISCO DE GAP" if x["risco_gap"] else ""
            tags = (" [%s]" % ", ".join(x["etiquetas"])) if x["etiquetas"] else ""
            print("  %s  %s: %s%s%s" % (x["data"], x["categoria"], x["assunto"] or "(sem assunto)", tags, alerta))
            if x.get("link"):
                print("            %s" % x["link"])
        if len(b["itens"]) > a.max:
            print("  ... e mais %d (use --max)." % (len(b["itens"]) - a.max))
        if not b["itens"] and not b["nota"]:
            print("  nada novo no período.")
        if b["nota"]:
            print("  %s" % b["nota"])
    if venc:
        print("Vencimento mensal de opções sobre ações: %s (volatilidade costuma subir; risco de gap)." %
              ", ".join(venc))
    for x in avisos:
        print("Aviso: %s." % x)
    for x in c.rodape(["Manchete de portal é pista; documento na CVM é fato. Antes de agir, abra o documento.",
                       "Para o mesmo dia, peça ao Claude uma busca em InfoMoney, Valor, Money Times ou Brazil "
                       "Journal e trate o que vier como pista."]):
        print(x)
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description="b3-noticias: CVM, Fundos.NET, SEC (BDR) e calendário.")
    sub = ap.add_subparsers(dest="cmd")

    def comum(p):
        p.add_argument("--ref", default=c.REF_PADRAO)
        p.add_argument("--config", default=c.CONFIG_PADRAO)
        p.add_argument("--agora")

    p = sub.add_parser("atualizar")
    comum(p)
    p.add_argument("--ano", type=int)
    p = sub.add_parser("listar")
    comum(p)
    p.add_argument("--tickers")
    p.add_argument("--dias", type=int, default=7)
    p.add_argument("--todos", action="store_true", help="mostra também o que já foi visto")
    p.add_argument("--max", type=int, default=8)
    p.add_argument("--universo", default="trader/universo.json")
    p.add_argument("--estado", default="trader/state/noticias.json")
    p.add_argument("--offline", help="pasta com ipe_cia_aberta_AAAA.zip, fca..., company_tickers.json, sec-8-K-*.xml")
    p.add_argument("--no-state", action="store_true")
    p.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)
    if not a.cmd:
        ap.print_help()
        return 1
    try:
        return {"atualizar": cmd_atualizar, "listar": cmd_listar}[a.cmd](a)
    except c.B3Erro as e:
        print("noticias.py: %s" % e, file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
