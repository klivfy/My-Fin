import { describe, expect, it } from "vitest";
import { columnIndex, decodeXml, readFirstSheet, XlsxError } from "./xlsx";
import { buildXlsx } from "./xlsx-fixture";

describe("readFirstSheet", () => {
  const rows = [
    ["Data do Negócio", "Quantidade", "Preço"],
    ["05/11/2026", 100, 10.5],
    [null, null, null],
    ["A & B <teste>", null, 3],
  ];

  it("lê strings compartilhadas, números e células vazias (deflate)", () => {
    expect(readFirstSheet(buildXlsx(rows))).toEqual([
      ["Data do Negócio", "Quantidade", "Preço"],
      ["05/11/2026", 100, 10.5],
      [],
      ["A & B <teste>", null, 3],
    ]);
  });

  it("lê strings inline em ZIP sem compressão", () => {
    const out = readFirstSheet(buildXlsx(rows, { deflate: false, inlineStrings: true }));
    expect(out[0]).toEqual(["Data do Negócio", "Quantidade", "Preço"]);
    expect(out[3]).toEqual(["A & B <teste>", null, 3]);
  });

  it("recusa arquivo que não é xlsx", () => {
    expect(() => readFirstSheet(Buffer.from("isto não é um zip"))).toThrow(XlsxError);
  });
});

describe("auxiliares", () => {
  it("converte referência de coluna", () => {
    expect(columnIndex("A1")).toBe(0);
    expect(columnIndex("Z9")).toBe(25);
    expect(columnIndex("AB12")).toBe(27);
  });

  it("decodifica entidades XML", () => {
    expect(decodeXml("a &amp; b &lt;c&gt; &#231; &#xE3;")).toBe("a & b <c> ç ã");
  });
});
