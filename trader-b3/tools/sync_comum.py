#!/usr/bin/env python3
"""Copia comum/b3comum.py (fonte única) para cada skill em skills/.

    python3 tools/sync_comum.py            # copia para todas as skills
    python3 tools/sync_comum.py --check    # só confere; sai com 1 se alguma cópia divergir

Cada skill leva uma cópia porque precisa rodar sozinha quando instalada em
~/.claude/skills/. Só biblioteca padrão.
"""

import argparse
import filecmp
import os
import shutil
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONTE = os.path.join(RAIZ, "comum", "b3comum.py")
SKILLS = os.path.join(RAIZ, "skills")


def skills():
    return sorted(d for d in os.listdir(SKILLS)
                  if os.path.isfile(os.path.join(SKILLS, d, "SKILL.md")))


def divergentes():
    out = []
    for s in skills():
        alvo = os.path.join(SKILLS, s, "b3comum.py")
        if not os.path.exists(alvo) or not filecmp.cmp(FONTE, alvo, shallow=False):
            out.append(s)
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--check", action="store_true", help="só confere, sem copiar")
    a = ap.parse_args(argv)
    diff = divergentes()
    if a.check:
        if diff:
            print("b3comum.py divergente da fonte em: %s" % ", ".join(diff), file=sys.stderr)
            print("rode: python3 tools/sync_comum.py", file=sys.stderr)
            return 1
        print("b3comum.py idêntico à fonte nas %d skills" % len(skills()))
        return 0
    for s in diff:
        shutil.copyfile(FONTE, os.path.join(SKILLS, s, "b3comum.py"))
        print("copiado para %s" % s)
    if not diff:
        print("nada a copiar: as %d skills já estão iguais à fonte" % len(skills()))
    return 0


if __name__ == "__main__":
    sys.exit(main())
