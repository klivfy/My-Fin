import { describe, expect, it } from "vitest";
import { parseNotaSinacor } from "./nota-sinacor";
import { buildPdf } from "./pdf-fixture";
import { extractPdfPages, PdfError } from "./pdf-text";

// PDF gerado na hora, com nota fictícia.
const page = [
  "NOTA DE CORRETAGEM",
  "Nr. nota Folha Data pregão",
  "555 1 12/11/2026",
  "XP INVESTIMENTOS CCTVM S/A",
  "Negocios realizados",
  "1-BOVESPA C VISTA ABCD3 ON NM 10 20,00 200,00 D",
  "Emolumentos 0,01 D",
  "Taxa de liquidacao 0,05 D",
  "Liquido para 14/11/2026 200,06 D",
];

describe("extractPdfPages", () => {
  it("extrai o texto e a nota é lida de ponta a ponta", async () => {
    const pages = await extractPdfPages(buildPdf([page]));
    expect(pages).toHaveLength(1);
    const [note] = parseNotaSinacor(pages);
    expect(note).toMatchObject({ broker: "XP", noteNumber: "555", tradeDate: "2026-11-12" });
    expect(note.trades[0]).toMatchObject({ ticker: "ABCD3", quantity: 10 });
    expect(note.totalFees.toString()).toBe("0.06");
    expect(note.difference.toString()).toBe("0");
  });

  it("recusa arquivo que não é PDF", async () => {
    await expect(extractPdfPages(Buffer.from("não sou um pdf"))).rejects.toThrow(PdfError);
  });
});
