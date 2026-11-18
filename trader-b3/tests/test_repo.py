"""Invariantes do pacote: cópias de b3comum iguais à fonte, convenções dos SKILL.md e
nenhum dado pessoal versionado. Offline, só biblioteca padrão."""

import ast
import os
import re
import sys
import unittest

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RAIZ, "tools"))
import sync_comum  # noqa: E402

AVISO = "Material educacional; não é recomendação de investimento."
ESPERADAS = {"b3-relogio", "b3-scanner", "b3-noticias", "b3-plano", "b3-replay", "b3-risco", "b3-ticket",
             "b3-diario"}
# Nomes de arquivo que só existem na pasta de dados pessoais trader/.
DADOS_PESSOAIS = {"diario.csv", "orders.json", "portfolio.json", "plan.json", "risk.json", "config.json"}


class TestRepo(unittest.TestCase):
    def test_todas_as_skills_presentes(self):
        self.assertEqual(set(sync_comum.skills()), ESPERADAS)

    def test_b3comum_identico_a_fonte(self):
        self.assertEqual(sync_comum.divergentes(), [],
                         "cópia de b3comum.py divergente: rode python3 tools/sync_comum.py")

    def test_skill_md_convencoes(self):
        for s in sync_comum.skills():
            with open(os.path.join(sync_comum.SKILLS, s, "SKILL.md"), encoding="utf-8") as fh:
                txt = fh.read()
            with self.subTest(skill=s):
                self.assertTrue(txt.startswith("---\n"), "sem frontmatter")
                self.assertRegex(txt, r"(?m)^name: %s$" % re.escape(s))
                self.assertRegex(txt, r"(?m)^description: ")
                self.assertIn("O que nunca faz", txt)
                self.assertTrue(txt.rstrip().endswith(AVISO), "não termina com o aviso educacional")

    def test_nenhum_dado_pessoal_no_pacote(self):
        achados = []
        for raiz, dirs, arqs in os.walk(RAIZ):
            dirs[:] = [d for d in dirs if d not in ("__pycache__", "fixtures")]
            if os.path.basename(raiz) == "trader":
                achados.append(os.path.relpath(raiz, RAIZ))
            achados += [os.path.relpath(os.path.join(raiz, a), RAIZ) for a in arqs if a in DADOS_PESSOAIS]
        self.assertEqual(achados, [], "dados pessoais dentro do pacote")

    def test_so_biblioteca_padrao_e_sem_automacao(self):
        """Só stdlib (mais o próprio b3comum) e nada que carregue DLL ou plataforma de ordens."""
        proibidos = {"ctypes", "MetaTrader5"}
        for s in sync_comum.skills():
            pasta = os.path.join(sync_comum.SKILLS, s)
            for a in sorted(os.listdir(pasta)):
                if not a.endswith(".py"):
                    continue
                with open(os.path.join(pasta, a), encoding="utf-8") as fh:
                    arvore = ast.parse(fh.read())
                mods = set()
                for n in ast.walk(arvore):
                    if isinstance(n, ast.Import):
                        mods |= {x.name.split(".")[0] for x in n.names}
                    elif isinstance(n, ast.ImportFrom) and n.module and not n.level:
                        mods.add(n.module.split(".")[0])
                with self.subTest(arquivo="%s/%s" % (s, a)):
                    fora = {m for m in mods if m not in sys.stdlib_module_names and m != "b3comum"}
                    self.assertEqual(fora, set(), "dependência fora da biblioteca padrão")
                    self.assertEqual(mods & proibidos, set(), "automação proibida")

if __name__ == "__main__":
    unittest.main()
