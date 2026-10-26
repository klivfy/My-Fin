import { describe, expect, it } from "vitest";
import { CsvAdapter, type CsvColumnMapping } from "./csv-adapter";

const BASE_MAPPING: CsvColumnMapping = {
  date: 0,
  description: 1,
  amount: 2,
  dateFormat: "dd/mm/yyyy",
  amountFormat: "br",
  hasHeader: true,
};

describe("CsvAdapter", () => {
  it("parseia CSV com cabeçalho, ponto e vírgula e formato BR", () => {
    const csv = `Data;Descrição;Valor
05/01/2024;Supermercado Pão de Açúcar;-1.234,56
06/01/2024;Salário;6.850,00`;
    const adapter = new CsvAdapter(csv, BASE_MAPPING);
    const rows = adapter.parsePayload(undefined);
    expect(rows).toHaveLength(2);

    const first = adapter.normalize(rows[0]);
    expect(first.date.toISOString()).toBe("2024-01-05T00:00:00.000Z");
    expect(first.amount.toFixed(2)).toBe("-1234.56");
    expect(first.description).toBe("SUPERMERCADO PAO DE ACUCAR");

    const second = adapter.normalize(rows[1]);
    expect(second.amount.toFixed(2)).toBe("6850.00");
  });

  it("auto-detecta vírgula como delimitador e respeita campos entre aspas", () => {
    const csv = `date,description,amount
2024-01-05,"Pagamento, com vírgula",-50.00`;
    const adapter = new CsvAdapter(csv, {
      ...BASE_MAPPING,
      dateFormat: "yyyy-mm-dd",
      amountFormat: "intl",
    });
    const rows = adapter.parsePayload(undefined);
    expect(rows).toHaveLength(1);
    const tx = adapter.normalize(rows[0]);
    expect(tx.originalDescription).toBe("Pagamento, com vírgula");
    expect(tx.amount.toFixed(2)).toBe("-50.00");
  });

  it("suporta colunas separadas de crédito/débito", () => {
    const csv = `Data;Descrição;Crédito;Débito
10/02/2024;Pix recebido;100,00;
10/02/2024;Conta de luz;;215,30`;
    const adapter = new CsvAdapter(csv, {
      date: 0,
      description: 1,
      credit: 2,
      debit: 3,
      dateFormat: "dd/mm/yyyy",
      amountFormat: "br",
      hasHeader: true,
    });
    const rows = adapter.parsePayload(undefined);
    expect(adapter.normalize(rows[0]).amount.toFixed(2)).toBe("100.00");
    expect(adapter.normalize(rows[1]).amount.toFixed(2)).toBe("-215.30");
  });

  it("interpreta formato mm/dd/yyyy", () => {
    const csv = `date,description,amount
12/25/2024,Gift,-25.00`;
    const adapter = new CsvAdapter(csv, {
      ...BASE_MAPPING,
      dateFormat: "mm/dd/yyyy",
      amountFormat: "intl",
    });
    const tx = adapter.normalize(adapter.parsePayload(undefined)[0]);
    expect(tx.date.toISOString()).toBe("2024-12-25T00:00:00.000Z");
  });

  it("lança erro claro em data ou valor inválido", () => {
    const badDate = new CsvAdapter(`31/99/2024;X;-1,00`, { ...BASE_MAPPING, hasHeader: false });
    expect(() => badDate.normalize(badDate.parsePayload(undefined)[0])).toThrow(/Data inválida/);

    const badAmount = new CsvAdapter(`05/01/2024;X;abc`, { ...BASE_MAPPING, hasHeader: false });
    expect(() => badAmount.normalize(badAmount.parsePayload(undefined)[0])).toThrow(/Valor inválido/);
  });

  it("sem cabeçalho: primeira linha já é dado", () => {
    const csv = `05/01/2024;Padaria;-10,00`;
    const adapter = new CsvAdapter(csv, { ...BASE_MAPPING, hasHeader: false });
    expect(adapter.parsePayload(undefined)).toHaveLength(1);
  });

  it("fetchTransactions filtra pelo intervalo", async () => {
    const csv = `Data;Descrição;Valor
05/01/2024;Dentro;-10,00
05/03/2024;Fora;-20,00`;
    const adapter = new CsvAdapter(csv, BASE_MAPPING);
    const txs = await adapter.fetchTransactions({
      from: new Date(Date.UTC(2024, 0, 1)),
      to: new Date(Date.UTC(2024, 0, 31, 23, 59, 59)),
    });
    expect(txs).toHaveLength(1);
    expect(txs[0].originalDescription).toBe("Dentro");
  });
});
