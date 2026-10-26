import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { OfxAdapter } from "./ofx-adapter";

const SGML_SAMPLE = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
SECURITY:NONE
ENCODING:USASCII
CHARSET:1252
COMPRESSION:NONE
OLDFILEUID:NONE
NEWFILEUID:NONE

<OFX>
<SIGNONMSGSRSV1>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20240105120000[-3:BRT]
<TRNAMT>-150,00
<FITID>abc123
<MEMO>Padaria do Zé
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20240106
<TRNAMT>5000.00
<FITID>def456
<MEMO>Salário Empresa XPTO
</STMTTRN>
</OFX>
`;

const XML_SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<OFX>
  <BANKTRANLIST>
    <STMTTRN>
      <TRNTYPE>DEBIT</TRNTYPE>
      <DTPOSTED>20240210143000</DTPOSTED>
      <TRNAMT>-79.90</TRNAMT>
      <FITID>xml001</FITID>
      <MEMO>Streaming</MEMO>
    </STMTTRN>
  </BANKTRANLIST>
</OFX>
`;

describe("OfxAdapter", () => {
  it("parseia OFX 1.x (SGML) com tags leaf sem fechamento", () => {
    const adapter = new OfxAdapter(SGML_SAMPLE);
    const blocks = adapter.parsePayload(undefined);
    expect(blocks).toHaveLength(2);
  });

  it("normaliza transação SGML com data, valor (vírgula) e descrição", () => {
    const adapter = new OfxAdapter(SGML_SAMPLE);
    const [first] = adapter.parsePayload(undefined);
    const tx = adapter.normalize(first);

    expect(tx.date.toISOString()).toBe("2024-01-05T12:00:00.000Z");
    expect(tx.amount).toBeInstanceOf(Decimal);
    expect(tx.amount.toFixed(2)).toBe("-150.00");
    expect(tx.description).toBe("PADARIA DO ZE");
    expect(tx.originalDescription).toBe("Padaria do Zé");
    expect(tx.fitId).toBe("abc123");
  });

  it("interpreta valor com ponto decimal (padrão OFX)", () => {
    const adapter = new OfxAdapter(SGML_SAMPLE);
    const blocks = adapter.parsePayload(undefined);
    const tx = adapter.normalize(blocks[1]);
    expect(tx.amount.toFixed(2)).toBe("5000.00");
  });

  it("data sem horário vira meia-noite UTC", () => {
    const adapter = new OfxAdapter(SGML_SAMPLE);
    const blocks = adapter.parsePayload(undefined);
    const tx = adapter.normalize(blocks[1]);
    expect(tx.date.toISOString()).toBe("2024-01-06T00:00:00.000Z");
  });

  it("parseia OFX 2.x (XML bem-formado)", () => {
    const adapter = new OfxAdapter(XML_SAMPLE);
    const blocks = adapter.parsePayload(undefined);
    expect(blocks).toHaveLength(1);
    const tx = adapter.normalize(blocks[0]);
    expect(tx.amount.toFixed(2)).toBe("-79.90");
    expect(tx.fitId).toBe("xml001");
  });

  it("decodifica buffer Windows-1252 conforme CHARSET do cabeçalho", () => {
    // "Açúcar" em Windows-1252: 0xE7 = ç
    const raw = `OFXHEADER:100\r\nCHARSET:1252\r\n\r\n<OFX>\n<STMTTRN>\n<DTPOSTED>20240105\n<TRNAMT>-1.00\n<MEMO>Açúcar\n</STMTTRN>\n</OFX>`;
    const bytes = Buffer.from(
      Array.from(raw).map((ch) => (ch === "ç" ? 0xe7 : ch.charCodeAt(0) & 0xff)),
    );
    const adapter = new OfxAdapter(bytes);
    const blocks = adapter.parsePayload(undefined);
    const tx = adapter.normalize(blocks[0]);
    expect(tx.originalDescription).toBe("Açúcar");
    expect(tx.description).toBe("ACUCAR");
  });

  it("lança erro claro quando DTPOSTED/TRNAMT estão ausentes", () => {
    const adapter = new OfxAdapter("<OFX><STMTTRN><MEMO>sem dados</MEMO></STMTTRN></OFX>");
    const blocks = adapter.parsePayload(undefined);
    expect(() => adapter.normalize(blocks[0])).toThrow(/DTPOSTED/);
  });

  it("arquivo sem nenhum STMTTRN retorna lista vazia", () => {
    const adapter = new OfxAdapter("<OFX></OFX>");
    expect(adapter.parsePayload(undefined)).toHaveLength(0);
  });

  it("fetchTransactions filtra pelo intervalo", async () => {
    const adapter = new OfxAdapter(SGML_SAMPLE);
    const from = new Date(Date.UTC(2024, 0, 6));
    const to = new Date(Date.UTC(2024, 0, 6, 23, 59, 59));
    const txs = await adapter.fetchTransactions({ from, to });
    expect(txs).toHaveLength(1);
    expect(txs[0].fitId).toBe("def456");
  });
});
