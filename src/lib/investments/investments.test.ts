import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { B3ImportError, parseB3Negociacao } from "./b3-negociacao";
import {
  findTicker,
  normalizeTicker,
  pairAcrossSources,
  parseBrDate,
  parseBrNumber,
  withMatchKeys,
} from "./common";
import { allocateFees, NotaError, parseNotaSinacor } from "./nota-sinacor";
import { computePositions, type PositionTrade } from "./positions";
import { readFirstSheet } from "./xlsx";
import { buildXlsx } from "./xlsx-fixture";

// Todos os ativos, valores e notas abaixo são fictícios.
const d = (v: string | number) => new Decimal(v);

describe("conversões", () => {
  it("lê números em formato brasileiro", () => {
    expect(parseBrNumber("R$ 1.234,56")?.toString()).toBe("1234.56");
    expect(parseBrNumber("10,5")?.toString()).toBe("10.5");
    expect(parseBrNumber(42)?.toString()).toBe("42");
    expect(parseBrNumber("12.5")?.toString()).toBe("12.5");
    expect(parseBrNumber("")).toBeNull();
    expect(parseBrNumber("abc")).toBeNull();
  });

  it("lê datas em texto e serial do Excel", () => {
    expect(parseBrDate("05/11/2026")).toBe("2026-11-05");
    expect(parseBrDate("2026-11-05")).toBe("2026-11-05");
    expect(parseBrDate(46331)).toBe("2026-11-05");
    expect(parseBrDate("31/02/2026")).toBeNull();
  });

  it("normaliza código de negociação", () => {
    expect(normalizeTicker("abcd3f")).toBe("ABCD3");
    expect(normalizeTicker("EFGH11")).toBe("EFGH11");
    expect(normalizeTicker("ABCD ON")).toBeNull();
    expect(findTicker("ABCD3 ON NM")).toBe("ABCD3");
    expect(findTicker("EMPRESA EXEMPLO ON NM")).toBeNull();
  });
});

const HEADER = [
  "Data do Negócio",
  "Tipo de Movimentação",
  "Mercado",
  "Prazo/Vencimento",
  "Instituição",
  "Código de Negociação",
  "Quantidade",
  "Preço",
  "Valor",
];

describe("parseB3Negociacao", () => {
  const sheet = buildXlsx([
    HEADER,
    ["05/11/2026", "Compra", "Mercado à Vista", "-", "CORRETORA EXEMPLO", "ABCD3", 100, 10.5, 1050],
    ["05/11/2026", "Compra", "Mercado Fracionário", "-", "CORRETORA EXEMPLO", "EFGH11F", 3, "98,40", "295,20"],
    [null, null, null, null, null, null, null, null, null],
    ["06/11/2026", "Venda", "Mercado à Vista", "-", "CORRETORA EXEMPLO", "ABCD3", 100, 11, 1100],
  ]);

  it("lê a planilha exportada e tira o F do fracionário", () => {
    const trades = parseB3Negociacao(readFirstSheet(sheet));
    expect(trades).toHaveLength(3);
    expect(trades[1]).toMatchObject({
      tradeDate: "2026-11-05",
      side: "BUY",
      ticker: "EFGH11",
      market: "Mercado Fracionário",
      quantity: 3,
    });
    expect(trades[1].price.toString()).toBe("98.4");
    expect(trades[1].grossAmount.toString()).toBe("295.2");
    expect(trades[2].side).toBe("SELL");
  });

  it("acha o cabeçalho mesmo com linhas de título antes", () => {
    const rows = readFirstSheet(buildXlsx([["Extrato de negociação"], [], HEADER, HEADER.map(() => null)]));
    expect(() => parseB3Negociacao(rows)).toThrow("nenhum negócio");
  });

  it("explica o erro quando falta coluna", () => {
    const rows = [["Data do Negócio", "Código de Negociação", "Quantidade"]];
    expect(() => parseB3Negociacao(rows)).toThrow("Faltam colunas na planilha: Tipo de Movimentação, Preço.");
  });

  it("recusa planilha que não é de negociação", () => {
    expect(() => parseB3Negociacao([["Produto", "Valor"]])).toThrow(B3ImportError);
  });

  it("aponta a linha com dado inválido", () => {
    const rows = [HEADER, ["05/11/2026", "Transferência", "", "", "", "ABCD3", 1, 1, 1]];
    expect(() => parseB3Negociacao(rows)).toThrow(/Linha 2: movimentação/);
  });

  it("reimportar gera as mesmas chaves; negócios idênticos no mesmo dia continuam distintos", () => {
    const rows = [
      HEADER,
      ["05/11/2026", "Compra", "", "", "", "ABCD3", 100, 10, 1000],
      ["05/11/2026", "Compra", "", "", "", "ABCD3", 100, 10, 1000],
    ];
    const a = withMatchKeys(parseB3Negociacao(rows));
    const b = withMatchKeys(parseB3Negociacao(rows));
    expect(a.map((t) => t.matchKey)).toEqual(b.map((t) => t.matchKey));
    expect(new Set(a.map((t) => t.matchKey)).size).toBe(2);
  });
});

/** Página de nota fictícia no layout SINACOR, como o texto sai do PDF. */
function notePage(opts: {
  number: string;
  date: string;
  trades: string[];
  summary?: string[];
  broker?: string;
}): string {
  return [
    "NOTA DE CORRETAGEM",
    "Nr. nota Folha Data pregão",
    `${opts.number} 1 ${opts.date}`,
    opts.broker ?? "XP INVESTIMENTOS CCTVM S/A",
    "Negócios realizados",
    "Q Negociação C/V Tipo mercado Prazo Especificação do título Obs. (*) Quantidade Preço / Ajuste Valor Operação / Ajuste D/C",
    ...opts.trades,
    ...(opts.summary ?? ["CONTINUA..."]),
  ].join("\n");
}

const SUMMARY = [
  "Resumo Financeiro",
  "Valor líquido das operações 50,00 C",
  "Taxa de liquidação 0,27 D",
  "Taxa de Registro 0,00 D",
  "Total CBLC 50,27 C",
  "Taxa de termo/opções 0,00 D",
  "Taxa A.N.A. 0,00 D",
  "Emolumentos 0,05 D",
  "Total Bovespa / Soma 0,05 D",
  "Taxa Operacional 0,00 D",
  "Execução 0,00",
  "Taxa de Custódia 0,00",
  "Impostos 0,00",
  "I.R.R.F. s/ operações, base R$ 1.100,00 0,05",
  "Outros 0,00 D",
  "Total Custos / Despesas 0,32 D",
  "Líquido para 10/11/2026 49,63 C",
];

describe("parseNotaSinacor", () => {
  const pages = [
    notePage({
      number: "000123456",
      date: "06/11/2026",
      trades: ["1-BOVESPA C VISTA ABCD3 ON NM 100 10,50 1.050,00 D"],
    }),
    notePage({
      number: "000123456",
      date: "06/11/2026",
      trades: ["1-BOVESPA V VISTA ABCD3 ON NM D 100 11,00 1.100,00 C"],
      summary: SUMMARY,
    }),
  ];

  it("junta as páginas da mesma nota e lê negócios, custos, IRRF e líquido", () => {
    const [note] = parseNotaSinacor(pages);
    expect(note).toMatchObject({ broker: "XP", noteNumber: "123456", tradeDate: "2026-11-06" });
    expect(note.trades).toHaveLength(2);
    expect(note.trades[0]).toMatchObject({ side: "BUY", ticker: "ABCD3", tickerKnown: true, quantity: 100 });
    expect(note.trades[1].grossAmount.toString()).toBe("1100");
    expect(note.totalFees.toString()).toBe("0.32");
    expect(note.irrf.toString()).toBe("0.05");
    expect(note.netAmount.toString()).toBe("49.63");
    expect(note.settlementDate).toBe("2026-11-10");
  });

  it("confere: vendas menos compras menos custos menos IRRF igual ao líquido", () => {
    const [note] = parseNotaSinacor(pages);
    expect(note.difference.toString()).toBe("0");
  });

  it("aponta diferença quando a soma não bate", () => {
    const broken = [pages[0], pages[1].replace("49,63 C", "60,00 C")];
    expect(parseNotaSinacor(broken)[0].difference.toString()).toBe("-10.37");
  });

  it("guarda a especificação quando a nota não traz o código", () => {
    const [note] = parseNotaSinacor([
      notePage({
        number: "77",
        date: "07/11/2026",
        broker: "BTG PACTUAL CTVM S/A",
        trades: ["1-BOVESPA C FRACIONARIO EMPRESA EXEMPLO ON NM 7 20,00 140,00 D"],
        summary: ["Líquido para 11/11/2026 140,00 D"],
      }),
    ]);
    expect(note.broker).toBe("BTG");
    expect(note.trades[0]).toMatchObject({ ticker: "EMPRESA EXEMPLO ON NM", tickerKnown: false, market: "FRACIONARIO" });
    expect(note.netAmount.toString()).toBe("-140");
  });

  it("separa várias notas do mesmo PDF", () => {
    const other = notePage({
      number: "124000",
      date: "07/11/2026",
      trades: ["1-BOVESPA C VISTA EFGH11 CI 1 100,00 100,00 D"],
      summary: ["Líquido para 11/11/2026 100,00 D"],
    });
    expect(parseNotaSinacor([...pages, other]).map((n) => n.noteNumber)).toEqual(["123456", "124000"]);
  });

  it("recusa PDF sem nota e nota sem líquido", () => {
    expect(() => parseNotaSinacor(["extrato qualquer"])).toThrow(NotaError);
    expect(() => parseNotaSinacor([pages[0]])).toThrow(/Líquido para/);
  });
});

describe("allocateFees", () => {
  it("rateia proporcional e fecha exatamente no total", () => {
    const shares = allocateFees([d(1050), d(1100), d(10)], d("0.32"));
    expect(shares.reduce((s, x) => s.plus(x), d(0)).toString()).toBe("0.32");
    expect(shares.map(String)).toEqual(["0.15", "0.17", "0"]);
  });

  it("lida com lista vazia e valores zerados", () => {
    expect(allocateFees([], d(1))).toEqual([]);
    expect(allocateFees([d(0), d(0)], d("0.10")).map(String)).toEqual(["0.1", "0"]);
  });
});

describe("pairAcrossSources", () => {
  const base = { tradeDate: "2026-11-06", side: "BUY" as const, quantity: 100, price: d("10.5") };

  it("casa nota sem código com negócio da B3 pela data, lado, quantidade e preço", () => {
    const { pairs, unmatched } = pairAcrossSources(
      [{ ...base, ticker: "EMPRESA EXEMPLO ON", tickerKnown: false }],
      [{ ...base, id: "b3-1", ticker: "ABCD3", tickerKnown: true }],
    );
    expect(pairs).toHaveLength(1);
    expect(pairs[0].existing.id).toBe("b3-1");
    expect(unmatched).toHaveLength(0);
  });

  it("não casa quando os dois têm código e eles diferem", () => {
    const { pairs, unmatched } = pairAcrossSources(
      [{ ...base, ticker: "EFGH3", tickerKnown: true }],
      [{ ...base, id: "b3-1", ticker: "ABCD3", tickerKnown: true }],
    );
    expect(pairs).toHaveLength(0);
    expect(unmatched).toHaveLength(1);
  });

  it("cada existente casa uma vez só", () => {
    const n = { ...base, ticker: "ABCD3", tickerKnown: true };
    const { pairs, unmatched } = pairAcrossSources([n, n], [{ ...n, id: "x" }]);
    expect(pairs).toHaveLength(1);
    expect(unmatched).toHaveLength(1);
  });
});

describe("computePositions", () => {
  const t = (
    tradeDate: string,
    side: "BUY" | "SELL",
    quantity: number,
    price: number,
    fees: number | string = 0,
    ticker = "ABCD3",
  ): PositionTrade => ({
    tradeDate,
    side,
    ticker,
    quantity,
    price: d(price),
    grossAmount: d(price).times(quantity),
    fees: d(fees),
  });

  it("preço médio inclui custos de compra", () => {
    const [p] = computePositions([t("2026-11-03", "BUY", 100, 10, 1), t("2026-11-04", "BUY", 100, 12, 1)]);
    expect(p.quantity).toBe(200);
    expect(p.averagePrice.toString()).toBe("11.01");
  });

  it("venda parcial realiza resultado e mantém o preço médio", () => {
    const [p] = computePositions([
      t("2026-11-03", "BUY", 100, 10, 1),
      t("2026-11-04", "BUY", 100, 12, 1),
      t("2026-11-05", "SELL", 50, 13, "0.5"),
    ]);
    expect(p.quantity).toBe(150);
    expect(p.averagePrice.toString()).toBe("11.01");
    // (650 - 0,50) - 50 × 11,01 = 99
    expect(p.realizedSwing.toString()).toBe("99");
  });

  it("separa day trade do swing", () => {
    const [p] = computePositions([
      t("2026-11-03", "BUY", 100, 10),
      t("2026-11-04", "BUY", 50, 11),
      t("2026-11-04", "SELL", 50, 12),
    ]);
    expect(p.realizedDayTrade.toString()).toBe("50");
    expect(p.realizedSwing.toString()).toBe("0");
    expect(p.quantity).toBe(100);
    expect(p.averagePrice.toString()).toBe("10");
  });

  it("posição zerada volta a custo zero", () => {
    const [p] = computePositions([t("2026-11-03", "BUY", 3, 10), t("2026-11-05", "SELL", 3, 9)]);
    expect(p.quantity).toBe(0);
    expect(p.totalCost.toString()).toBe("0");
    expect(p.realizedSwing.toString()).toBe("-3");
  });

  it("marca venda a descoberto como inconsistente", () => {
    const [p] = computePositions([t("2026-11-05", "SELL", 10, 9)]);
    expect(p.inconsistent).toBe(true);
    expect(p.quantity).toBe(0);
  });

  it("separa por ativo", () => {
    const ps = computePositions([t("2026-11-03", "BUY", 1, 10, 0, "EFGH11"), t("2026-11-03", "BUY", 5, 10)]);
    expect(ps.map((p) => p.ticker)).toEqual(["ABCD3", "EFGH11"]);
  });
});
