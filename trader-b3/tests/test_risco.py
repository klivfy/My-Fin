"""Testes de aceite do b3-risco: cada uma das 11 regras BLOQUEIA a entrada que a viola,
e uma SAÍDA de posição existente nunca é bloqueada. Offline, só biblioteca padrão.

Usa a referencia_b3.json e o config.example.json versionados no b3-relogio, num pregão
fixo (quinta 19/11/2026, 11:00 de Brasília)."""

import copy
import datetime as dt
import json
import os
import sys
import unittest

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RAIZ, "skills", "b3-risco"))
import risco  # noqa: E402

RELOGIO = os.path.join(RAIZ, "skills", "b3-relogio")
with open(os.path.join(RELOGIO, "referencia_b3.json"), encoding="utf-8") as fh:
    REF = json.load(fh)
with open(os.path.join(RELOGIO, "config.example.json"), encoding="utf-8") as fh:
    CFG_BASE = json.load(fh)
CFG_BASE["fases"]["1"]["inicio"] = "2026-11-01"

HOJE = "2026-11-19"
AGORA = dt.datetime(2026, 11, 19, 11, 0)
PLANO_BASE = {"ticker": "BBAS3", "classe": "acao", "estilo": "swing", "lado": "compra",
              "entrada": 20.00, "stop": 19.80, "alvo": 20.60, "data": HOJE, "setup": "teste"}


def op(data, resultado, modo="simulado", estilo="swing"):
    return {"data": data, "data_entrada": data, "ativo": "BBAS3", "modo": modo, "estilo": estilo,
            "resultado_rs": resultado}


class Base(unittest.TestCase):
    def setUp(self):
        self.cfg = copy.deepcopy(CFG_BASE)
        self.plano = dict(PLANO_BASE)
        self.diario = []
        self.port = {"posicoes": []}
        self.agora = AGORA

    def checar(self):
        return risco.checar_entrada(REF, self.cfg, self.plano, self.agora, self.diario, self.port)

    def regras(self, res):
        return {m.split(" ", 1)[0] for m in res["motivos"]}

    def assertBloqueadoPor(self, regra, res=None):
        res = res or self.checar()
        self.assertEqual(res["veredito"], "BLOQUEADO", res["motivos"])
        self.assertIn(str(regra), self.regras(res), res["motivos"])
        return res


class TestEntradaBase(Base):
    def test_plano_valido_no_simulado_e_aprovado(self):
        res = self.checar()
        self.assertEqual(res["veredito"], "APROVADO", res["motivos"])
        self.assertGreater(res["ordem"]["quantidade"], 0)
        self.assertEqual(res["ordem"]["lado"], "compra")
        self.assertTrue(res["fingerprint"])

    def test_quantidade_respeita_posicao_maxima(self):
        res = self.checar()
        financeiro = res["ordem"]["quantidade"] * PLANO_BASE["entrada"]
        self.assertLessEqual(financeiro, CFG_BASE["capital"] * CFG_BASE["posicao_max_pct"] / 100)

    def test_abaixo_de_100_acoes_usa_fracionario(self):
        self.assertTrue(self.checar()["ordem"]["ticker_negociacao"].endswith("F"))

    def test_simulado_avisa_que_a_conta_real_bloquearia_pelo_custo(self):
        res = self.checar()
        self.assertTrue(res["custo_alto_simulado"])
        self.assertTrue(any("seria BLOQUEADA" in a for a in res["avisos"]))


class TestRegrasDeEntrada(Base):
    def test_regra_1_stop_acima_da_entrada(self):
        self.plano["stop"] = 20.10
        self.assertBloqueadoPor(1)

    def test_regra_1_sem_stop(self):
        self.plano["stop"] = None
        self.assertBloqueadoPor(1)

    def test_regra_1_alvo_abaixo_da_entrada(self):
        self.plano["alvo"] = 19.90
        self.assertBloqueadoPor(1)

    def test_regra_2_custo_desconhecido(self):
        self.cfg["corretagem"]["swing"] = None
        self.assertBloqueadoPor(2)

    def test_regras_3_ou_11_corretagem_real_passa_do_risco(self):
        # R$ 4,90 por ordem: R$ 9,80 ida e volta já passa do risco de R$ 5.
        self.cfg["custo_alto_no_simulado"] = "bloquear"
        res = self.checar()
        self.assertEqual(res["veredito"], "BLOQUEADO")
        self.assertTrue(self.regras(res) & {"3", "11"}, res["motivos"])

    def test_regra_4_reward_risk_baixo(self):
        self.plano["alvo"] = 20.10
        self.assertBloqueadoPor(4)

    def test_regra_5_perda_do_dia(self):
        self.diario = [op(HOJE, -14.0)]
        self.assertBloqueadoPor(5)

    def test_regra_6_maximo_de_entradas(self):
        self.diario = [op(HOJE, 0.5), op(HOJE, 0.5), op(HOJE, 0.5)]
        self.assertBloqueadoPor(6)

    def test_regra_7_pausa_apos_limite_mensal(self):
        self.diario = [op("2026-11-16", -50.0)]
        res = self.assertBloqueadoPor(7)
        self.assertTrue(any("pausa" in m for m in res["motivos"]))

    def test_regra_7_mes_no_limite_depois_da_pausa(self):
        self.diario = [op("2026-11-03", -50.0)]
        self.assertBloqueadoPor(7)

    def test_regra_8_plano_de_outro_dia(self):
        self.plano["data"] = "2026-11-18"
        self.assertBloqueadoPor(8)

    def test_regra_8_antes_da_janela(self):
        self.agora = dt.datetime(2026, 11, 19, 10, 5)
        self.assertBloqueadoPor(8)

    def test_regra_8_feriado(self):
        self.agora = dt.datetime(2026, 11, 20, 11, 0)
        self.plano["data"] = "2026-11-20"
        self.assertBloqueadoPor(8)

    def test_regra_9_minicontrato(self):
        self.plano["ticker"] = "WINZ26"
        self.assertBloqueadoPor(9)

    def test_regra_9_venda_descoberta(self):
        self.plano["lado"] = "venda"
        self.assertBloqueadoPor(9)

    def test_regra_9_classe_fora_do_perfil(self):
        self.plano["classe"] = "cripto"
        self.assertBloqueadoPor(9)

    def test_regra_9_config_nao_libera_proibido(self):
        self.cfg["proibidos"] = []
        self.plano["ticker"] = "WDOZ26"
        res = self.assertBloqueadoPor(9)
        self.assertTrue(any("nunca afrouxa" in a for a in res["avisos"]))

    def test_regra_10_opcao_na_fase_1(self):
        self.plano.update({"ticker": "PETRL300", "classe": "opcao", "entrada": 0.50, "stop": None,
                           "alvo": None})
        self.assertBloqueadoPor(10)

    def test_regra_10_dinheiro_real_na_fase_1(self):
        self.cfg["modo"] = "real"
        self.assertBloqueadoPor(10)

    def test_regra_10_config_declara_fase_que_o_diario_nao_comprova(self):
        self.cfg["fase"] = 3
        self.cfg["modo"] = "real"
        res = self.assertBloqueadoPor(10)
        self.assertTrue(any("só comprova a fase 1" in a for a in res["avisos"]))

    def test_regra_11_stop_nunca_encolhe(self):
        # Stop distante: nem 1 ação cabe no risco; o pacote recusa em vez de mover o stop.
        self.plano.update({"stop": 10.00, "alvo": 40.00})
        res = self.assertBloqueadoPor(11)
        self.assertIsNone(res["ordem"])


class TestSaida(Base):
    def setUp(self):
        super().setUp()
        self.port = {"posicoes": [{"ticker": "BBAS3F", "quantidade": 10, "preco_medio": 20.00, "stop": 19.80,
                                   "alvo": 20.60, "estilo": "swing", "classe": "acao", "modo": "simulado",
                                   "data_entrada": "2026-11-17"}]}

    def sair(self, qtd=None, agora=None):
        return risco.checar_saida(REF, "BBAS3", qtd, None, "stop", agora or self.agora, self.port, "simulado")

    def test_saida_aprovada(self):
        res = self.sair()
        self.assertEqual(res["veredito"], "APROVADO")
        self.assertEqual(res["ordem"]["lado"], "venda")
        self.assertEqual(res["ordem"]["quantidade"], 10)

    def test_saida_nunca_bloqueada_com_mercado_fechado(self):
        res = self.sair(agora=dt.datetime(2026, 11, 19, 20, 0))
        self.assertEqual(res["veredito"], "APROVADO")
        self.assertTrue(any("mercado em" in a for a in res["avisos"]))

    def test_saida_nunca_bloqueada_no_feriado(self):
        self.assertEqual(self.sair(agora=dt.datetime(2026, 11, 20, 11, 0))["veredito"], "APROVADO")

    def test_saida_nunca_bloqueada_com_limites_estourados(self):
        # Perda do dia, entradas e pausa mensal não entram na saída.
        self.diario = [op(HOJE, -14.0), op(HOJE, -1.0), op("2026-11-16", -50.0)]
        self.assertEqual(self.sair()["veredito"], "APROVADO")

    def test_vender_sem_posicao_e_venda_descoberta(self):
        self.port = {"posicoes": []}
        res = self.sair()
        self.assertEqual(res["veredito"], "BLOQUEADO")
        self.assertIn("9", self.regras(res))

    def test_vender_mais_que_a_posicao_e_bloqueado(self):
        res = self.sair(qtd=11)
        self.assertEqual(res["veredito"], "BLOQUEADO")
        self.assertIn("9", self.regras(res))


if __name__ == "__main__":
    unittest.main()
