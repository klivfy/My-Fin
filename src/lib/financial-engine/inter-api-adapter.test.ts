import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  InterApiAdapter,
  type InterHttpClient,
  type InterTransactionPayload,
} from "./inter-api-adapter";

const ENV_KEYS = ["INTER_CLIENT_ID", "INTER_CLIENT_SECRET", "INTER_CERT_BASE64", "INTER_KEY_BASE64"] as const;
const originalEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

function setInterEnv() {
  process.env.INTER_CLIENT_ID = "client-id";
  process.env.INTER_CLIENT_SECRET = "client-secret";
  process.env.INTER_CERT_BASE64 = Buffer.from("CERT").toString("base64");
  process.env.INTER_KEY_BASE64 = Buffer.from("KEY").toString("base64");
}

beforeEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

describe("InterApiAdapter.normalize", () => {
  it("normaliza crédito e débito com sinal correto", () => {
    const adapter = new InterApiAdapter();
    const credit = adapter.normalize({
      dataTransacao: "2024-01-05",
      valor: "6850.00",
      descricao: "Pix Recebido Empresa",
      tipoTransacao: "CREDITO",
      idTransacao: "id-1",
    });
    expect(credit.amount.toFixed(2)).toBe("6850.00");
    expect(credit.date.toISOString()).toBe("2024-01-05T00:00:00.000Z");
    expect(credit.fitId).toBe("id-1");

    const debit = adapter.normalize({
      dataTransacao: "2024-01-06",
      valor: 150.5,
      descricao: "Pix Enviado Padaria",
      tipoTransacao: "DEBITO",
    });
    expect(debit.amount.toFixed(2)).toBe("-150.50");
    expect(debit.description).toBe("PIX ENVIADO PADARIA");
  });

  it("rejeita registro sem data ou valor", () => {
    const adapter = new InterApiAdapter();
    expect(() => adapter.normalize({ valor: "10" })).toThrow(/dataTransacao/);
  });
});

describe("InterApiAdapter.fetchTransactions", () => {
  it("falha explicitamente sem credenciais", async () => {
    const adapter = new InterApiAdapter({} as InterHttpClient);
    await expect(
      adapter.fetchTransactions({ from: new Date(), to: new Date() }),
    ).rejects.toThrow(/INTER_CLIENT_ID/);
  });

  it("falha explicitamente sem certificado", async () => {
    process.env.INTER_CLIENT_ID = "x";
    process.env.INTER_CLIENT_SECRET = "y";
    const adapter = new InterApiAdapter({} as InterHttpClient);
    await expect(
      adapter.fetchTransactions({ from: new Date(), to: new Date() }),
    ).rejects.toThrow(/INTER_CERT_BASE64/);
  });

  it("pagina até página vazia e normaliza o lote (fixture)", async () => {
    setInterEnv();
    const pages: InterTransactionPayload[] = [
      {
        transactions: Array.from({ length: 100 }, (_, i) => ({
          dataTransacao: "2024-01-05",
          valor: "1.00",
          descricao: `T${i}`,
          tipoTransacao: "CREDITO",
          idTransacao: `p0-${i}`,
        })),
      },
      {
        transactions: [
          {
            dataTransacao: "2024-01-06",
            valor: "25.00",
            descricao: "Última página",
            tipoTransacao: "DEBITO",
            idTransacao: "p1-0",
          },
        ],
      },
    ];
    const calls: number[] = [];
    const http: InterHttpClient = {
      fetchToken: async () => "token-abc",
      fetchTransactionsPage: async ({ page }) => {
        calls.push(page);
        return pages[page] ?? { transactions: [] };
      },
    };

    const adapter = new InterApiAdapter(http);
    const txs = await adapter.fetchTransactions({
      from: new Date(Date.UTC(2024, 0, 1)),
      to: new Date(Date.UTC(2024, 0, 31)),
    });

    expect(calls).toEqual([0, 1]); // parou na página parcial (< 100)
    expect(txs).toHaveLength(101);
    expect(txs[100].amount.toFixed(2)).toBe("-25.00");
  });
});
