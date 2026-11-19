import { describe, expect, it } from "vitest";
import {
  createPluggyClient,
  pluggyCredentials,
  PluggyError,
} from "./pluggy-client";
import { mapPluggyTrades } from "./pluggy-map";

// Respostas simuladas no formato da documentação do Pluggy. Credenciais e ids fictícios.
const CREDS = {
  clientId: "00000000-0000-4000-8000-000000000001",
  clientSecret: "segredo-ficticio",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

function fakeFetch(routes: Record<string, (init?: RequestInit) => Response>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fn = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const path = url.replace("https://api.pluggy.ai", "");
    const key = Object.keys(routes).find(
      (k) => path === k || path.startsWith(`${k}?`),
    );
    if (!key) return json({ message: "rota desconhecida" }, 500);
    return routes[key](init);
  };
  return { fn, calls };
}

describe("pluggyCredentials", () => {
  it("só existe com id e secret preenchidos", () => {
    expect(pluggyCredentials({})).toBeNull();
    expect(
      pluggyCredentials({ PLUGGY_CLIENT_ID: "a", PLUGGY_CLIENT_SECRET: " " }),
    ).toBeNull();
    expect(
      pluggyCredentials({ PLUGGY_CLIENT_ID: " a ", PLUGGY_CLIENT_SECRET: "b" }),
    ).toEqual({
      clientId: "a",
      clientSecret: "b",
    });
  });
});

describe("createPluggyClient", () => {
  it("autentica uma vez, envia X-API-KEY e percorre as páginas", async () => {
    const { fn, calls } = fakeFetch({
      "/auth": () => json({ apiKey: "chave-1" }),
      "/investments": () => {
        const page = Number(
          new URL(calls.at(-1)!.url).searchParams.get("page"),
        );
        return json({
          page,
          total: 3,
          totalPages: 2,
          results: page === 1 ? [{ id: "i1" }, { id: "i2" }] : [{ id: "i3" }],
        });
      },
    });
    const api = createPluggyClient(CREDS, fn);
    const list = await api.listInvestments("item-1");
    expect(list.map((i) => i.id)).toEqual(["i1", "i2", "i3"]);
    expect(calls.filter((c) => c.url.endsWith("/auth"))).toHaveLength(1);
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      clientId: CREDS.clientId,
      clientSecret: CREDS.clientSecret,
    });
    const headers = calls[1].init?.headers as Record<string, string>;
    expect(headers["X-API-KEY"]).toBe("chave-1");
    expect(calls[1].url).toContain("itemId=item-1");
  });

  it("renova a chave uma vez quando a API responde 401", async () => {
    let auths = 0;
    let first = true;
    const { fn } = fakeFetch({
      "/auth": () => json({ apiKey: `chave-${++auths}` }),
      "/items/abc": () => {
        if (first) {
          first = false;
          return json({ message: "expired" }, 401);
        }
        return json({ id: "abc", status: "UPDATED" });
      },
    });
    const item = await createPluggyClient(CREDS, fn).getItem("abc");
    expect(item.status).toBe("UPDATED");
    expect(auths).toBe(2);
  });

  it("credencial recusada vira mensagem que cita as variáveis, sem expor o segredo", async () => {
    const { fn } = fakeFetch({
      "/auth": () => json({ message: "invalid" }, 401),
    });
    const error = await createPluggyClient(CREDS, fn)
      .getItem("x")
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PluggyError);
    expect((error as Error).message).toContain("PLUGGY_CLIENT_SECRET");
    expect((error as Error).message).not.toContain(CREDS.clientSecret);
  });

  it("404 vira PluggyError com status", async () => {
    const { fn } = fakeFetch({
      "/auth": () => json({ apiKey: "k" }),
      "/items/nada": () => json({}, 404),
    });
    await expect(
      createPluggyClient(CREDS, fn).getItem("nada"),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("filtra transações por data e cria token de conexão", async () => {
    const { fn, calls } = fakeFetch({
      "/auth": () => json({ apiKey: "k" }),
      "/investments/inv-1/transactions": () =>
        json({ page: 1, total: 0, totalPages: 1, results: [] }),
      "/connect_token": () => json({ accessToken: "tok" }),
    });
    const api = createPluggyClient(CREDS, fn);
    await api.listInvestmentTransactions("inv-1", "2026-11-01");
    expect(calls.at(-1)!.url).toContain("from=2026-11-01");
    expect(await api.createConnectToken()).toBe("tok");
  });
});

describe("mapPluggyTrades", () => {
  const equity = {
    id: "i1",
    code: "ABCD3",
    name: "ABCD ON",
    type: "EQUITY",
    institution: { name: "Corretora Fictícia" },
  };

  it("converte compra e venda, soma despesas sem o IR retido e ignora o resto", () => {
    const { trades, ignored } = mapPluggyTrades(
      [
        {
          investment: equity,
          transactions: [
            {
              id: "t1",
              type: "BUY",
              quantity: 100,
              value: 10.5,
              amount: 1050,
              tradeDate: "2026-11-03T00:00:00.000Z",
              date: "2026-11-05T00:00:00.000Z",
              expenses: {
                brokerageFee: 0.5,
                settlementFee: 0.26,
                incomeTax: 0.05,
              },
            },
            {
              id: "t2",
              type: "SELL",
              quantity: -40,
              value: 11.2,
              amount: 448,
              date: "2026-11-06T00:00:00.000Z",
            },
            {
              id: "t3",
              type: "TAX",
              quantity: 0,
              value: 0,
              amount: 3,
              date: "2026-11-06T00:00:00.000Z",
            },
            {
              id: "t4",
              type: "BUY",
              quantity: 1.5,
              value: 10,
              amount: 15,
              date: "2026-11-06T00:00:00.000Z",
            },
          ],
        },
        {
          investment: {
            id: "i2",
            code: null,
            name: "CDB Fictício",
            type: "FIXED_INCOME",
          },
          transactions: [
            {
              id: "t5",
              type: "BUY",
              quantity: 1,
              value: 1000,
              amount: 1000,
              date: "2026-11-01",
            },
          ],
        },
      ],
      "Pluggy",
    );
    expect(ignored).toBe(3);
    expect(trades).toHaveLength(2);
    const [buy, sell] = trades;
    expect(buy).toMatchObject({
      tradeDate: "2026-11-03",
      side: "BUY",
      ticker: "ABCD3",
      tickerKnown: true,
      quantity: 100,
      broker: "Corretora Fictícia",
    });
    expect(buy.price.toFixed(4)).toBe("10.5000");
    expect(buy.fees.toFixed(2)).toBe("0.76");
    expect(sell).toMatchObject({
      side: "SELL",
      quantity: 40,
      tradeDate: "2026-11-06",
    });
    expect(sell.grossAmount.toFixed(2)).toBe("448.00");
    expect(sell.fees.toFixed(2)).toBe("0.00");
  });

  it("deriva o preço do valor bruto e tira o sufixo F do fracionário", () => {
    const { trades } = mapPluggyTrades(
      [
        {
          investment: { id: "i3", code: "EFGH11F", name: "EFGH", type: "ETF" },
          transactions: [
            {
              id: "t6",
              type: "BUY",
              quantity: 4,
              value: null,
              amount: 393.6,
              date: "2026-11-04",
            },
          ],
        },
      ],
      "Pluggy",
    );
    expect(trades[0].ticker).toBe("EFGH11");
    expect(trades[0].price.toFixed(4)).toBe("98.4000");
    expect(trades[0].broker).toBe("Pluggy");
  });
});
