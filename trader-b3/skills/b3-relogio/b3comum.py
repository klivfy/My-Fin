"""b3comum: código compartilhado do pacote trader-b3. Só biblioteca padrão.

Fonte única em comum/b3comum.py. Cada skill leva uma cópia idêntica
(tools/sync_comum.py copia; tests/test_repo.py garante que não divergem),
porque cada pasta instalada em ~/.claude/skills/ precisa rodar sozinha.

Nada volátil fica aqui. Horários, feriados, grade, custos, regras de IR e
endpoints vêm de trader/referencia_b3.json. Limites do perfil vêm de
trader/config.json. Este módulo só sabe fazer contas e ler formatos.

Horários são de Brasília, ingênuos (sem tzinfo), com o offset lido da
referência. Não usa zoneinfo: no Windows ele depende do pacote tzdata.
"""

import csv
import datetime as dt
import gzip
import hashlib
import json
import os
import re
import time
import urllib.error
import urllib.request
import zipfile
from decimal import Decimal, InvalidOperation, ROUND_FLOOR, ROUND_HALF_UP

AVISO = "Material educacional; não é recomendação de investimento."
UA = "trader-b3/0.1 (estudo pessoal; leitura de dados publicos; nenhum envio de ordens)"
PASTA = "trader"
REF_PADRAO = os.path.join(PASTA, "referencia_b3.json")
CONFIG_PADRAO = os.path.join(PASTA, "config.json")
EPOCH = dt.datetime(1970, 1, 1)
CINCO_MIN = 300
CENT = Decimal("0.01")

# Chaves que o config precisa ter. Sem elas o pacote recusa em vez de inventar um valor.
CONFIG_OBRIGATORIO = ("capital", "risco_por_operacao", "perda_max_dia", "perda_max_mes", "max_operacoes_dia",
                      "posicao_max_pct", "caixa_min_pct", "rr_min", "fase", "modo", "corretagem")
# Padrões estruturais (não são limites do perfil): podem faltar no config.
CONFIG_ESTRUTURAL = {
    "deslizamento_ticks": 1,
    "janela": {"minutos_apos_abertura": 15, "minutos_antes_do_fim": 40},
    "zerar_minutos_antes_do_fim": 15,
    "zerar_ate": None,
    "prazo_swing_pregoes": 10,
    "risco_min_pct_preco": 0.3,
    "pausa_dias_apos_mes": 7,
    "custo_alto_no_simulado": "avisar",
    "plataformas": ["app", "home_broker"],
    "proibidos": ["alavancagem", "minicontratos", "venda_descoberta", "aluguel", "termo", "opcao_vendida"],
    "opcoes": {"so_compra": True, "premio_max": 50, "fase_min": 3},
    "fases": {},
    "sec_user_agent": "",
}


class B3Erro(Exception):
    """Erro com mensagem para pessoas."""


class CustoDesconhecido(B3Erro):
    pass


# ---------------------------------------------------------------- arquivos

def ler_json(caminho, oque="arquivo", obrigatorio=True):
    if not caminho or not os.path.exists(caminho):
        if obrigatorio:
            raise B3Erro("sem %s em %s" % (oque, caminho))
        return None
    try:
        with open(caminho, encoding="utf-8") as fh:
            return json.load(fh)
    except ValueError as e:
        raise B3Erro("%s não é JSON válido: %s" % (caminho, e))


def gravar_json(caminho, doc):
    d = os.path.dirname(caminho)
    if d:
        os.makedirs(d, exist_ok=True)
    tmp = caminho + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, indent=2, ensure_ascii=False, default=str)
        fh.write("\n")
    os.replace(tmp, caminho)


def ler_texto(caminho):
    """Lê .txt, .json, .csv, .gz ou o primeiro arquivo de um .zip."""
    low = caminho.lower()
    if low.endswith(".zip"):
        with zipfile.ZipFile(caminho) as z:
            return z.read(z.namelist()[0]).decode("latin-1")
    if low.endswith(".gz"):
        with gzip.open(caminho, "rb") as fh:
            raw = fh.read()
    else:
        with open(caminho, "rb") as fh:
            raw = fh.read()
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        return raw.decode("latin-1")


# ---------------------------------------------------------------- referência e config

def carregar_referencia(caminho=None):
    path = caminho or REF_PADRAO
    if not os.path.exists(path):
        raise B3Erro("sem referência em %s: rode 'python relogio.py init' para copiar referencia_b3.json" % path)
    doc = ler_json(path, "referência")
    for k in ("fuso", "grades", "feriados", "custos", "microestrutura", "ir"):
        if k not in doc:
            raise B3Erro("%s não tem a seção '%s'" % (path, k))
    return doc


def carregar_config(caminho=None, exigir=True):
    path = caminho or CONFIG_PADRAO
    doc = ler_json(path, "config (copie config.example.json para trader/config.json)", obrigatorio=exigir) or {}
    if exigir:
        faltam = [k for k in CONFIG_OBRIGATORIO if k not in doc]
        if faltam:
            raise B3Erro("config sem %s: o pacote não inventa limite. Copie de config.example.json." % ", ".join(faltam))
    cfg = json.loads(json.dumps(CONFIG_ESTRUTURAL))
    cfg.update(doc)
    if cfg.get("modo") not in ("simulado", "real", None):
        raise B3Erro("modo deve ser 'simulado' ou 'real', não %r" % cfg.get("modo"))
    return cfg


# ---------------------------------------------------------------- tempo

def offset(ref):
    return dt.timedelta(hours=float(ref["fuso"]["utc_offset_horas"]))


# --agora fixa o relógio. Só vale com esta variável de ambiente igual a "1" (testes e estudo
# deliberado), para nenhum agente forjar o horário e passar pelas regras de janela e mercado.
ENV_AGORA = "TRADER_B3_PERMITIR_AGORA"


def agora_local(ref, texto=None):
    """Agora em Brasília (ingênuo). texto: 'AAAA-MM-DD HH:MM' ou 'HH:MM' (hoje)."""
    real = dt.datetime.now(dt.timezone.utc).replace(tzinfo=None, microsecond=0) + offset(ref)
    if not texto:
        return real
    if os.environ.get(ENV_AGORA) != "1":
        raise B3Erro("--agora só vale com %s=1 no ambiente (testes e estudo); sem ela o relógio é o real"
                     % ENV_AGORA)
    t = texto.strip()
    if re.match(r"^\d{1,2}:\d{2}$", t):
        t = "%s %s" % (real.date().isoformat(), t.zfill(5))
    try:
        return dt.datetime.fromisoformat(t.replace("T", " "))
    except ValueError:
        raise B3Erro("--agora quer 'AAAA-MM-DD HH:MM' (Brasília), não %r" % texto)


def ts_local(ts, ref):
    return EPOCH + dt.timedelta(seconds=int(ts)) + offset(ref)


def hora(texto, oque="horário"):
    m = re.match(r"^\s*(\d{1,2}):(\d{2})\s*$", str(texto or ""))
    if not m or int(m.group(1)) > 23 or int(m.group(2)) > 59:
        raise B3Erro("%s quer HH:MM, não %r" % (oque, texto))
    return dt.time(int(m.group(1)), int(m.group(2)))


def hm(t):
    return "%02d:%02d" % (t.hour, t.minute)


def data(texto, oque="data"):
    try:
        return dt.date.fromisoformat(str(texto))
    except ValueError:
        raise B3Erro("%s quer AAAA-MM-DD, não %r" % (oque, texto))


def mais_min(t, minutos):
    base = dt.datetime.combine(dt.date(2000, 1, 3), t) + dt.timedelta(minutes=minutos)
    return base.time()


# ---------------------------------------------------------------- calendário e grade

def info_dia(ref, d):
    """('pregao' | 'fechado' | 'desconhecido', motivo)."""
    if d.weekday() >= 5:
        return "fechado", "fim de semana"
    ano = (ref.get("feriados") or {}).get(str(d.year))
    if not ano:
        return "desconhecido", ("calendário de %d desconhecido: a B3 publica o calendário em ofício circular; "
                                "atualize feriados.%d em referencia_b3.json" % (d.year, d.year))
    nome = (ano.get("datas") or {}).get(d.isoformat())
    if nome:
        return "fechado", "feriado: " + nome
    return "pregao", ""


def grade_do_dia(ref, d):
    """(grade, motivo). Grade None quando não há grade confirmada para o dia."""
    for g in ref.get("grades") or []:
        if d < data(g["valida_de"]):
            continue
        ate = g.get("valida_ate")
        if ate:
            if d <= data(ate):
                return g, ""
            continue
        lim = g.get("reverificar_ate")
        if lim and d > data(lim):
            return None, ("grade horária não confirmada depois de %s: confira o ofício circular da B3 e "
                          "atualize grades em referencia_b3.json" % lim)
        return g, ""
    return None, "nenhuma grade horária na referência cobre %s" % d.isoformat()


MERCADO_DA_CLASSE = {"acao": "acoes_a_vista_e_fracionario", "fii": "fiis_fundos", "bdr": "bdrs_patrocinados",
                     "opcao": "opcoes_acoes"}


def sessao(ref, d, classe="acao"):
    """(sessao, motivo). sessao: abertura, fim_negociacao, fim_call (time), grade (id)."""
    st, mot = info_dia(ref, d)
    if st != "pregao":
        return None, mot
    g, mot = grade_do_dia(ref, d)
    if not g:
        return None, mot
    base = g["acoes_a_vista_e_fracionario"]
    m = g.get(MERCADO_DA_CLASSE.get(classe, "")) or base
    ab, fim = m.get("negociacao") or base["negociacao"]
    call = m.get("call_fechamento") or base.get("call_fechamento") or [fim, fim]
    esp = (ref.get("sessoes_especiais") or {}).get(d.isoformat()) or {}
    if esp.get("negociacao_inicio"):
        ab = esp["negociacao_inicio"]
    pre = base.get("pre_abertura")
    return {"data": d, "abertura": hora(ab), "fim_negociacao": hora(fim), "fim_call": hora(call[1]),
            "pre_abertura": hora(pre[0]) if pre else None, "grade": g["id"],
            "especial": esp.get("descricao")}, ""


def proximo_pregao(ref, d, incluir=False):
    """(data, motivo). Para em calendário desconhecido."""
    x = d if incluir else d + dt.timedelta(days=1)
    for _ in range(20):
        st, mot = info_dia(ref, x)
        if st == "pregao":
            return x, ""
        if st == "desconhecido":
            return None, mot
        x += dt.timedelta(days=1)
    return None, "nenhum pregão em 20 dias"


def somar_pregoes(ref, d, n):
    """(data do n-ésimo pregão depois de d, motivo)."""
    x = d
    for _ in range(n):
        x, mot = proximo_pregao(ref, x)
        if x is None:
            return None, mot
    return x, ""


def pregoes_entre(ref, de, ate):
    """Pregões em (de, ate], parando em calendário desconhecido."""
    out, x = [], de
    while True:
        x, mot = proximo_pregao(ref, x)
        if x is None or x > ate:
            return out
        out.append(x)


def limites_do_dia(ref, cfg, ses):
    """Janela de entrada e horário de zerar para a sessão, relativos à grade do dia."""
    j = cfg.get("janela") or {}
    ab, fim = ses["abertura"], ses["fim_negociacao"]
    nao_antes = mais_min(ab, int(j.get("minutos_apos_abertura", 15)))
    nao_depois = mais_min(fim, -int(j.get("minutos_antes_do_fim", 40)))
    if cfg.get("zerar_ate"):
        zerar = hora(cfg["zerar_ate"], "zerar_ate")
        if zerar >= fim:
            raise B3Erro("zerar_ate %s não é antes do fim da negociação (%s): o call de fechamento começa às %s"
                         % (hm(zerar), hm(fim), hm(fim)))
    else:
        zerar = mais_min(fim, -int(cfg.get("zerar_minutos_antes_do_fim", 15)))
    if not nao_antes < nao_depois < zerar < fim:
        raise B3Erro("janela inconsistente: entradas %s a %s, zerar %s, fim %s" % (hm(nao_antes), hm(nao_depois),
                                                                                 hm(zerar), hm(fim)))
    return {"nao_antes": nao_antes, "nao_depois": nao_depois, "zerar_ate": zerar}


def estado_mercado(ref, agora, classe="acao"):
    d = agora.date()
    ses, mot = sessao(ref, d, classe)
    if not ses:
        st, _ = info_dia(ref, d)
        prox, mot2 = proximo_pregao(ref, d)
        desconhecido = st == "desconhecido" or mot.startswith("grade") or mot.startswith("nenhuma grade")
        return {"estado": "desconhecido" if desconhecido else "fechado", "motivo": mot,
                "proximo_pregao": prox.isoformat() if prox else None, "motivo_proximo": mot2}
    t = agora.time()
    if ses["pre_abertura"] and ses["pre_abertura"] <= t < ses["abertura"]:
        estado = "pre-abertura"
    elif ses["abertura"] <= t < ses["fim_negociacao"]:
        estado = "aberto"
    elif ses["fim_negociacao"] <= t < ses["fim_call"]:
        estado = "call"
    else:
        estado = "fechado"
    inicio = ses["pre_abertura"] or ses["abertura"]
    prox, mot2 = proximo_pregao(ref, d, incluir=t < inicio)
    return {"estado": estado, "motivo": "", "sessao": ses, "proximo_pregao": prox.isoformat() if prox else None,
            "motivo_proximo": mot2}


def checar_janela(ref, cfg, agora, classe="acao"):
    """(ok, motivos, info). Entradas só no pregão, dentro da janela, com calendário e grade conhecidos."""
    em = estado_mercado(ref, agora, classe)
    if em["estado"] == "desconhecido":
        return False, ["calendário ou grade desconhecidos: " + em["motivo"]], em
    if "sessao" not in em:
        return False, ["mercado fechado hoje (%s)" % em["motivo"]], em
    lim = limites_do_dia(ref, cfg, em["sessao"])
    em["limites"] = lim
    t = agora.time().replace(second=0, microsecond=0)
    if em["estado"] != "aberto":
        estado = "fechado" if em["estado"] == "fechado" else "em " + em["estado"]
        return False, ["mercado %s às %s (negociação de %s a %s)" % (
            estado, hm(t), hm(em["sessao"]["abertura"]), hm(em["sessao"]["fim_negociacao"]))], em
    if t < lim["nao_antes"]:
        return False, ["nenhuma entrada antes de %s (são %s)" % (hm(lim["nao_antes"]), hm(t))], em
    if t > lim["nao_depois"]:
        return False, ["nenhuma entrada depois de %s (são %s)" % (hm(lim["nao_depois"]), hm(t))], em
    return True, [], em


# ---------------------------------------------------------------- dinheiro

def D(x, oque="número"):
    if isinstance(x, Decimal):
        return x
    try:
        if isinstance(x, float):
            return Decimal(repr(x))
        if isinstance(x, int):
            return Decimal(x)
        s = str(x).strip().replace("R$", "").strip()
        if "," in s and "." in s:
            s = s.replace(".", "").replace(",", ".")
        elif "," in s:
            s = s.replace(",", ".")
        return Decimal(s)
    except (InvalidOperation, ValueError):
        raise B3Erro("%s não é número: %r" % (oque, x))


def cent(x):
    return D(x).quantize(CENT, rounding=ROUND_HALF_UP)


def para_baixo(x, passo=CENT):
    passo = D(passo)
    return (D(x) / passo).to_integral_value(rounding=ROUND_FLOOR) * passo


def meio_para_cima(x, passo=CENT):
    passo = D(passo)
    return (D(x) / passo).to_integral_value(rounding=ROUND_HALF_UP) * passo


def num(x, casas=2):
    """45.36 -> '45,36'; 1234.5 -> '1.234,50'."""
    s = "{:,.{c}f}".format(float(x), c=casas)
    return s.replace(",", "X").replace(".", ",").replace("X", ".")


def rs(x):
    v = float(x)
    return ("-R$ " if v < 0 else "R$ ") + num(abs(v))


def pct(x, casas=2):
    return num(x, casas) + "%"


# ---------------------------------------------------------------- custos

def taxa_b3_pct(ref, estilo):
    e = ref["custos"]["emolumentos_b3_pct_por_lado"]
    return D(e["day_trade" if estilo == "day" else "normal"]["total"])


def corretagem(cfg, estilo):
    v = (cfg.get("corretagem") or {}).get(estilo)
    if v is None:
        raise CustoDesconhecido("custo desconhecido: informe em trader/config.json a corretagem por ordem de %s "
                                "que aparece na sua nota" % ("day trade" if estilo == "day" else "swing"))
    return D(v)


def custo_lado(ref, cfg, estilo, financeiro):
    return cent(corretagem(cfg, estilo) + D(financeiro) * taxa_b3_pct(ref, estilo) / 100)


def custo_ida_volta(ref, cfg, estilo, qtd, entrada, saida):
    q = D(qtd)
    return custo_lado(ref, cfg, estilo, q * D(entrada)) + custo_lado(ref, cfg, estilo, q * D(saida))


# ---------------------------------------------------------------- ativos

RE_ACAO = re.compile(r"^[A-Z]{4}\d{1,2}F?$")
RE_OPCAO = re.compile(r"^[A-Z]{4}[A-X]\d{1,4}(W\d)?E?$")
RE_MINI = re.compile(r"^(WIN|WDO|IND|DOL|BIT|WSP)[A-Z]\d{2}$")


def ticker_base(t):
    t = t.strip().upper()
    if t.endswith(".SA"):
        t = t[:-3]
    if RE_ACAO.match(t) and t.endswith("F"):
        t = t[:-1]
    return t


def ticker_negociacao(ticker, classe, qtd):
    base = ticker_base(ticker)
    if classe == "acao" and 0 < int(qtd) < 100:
        return base + "F"
    return base


def lote(ref, classe):
    m = ref["microestrutura"]
    return int({"fii": m["lote_fii"], "bdr": m["lote_bdr"]}.get(classe, m["lote_padrao_acoes"]))


def tick(ref):
    return D(ref["microestrutura"]["tick_acoes"])


# ---------------------------------------------------------------- dimensionamento

def _inteiro(x):
    x = D(x)
    return int(x.to_integral_value(rounding=ROUND_FLOOR)) if x > 0 else 0


def dimensionar(ref, cfg, entrada, stop, alvo, classe, estilo, ignorar_custos=False, caixa=None):
    """Quantidade = menor entre risco, posição máxima e caixa disponível. Inteiro.

    O risco usa o stop com deslizamento e os custos de ida e volta. Quantidade zero é recusa:
    nunca encolhe o stop. ignorar_custos=True só serve ao modo simulado com custo alto."""
    e, s, a = D(entrada), D(stop), D(alvo)
    if not s < e < a:
        raise B3Erro("precisa stop < entrada < alvo (stop %s, entrada %s, alvo %s)" % (num(s), num(e), num(a)))
    desliz = tick(ref) * int(cfg.get("deslizamento_ticks", 1))
    saida_stop = s - desliz
    risco_acao = e - saida_stop
    risco_max = D(cfg["risco_por_operacao"])
    capital = D(cfg["capital"])
    caixa_min = capital * D(cfg["caixa_min_pct"]) / 100
    pos_max = capital * D(cfg["posicao_max_pct"]) / 100
    disponivel = capital - caixa_min
    if caixa is not None:
        disponivel = min(disponivel, D(caixa) - caixa_min)
    if ignorar_custos:
        corr, taxa = D(0), D(0)
    else:
        corr, taxa = corretagem(cfg, estilo), taxa_b3_pct(ref, estilo)
    # q * risco_acao + 2*corr + q*(e + saida_stop)*taxa/100 <= risco_max
    numerador = risco_max - 2 * corr
    den = risco_acao + (e + saida_stop) * taxa / 100
    limites = [
        {"nome": "risco", "qtd": _inteiro(numerador / den) if numerador > 0 else 0,
         "como": "(%s menos %s de corretagem) / %s por ação" % (rs(risco_max), rs(2 * corr), num(den, 4))},
        {"nome": "posição máxima", "qtd": _inteiro(pos_max / e),
         "como": "%s%% de %s = %s / %s" % (num(cfg["posicao_max_pct"], 0), rs(capital), rs(pos_max), num(e))},
        {"nome": "caixa", "qtd": _inteiro(disponivel / e),
         "como": "%s acima do caixa mínimo / %s" % (rs(max(disponivel, D(0))), num(e))},
    ]
    menor = min(x["qtd"] for x in limites)
    for x in limites:
        x["define"] = x["qtd"] == menor
    q = menor
    lt = lote(ref, classe)
    if q >= lt:
        q = (q // lt) * lt
    elif classe != "acao":
        q = 0
    out = {"qtd": q, "entrada": e, "stop": s, "alvo": a, "saida_stop": saida_stop, "deslizamento": desliz,
           "risco_por_acao": e - s, "limites": limites, "ignorou_custos": ignorar_custos,
           "rr_bruto": cent((a - e) / (e - s))}
    if q == 0:
        out.update({"financeiro": D(0), "perda_no_stop": D(0), "custos_stop": D(0), "perda_total": D(0),
                    "ganho_bruto": D(0), "custos_alvo": D(0), "ganho_liquido": D(0), "rr_liquido": None})
        return out
    if ignorar_custos:
        c_stop = c_alvo = D(0)
    else:
        c_stop = custo_ida_volta(ref, cfg, estilo, q, e, saida_stop)
        c_alvo = custo_ida_volta(ref, cfg, estilo, q, e, a)
    perda = cent(q * risco_acao)
    ganho = cent(q * (a - e))
    out.update({"financeiro": cent(q * e), "perda_no_stop": perda, "custos_stop": c_stop,
                "perda_total": perda + c_stop, "ganho_bruto": ganho, "custos_alvo": c_alvo,
                "ganho_liquido": ganho - c_alvo,
                "rr_liquido": cent((ganho - c_alvo) / (perda + c_stop)) if perda + c_stop > 0 else None})
    return out


def custos_estimados(ref, cfg, estilo, qtd, entrada, stop, alvo):
    """Custos reais de uma quantidade já escolhida, mesmo quando o simulado ignorou custos no tamanho."""
    desliz = tick(ref) * int(cfg.get("deslizamento_ticks", 1))
    c_stop = custo_ida_volta(ref, cfg, estilo, qtd, entrada, D(stop) - desliz)
    c_alvo = custo_ida_volta(ref, cfg, estilo, qtd, entrada, alvo)
    perda = cent(D(qtd) * (D(entrada) - D(stop) + desliz)) + c_stop
    ganho = cent(D(qtd) * (D(alvo) - D(entrada))) - c_alvo
    return {"custos_stop": c_stop, "custos_alvo": c_alvo, "perda_total": perda, "ganho_liquido": ganho,
            "rr_liquido": cent(ganho / perda) if perda > 0 else None}


# ---------------------------------------------------------------- fingerprint

CAMPOS_ORDEM = ("ticker_negociacao", "lado", "quantidade", "tipo", "preco", "stop", "alvo", "validade", "estilo",
                "classe", "modo", "data")


def fingerprint(ordem):
    core = {k: str(ordem.get(k)) for k in CAMPOS_ORDEM if ordem.get(k) is not None}
    blob = json.dumps(core, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()[:16]


# ---------------------------------------------------------------- diário (CSV)

COLUNAS_DIARIO = ("data", "data_entrada", "ativo", "classe", "estilo", "setup", "entrada", "stop", "alvo",
                  "quantidade", "saida", "custos", "resultado_rs", "resultado_r", "motivo_saida", "emocao", "nota",
                  "modo")


def ler_diario(caminho):
    if not caminho or not os.path.exists(caminho):
        return []
    with open(caminho, encoding="utf-8", newline="") as fh:
        linhas = list(csv.DictReader(fh))
    out = []
    for r in linhas:
        x = dict(r)
        for k in ("entrada", "stop", "alvo", "saida", "custos", "resultado_rs", "resultado_r"):
            try:
                x[k] = float(r.get(k)) if r.get(k) not in (None, "") else None
            except ValueError:
                raise B3Erro("diário: %s inválido em %s %s: %r" % (k, r.get("data"), r.get("ativo"), r.get(k)))
        try:
            x["quantidade"] = int(float(r.get("quantidade") or 0))
        except ValueError:
            raise B3Erro("diário: quantidade inválida em %s %s" % (r.get("data"), r.get("ativo")))
        x["modo"] = r.get("modo") or "real"
        out.append(x)
    return out


def anexar_diario(caminho, linha):
    novo = not os.path.exists(caminho)
    d = os.path.dirname(caminho)
    if d:
        os.makedirs(d, exist_ok=True)
    with open(caminho, "a", encoding="utf-8", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=COLUNAS_DIARIO, extrasaction="ignore")
        if novo:
            w.writeheader()
        w.writerow({k: ("" if linha.get(k) is None else linha.get(k)) for k in COLUNAS_DIARIO})


def resultado_operacao(ref, cfg, estilo, qtd, entrada, saida, stop):
    """(custos, resultado_rs, resultado_r). R sobre o risco planejado q x (entrada - stop)."""
    c = custo_ida_volta(ref, cfg, estilo, qtd, entrada, saida)
    liq = cent(D(qtd) * (D(saida) - D(entrada)) - c)
    risco = D(qtd) * (D(entrada) - D(stop))
    r = (liq / risco).quantize(Decimal("0.001"), rounding=ROUND_HALF_UP) if risco > 0 else None
    return c, liq, r


# ---------------------------------------------------------------- fase e carteira

def fase_verificada(cfg, diario, hoje):
    """(fase efetiva, motivos, números). A fase do config só vale se o diário a comprova:
    fase 2 exige o tempo da fase 1 e operações simuladas em semanas distintas; fase 3 exige
    o critério de passagem (day trades simulados desde o início da fase 2, expectativa > mínimo)."""
    declarada = int(cfg.get("fase", 1))
    fases = cfg.get("fases") or {}
    semanas = int(cfg.get("semanas_fase1", 4))
    crit = cfg.get("criterio_fase3") or {}
    motivos, nums = [], {"declarada": declarada}
    i1 = (fases.get("1") or {}).get("inicio")
    efetiva = 1
    if declarada >= 2:
        if not i1:
            motivos.append("fase 2 exige a data de início da fase 1 em config 'fases'")
        else:
            d1 = data(i1, "início da fase 1")
            sim = {data(x["data_entrada"] or x["data"]).isocalendar()[:2] for x in diario
                   if x.get("modo") == "simulado" and (x.get("data_entrada") or x.get("data") or "") >= i1}
            nums.update({"inicio_fase1": i1, "semanas_com_simulado": len(sim)})
            if hoje < d1 + dt.timedelta(weeks=semanas):
                motivos.append("fase 2 só depois de %d semanas de simulador: libera em %s" % (
                    semanas, (d1 + dt.timedelta(weeks=semanas)).isoformat()))
            elif len(sim) < semanas:
                motivos.append("fase 2 exige operações simuladas registradas em %d semanas distintas; há %d" % (
                    semanas, len(sim)))
            else:
                efetiva = 2
    if declarada >= 3 and efetiva == 2:
        i2 = (fases.get("2") or {}).get("inicio")
        minimo = int(crit.get("operacoes_min", 30))
        exp_min = float(crit.get("expectativa_min_rs", 0))
        if not i2:
            motivos.append("fase 3 exige a data de início da fase 2 em config 'fases'")
        else:
            dts = [x for x in diario if x.get("modo") == "simulado" and x.get("estilo") == "day"
                   and (x.get("data_entrada") or x.get("data") or "") >= i2 and x.get("resultado_rs") is not None]
            exp = sum(x["resultado_rs"] for x in dts) / len(dts) if dts else None
            nums.update({"inicio_fase2": i2, "day_trades_simulados": len(dts),
                         "expectativa_rs": round(exp, 2) if exp is not None else None})
            if len(dts) < minimo:
                motivos.append("fase 3 exige %d day trades simulados desde %s; há %d" % (minimo, i2, len(dts)))
            elif exp <= exp_min:
                motivos.append("fase 3 exige expectativa acima de %s por operação; está em %s" % (
                    rs(exp_min), rs(exp)))
            else:
                efetiva = 3
    nums["efetiva"] = efetiva
    return efetiva, motivos, nums


def posicao_do_modo(p, modo):
    """Posição sem 'modo' conta nos dois modos: no risco é o lado conservador, e na saída
    evita que uma posição real ou simulada fique sem como ser vendida."""
    return p.get("modo") in (None, "", modo)


def ler_portfolio(caminho):
    doc = ler_json(caminho, "carteira", obrigatorio=False) or {}
    doc.setdefault("posicoes", [])
    return doc


# ---------------------------------------------------------------- HTTP educado

_ULTIMA = [0.0]


def http_get(url, timeout=40, tentativas=3, pausa=1.0, cabecalhos=None):
    """GET com User-Agent identificado, pausa entre requisições e retry com backoff em 429 e 5xx."""
    espera = pausa - (time.time() - _ULTIMA[0])
    if espera > 0:
        time.sleep(espera)
    h = {"User-Agent": UA, "Accept": "*/*"}
    h.update(cabecalhos or {})
    ultimo = "sem resposta"
    for i in range(tentativas):
        try:
            req = urllib.request.Request(url, headers=h)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                _ULTIMA[0] = time.time()
                return r.read()
        except urllib.error.HTTPError as e:
            ultimo = "HTTP %d" % e.code
            e.close()
            if e.code == 429 or e.code >= 500:
                time.sleep(2 ** (i + 1))
                continue
            raise B3Erro("%s respondeu %s" % (url.split("?")[0], ultimo))
        except (urllib.error.URLError, OSError) as e:
            ultimo = "sem conexão: %s" % getattr(e, "reason", e)
            time.sleep(2 ** (i + 1))
    _ULTIMA[0] = time.time()
    raise B3Erro("%s não respondeu (%s)" % (url.split("?")[0], ultimo))


def com_cache(url, caminho, max_idade_h=None, **kw):
    """Bytes de url, guardados em caminho. Reusa o cache enquanto tiver menos de max_idade_h horas."""
    if os.path.exists(caminho):
        idade = (time.time() - os.path.getmtime(caminho)) / 3600.0
        if max_idade_h is None or idade < max_idade_h:
            with open(caminho, "rb") as fh:
                return fh.read()
    raw = http_get(url, **kw)
    os.makedirs(os.path.dirname(caminho) or ".", exist_ok=True)
    with open(caminho + ".tmp", "wb") as fh:
        fh.write(raw)
    os.replace(caminho + ".tmp", caminho)
    return raw


# ---------------------------------------------------------------- COTAHIST (B3, oficial)

def _p(campo):
    return int(campo) / 100.0


def parse_cotahist(texto, tickers=None, mercados=("010",)):
    """Linhas tipo 01 do COTAHIST -> registros. Preços com 2 casas implícitas."""
    alvo = set(tickers) if tickers else None
    out = []
    for ln in texto.splitlines():
        if len(ln) < 245 or ln[:2] != "01":
            continue
        tpm = ln[24:27]
        if mercados and tpm not in mercados:
            continue
        cod = ln[12:24].strip()
        if alvo is not None and cod not in alvo:
            continue
        try:
            out.append({"data": "%s-%s-%s" % (ln[2:6], ln[6:8], ln[8:10]), "ticker": cod, "tpmerc": tpm,
                        "nome": ln[27:39].strip(), "espec": ln[39:49].strip(), "o": _p(ln[56:69]),
                        "h": _p(ln[69:82]), "l": _p(ln[82:95]), "c": _p(ln[108:121]),
                        "negocios": int(ln[147:152]), "quantidade": int(ln[152:170]), "volume": _p(ln[170:188]),
                        "fator": int(ln[210:217]), "isin": ln[230:242]})
        except ValueError:
            continue
    return out


def url_cotahist(ref, d):
    modelo = ref["fontes_de_dados"]["cotahist_diario"]["url_modelo"]
    return modelo.replace("{DDMMAAAA}", d.strftime("%d%m%Y"))


def pasta_cotahist(pasta=PASTA):
    return os.path.join(pasta, "cache", "cotahist")


def registros_cotahist(fontes, tickers=None, mercados=("010",)):
    """fontes: arquivos (.ZIP, .TXT, .txt.gz) ou pastas com eles."""
    arqs = []
    for f in fontes:
        if os.path.isdir(f):
            arqs += [os.path.join(f, n) for n in sorted(os.listdir(f)) if n.upper().startswith("COTAHIST")]
        elif os.path.exists(f):
            arqs.append(f)
    regs = []
    for a in arqs:
        regs += parse_cotahist(ler_texto(a), tickers, mercados)
    return regs


def serie_diaria(regs, ticker):
    """Barras diárias do à vista (010), ordenadas, uma por data."""
    por = {}
    for r in regs:
        if r["ticker"] == ticker and r["tpmerc"] == "010":
            por[r["data"]] = {"data": r["data"], "o": r["o"], "h": r["h"], "l": r["l"], "c": r["c"],
                              "volume": r["volume"], "quantidade": r["quantidade"], "negocios": r["negocios"]}
    return [por[k] for k in sorted(por)]


def classe_cotahist(r):
    """acao, fii, bdr ou None (fora do perfil) a partir de especificação e nome resumido."""
    esp = (r.get("espec") or "").split()
    tipo = esp[0] if esp else ""
    if tipo in ("ON", "PN", "PNA", "PNB", "PNC", "PND", "UNT"):
        return "acao"
    if tipo == "CI" and (r.get("nome") or "").upper().startswith("FII"):
        return "fii"
    if tipo in ("DRN", "DR1", "DR2", "DR3"):
        return "bdr"
    return None


def dias_de_movimento_amplo(regs, limite=0.10, fracao=0.5, minimo=5):
    """Datas em que pelo menos `fracao` dos ativos à vista abriram mais de `limite` longe do fechamento
    anterior. Num dia assim o salto é do mercado (evento macro), não de um ativo (evento corporativo).
    Exemplo real: 26/10/2026, 101 ativos com salto acima de 25% no mesmo pregão."""
    por = {}
    for r in regs:
        if r["tpmerc"] == "010":
            por.setdefault(r["ticker"], {})[r["data"]] = r
    conta, total = {}, {}
    for t, dias in por.items():
        ds = sorted(dias)
        for a, b in zip(ds, ds[1:]):
            ra, rb = dias[a], dias[b]
            if ra["c"] <= 0:
                continue
            total[b] = total.get(b, 0) + 1
            if abs(rb["o"] / ra["c"] - 1) > limite:
                conta[b] = conta.get(b, 0) + 1
    return {d for d, n in conta.items() if total.get(d, 0) >= minimo and n >= fracao * total[d]}


def eventos_suspeitos(barras, limite=0.35, excluir=()):
    """Datas com abertura ou fechamento muito longe do fechamento anterior: provável desdobramento,
    grupamento, bonificação ou erro. Preços do COTAHIST não são ajustados. Datas de movimento amplo
    de mercado (excluir) não contam."""
    out = []
    for a, b in zip(barras, barras[1:]):
        if a["c"] <= 0 or b["data"] in excluir:
            continue
        if abs(b["o"] / a["c"] - 1) > limite or abs(b["c"] / a["c"] - 1) > limite:
            out.append(b["data"])
    return out


# ---------------------------------------------------------------- barras intradiárias

def parse_yahoo(texto):
    doc = json.loads(texto)
    res = (doc.get("chart") or {}).get("result")
    if not res:
        err = (doc.get("chart") or {}).get("error") or {}
        raise B3Erro("Yahoo sem dados: %s" % (err.get("description") or "ticker desconhecido"))
    r = res[0]
    q = ((r.get("indicators") or {}).get("quote") or [{}])[0]
    out = []
    for i, t in enumerate(r.get("timestamp") or []):
        def at(k):
            arr = q.get(k) or []
            return arr[i] if i < len(arr) else None
        c = at("close")
        if t is None or c is None:
            continue
        out.append({"t": int(t), "o": float(at("open") or c), "h": float(at("high") or c),
                    "l": float(at("low") or c), "c": float(c), "v": int(at("volume") or 0)})
    return out


def parse_brapi(texto):
    doc = json.loads(texto)
    res = doc.get("results") or []
    if not res:
        raise B3Erro("brapi sem dados: %s" % (doc.get("message") or doc.get("error") or "resposta vazia"))
    out = []
    for b in res[0].get("historicalDataPrice") or []:
        if b.get("close") is None or b.get("date") is None:
            continue
        c = float(b["close"])
        out.append({"t": int(b["date"]), "o": float(b.get("open") or c), "h": float(b.get("high") or c),
                    "l": float(b.get("low") or c), "c": c, "v": int(b.get("volume") or 0)})
    return out


def parse_mt5_csv(texto, ref, fuso_csv_horas=None):
    """Exportação de barras do MetaTrader 5 (<DATE> <TIME> <OPEN> ...). Horário do arquivo = Brasília,
    salvo fuso_csv_horas diferente."""
    linhas = [ln for ln in texto.replace("\r", "").split("\n") if ln.strip()]
    if not linhas or "<DATE>" not in linhas[0].upper():
        raise B3Erro("CSV não parece exportação do MT5 (cabeçalho <DATE> <TIME> <OPEN> ...)")
    sep = "\t" if "\t" in linhas[0] else ("," if "," in linhas[0] else ";")
    cab = [c.strip().strip("<>").upper() for c in linhas[0].split(sep)]
    ajuste = dt.timedelta(0)
    if fuso_csv_horas is not None:
        ajuste = offset(ref) - dt.timedelta(hours=float(fuso_csv_horas))
    out = []
    for ln in linhas[1:]:
        v = dict(zip(cab, [x.strip() for x in ln.split(sep)]))
        try:
            local = dt.datetime.strptime("%s %s" % (v["DATE"], v["TIME"]), "%Y.%m.%d %H:%M:%S") + ajuste
            utc = local - offset(ref)
            out.append({"t": int((utc - EPOCH).total_seconds()), "o": float(v["OPEN"]), "h": float(v["HIGH"]),
                        "l": float(v["LOW"]), "c": float(v["CLOSE"]),
                        "v": int(float(v.get("VOL") or v.get("TICKVOL") or 0))})
        except (KeyError, ValueError):
            continue
    return out


def carregar_barras(caminho, ref, fuso_csv_horas=None):
    texto = ler_texto(caminho)
    if texto.lstrip().startswith("{"):
        return parse_brapi(texto) if '"results"' in texto[:200] else parse_yahoo(texto)
    return parse_mt5_csv(texto, ref, fuso_csv_horas)


def sessoes_intradiarias(barras, ref, passo=CINCO_MIN):
    """{data: {slot: barra}}. Slot 0 = primeira barra da negociação do dia, na grade de 5 minutos.
    Barras fora da grade (tick ao vivo), fora da negociação ou em dia sem sessão conhecida são descartadas."""
    dias = {}
    for b in barras:
        if b["t"] % passo:
            continue
        loc = ts_local(b["t"], ref)
        ses, _ = sessao(ref, loc.date())
        if not ses:
            continue
        ab = dt.datetime.combine(loc.date(), ses["abertura"])
        fim = dt.datetime.combine(loc.date(), ses["fim_negociacao"])
        if not ab <= loc < fim:
            continue
        slot = int((loc - ab).total_seconds()) // passo
        dias.setdefault(loc.date().isoformat(), {})[slot] = dict(b, local=loc, slot=slot)
    return dias


def cobertura(dias):
    """Por dia: primeira e última barra e quantas existem."""
    out = {}
    for d in sorted(dias):
        s = dias[d]
        ks = sorted(s)
        out[d] = {"primeira": hm(s[ks[0]]["local"].time()), "ultima": hm(s[ks[-1]]["local"].time()),
                  "barras": len(ks)}
    return out


# ---------------------------------------------------------------- indicadores

def rsi(closes, n=14):
    """RSI de Wilder (mesma conta do original)."""
    if len(closes) < n + 1:
        return None
    g = [max(0.0, closes[i] - closes[i - 1]) for i in range(1, len(closes))]
    p = [max(0.0, closes[i - 1] - closes[i]) for i in range(1, len(closes))]
    ag, ap = sum(g[:n]) / n, sum(p[:n]) / n
    for i in range(n, len(g)):
        ag = (ag * (n - 1) + g[i]) / n
        ap = (ap * (n - 1) + p[i]) / n
    return 100 - 100 / (1 + ag / ap) if ap else 100.0


def atr(barras, n=14):
    """(ATR, barras usadas). Primeira barra usa máxima menos mínima."""
    trs, prev = [], None
    for b in barras:
        tr = b["h"] - b["l"]
        if prev is not None:
            tr = max(tr, abs(b["h"] - prev), abs(b["l"] - prev))
        trs.append(tr)
        prev = b["c"]
    use = trs[-n:]
    if not use:
        raise B3Erro("sem barras para o ATR")
    return sum(use) / len(use), len(use)


SETUPS_DIARIOS = [
    ("rompimento_20d", "rompimento da máxima de fechamento de 20 dias"),
    ("bandeira", "bandeira de alta"),
    ("retomada_mm20", "retomada da média de 20"),
    ("sobrevenda", "sobrevenda (RSI 14 abaixo de 30)"),
    ("repique", "repique de sobrevenda"),
]
MIN_BARRAS_SETUP = 30


def setups_diarios(closes):
    """Mesmas regras do trader-scanner original, sobre fechamentos (mais antigo primeiro, >= 30).
    Devolve (setups, números, nível de referência por setup)."""
    c = closes
    ult = c[-1]
    max20 = max(c[-21:-1])
    mm20 = sum(c[-20:]) / 20.0
    mm20_ant = sum(c[-21:-1]) / 20.0
    alta = c[-6] / c[-16] - 1
    faixa5 = (max(c[-5:]) - min(c[-5:])) / ult
    r, r_ant = rsi(c), rsi(c[:-1])
    tags, nivel = [], {}
    if ult > max20:
        tags.append("rompimento_20d")
        nivel["rompimento_20d"] = max20
    if alta > 0.10 and faixa5 < 0.05:
        tags.append("bandeira")
        nivel["bandeira"] = max(c[-5:])
    if c[-2] < mm20_ant and ult > mm20:
        tags.append("retomada_mm20")
        nivel["retomada_mm20"] = mm20
    if r is not None and r < 30:
        tags.append("sobrevenda")
        nivel["sobrevenda"] = ult
    if r_ant is not None and r_ant < 30 and ult > c[-2]:
        tags.append("repique")
        nivel["repique"] = c[-2]
    return tags, {"rsi": r, "rsi_ant": r_ant, "max20": max20, "mm20": mm20, "alta_pct": alta * 100,
                  "faixa5_pct": faixa5 * 100}, nivel


# ---------------------------------------------------------------- saída

def rodape(linhas):
    return list(linhas) + [AVISO]
