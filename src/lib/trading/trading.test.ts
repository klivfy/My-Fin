import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { DiarioError, parseCsv, parseDiario } from "./diario";
import { journalStats, riskSnapshot, todayInB3, type RiskLimits, type RiskTrade } from "./risk";

const HEADER =
  "data,data_entrada,ativo,classe,estilo,setup,entrada,stop,alvo,quantidade,saida,custos,resultado_rs,resultado_r,motivo_saida,emocao,nota,modo";

describe("parseCsv", () => {
  it("respeita aspas, vírgulas e quebras de linha dentro do campo", () => {
    expect(parseCsv('a,b\r\n"x, y","linha 1\nlinha 2"\n')).toEqual([
      ["a", "b"],
      ["x, y", "linha 1\nlinha 2"],
    ]);
  });

  it("aceita aspas escapadas e BOM", () => {
    expect(parseCsv('﻿a\n"diz ""oi"""')).toEqual([["a"], ['diz "oi"']]);
  });
});

describe("parseDiario", () => {
  const csv = [
    HEADER,
    "2026-11-03,2026-11-03,abcd3,acao,day,rompimento,10.00,9.80,10.40,25,10.30,0.20,7.30,1.460,alvo,calmo,,simulado",
    '2026-11-04,,EFGH11,fii,swing,,,,,0,,,,,,,"nota, com vírgula",',
  ].join("\n");

  it("converte as colunas do b3-diario", () => {
    const [a, b] = parseDiario(csv);
    expect(a.ticker).toBe("ABCD3");
    expect(a.mode).toBe("SIMULADO");
    expect(a.quantity).toBe(25);
    expect(a.resultBrl?.toFixed(2)).toBe("7.30");
    expect(a.resultR?.toFixed(3)).toBe("1.460");
    expect(b.mode).toBe("REAL"); // modo vazio = real, como no b3comum.ler_diario
    expect(b.entryDate).toBeNull();
    expect(b.resultBrl).toBeNull();
    expect(b.note).toBe("nota, com vírgula");
  });

  it("gera o mesmo hash para a mesma linha (reimportação idempotente)", () => {
    const first = parseDiario(csv).map((r) => r.importHash);
    const again = parseDiario(csv).map((r) => r.importHash);
    expect(again).toEqual(first);
    expect(new Set(first).size).toBe(2);
  });

  it("recusa o arquivo inteiro na primeira linha inválida, citando a linha", () => {
    const bad = [HEADER, "2026-11-03,,ABCD3,,,,abc,,,,,,,,,,,"].join("\n");
    expect(() => parseDiario(bad)).toThrow(/Linha 2: entrada "abc"/);
  });

  it("recusa modo desconhecido e cabeçalho sem colunas obrigatórias", () => {
    expect(() => parseDiario([HEADER, "2026-11-03,,ABCD3,,,,,,,,,,,,,,,papel"].join("\n"))).toThrow(
      DiarioError,
    );
    expect(() => parseDiario("foo,bar\n1,2")).toThrow(/Cabeçalho sem data e ativo/);
  });
});

const d = (v: string | number) => new Decimal(v);
const t = (date: string, result: number | null, entryDate: string | null = null): RiskTrade => ({
  date,
  entryDate,
  resultBrl: result === null ? null : d(result),
});
const LIMITS: RiskLimits = {
  maxLossDay: d(15),
  maxLossMonth: d(50),
  pauseDaysAfterMonth: 7,
  maxTradesDay: 3,
};

describe("riskSnapshot", () => {
  it("soma só as perdas do dia e conta entradas pela data de entrada", () => {
    const s = riskSnapshot(
      [t("2026-11-10", -6), t("2026-11-10", 4), t("2026-11-10", -5, "2026-11-07"), t("2026-11-09", -9)],
      LIMITS,
      "2026-11-10",
    );
    expect(s.lossesToday.toFixed(2)).toBe("11.00");
    expect(s.entriesToday).toBe(2);
    expect(s.day).toEqual({ state: "ok", room: d(4) });
    expect(s.entriesBlocked).toBe(false);
  });

  it("limite do dia atingido barra novas entradas", () => {
    const s = riskSnapshot([t("2026-11-10", -15)], LIMITS, "2026-11-10");
    expect(s.day.state).toBe("reached");
    expect(s.entriesBlocked).toBe(true);
  });

  it("número máximo de entradas no dia", () => {
    const day = "2026-11-10";
    const s = riskSnapshot([t(day, 1), t(day, 1), t(day, 1)], LIMITS, day);
    expect(s.trades).toEqual({ state: "reached", room: 0 });
    expect(s.entriesBlocked).toBe(true);
  });

  it("pausa mensal atravessa a virada do mês (regressão do b3-risco)", () => {
    // Limite mensal batido em 28/10: entrada em 03/11 continua bloqueada (pausa até 04/11).
    const trades = [t("2026-10-20", -30), t("2026-10-28", -25)];
    const s = riskSnapshot(trades, LIMITS, "2026-11-03");
    expect(s.monthHitOn).toBe("2026-10-28");
    expect(s.pauseUntil).toBe("2026-11-04");
    expect(s.pause.active).toBe(true);
    expect(s.month.state).toBe("ok"); // novembro ainda zerado
    expect(s.entriesBlocked).toBe(true);
    expect(riskSnapshot(trades, LIMITS, "2026-11-04").entriesBlocked).toBe(false);
  });

  it("ignora operações com data futura e sem resultado", () => {
    const s = riskSnapshot([t("2026-11-20", -100), t("2026-11-10", null)], LIMITS, "2026-11-10");
    expect(s.monthResult.toFixed(2)).toBe("0.00");
    expect(s.entriesBlocked).toBe(false);
  });

  it("sem limites configurados não afirma bloqueio nem folga", () => {
    const none: RiskLimits = { maxLossDay: null, maxLossMonth: null, pauseDaysAfterMonth: null, maxTradesDay: null };
    const s = riskSnapshot([t("2026-11-10", -1000)], none, "2026-11-10");
    expect([s.day.state, s.month.state, s.trades.state]).toEqual(["unset", "unset", "unset"]);
    expect(s.entriesBlocked).toBe(false);
  });
});

describe("journalStats", () => {
  it("resultado, acerto e expectativa em R", () => {
    const s = journalStats([
      { resultBrl: d(10), resultR: d(2), costs: d(1) },
      { resultBrl: d(-5), resultR: d(-1), costs: d(1) },
      { resultBrl: null, resultR: null, costs: null },
    ]);
    expect(s.closed).toBe(2);
    expect(s.winRate).toBe(0.5);
    expect(s.net.toFixed(2)).toBe("5.00");
    expect(s.costs.toFixed(2)).toBe("2.00");
    expect(s.expectancyR?.toFixed(2)).toBe("0.50");
  });
});

describe("todayInB3", () => {
  it("usa o fuso de São Paulo, não UTC", () => {
    expect(todayInB3(new Date("2026-11-11T01:30:00Z"))).toBe("2026-11-10");
  });
});
