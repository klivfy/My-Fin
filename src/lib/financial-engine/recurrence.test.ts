import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { buildBillCalendar, detectRecurrences, expectedDateInMonth, merchantKey, type RecurrenceTx } from "./recurrence";

const NOW = new Date(Date.UTC(2026, 9, 22)); // 22/out/2026

function tx(
  ymd: [number, number, number],
  amount: string,
  description: string,
  extra: Partial<RecurrenceTx> = {},
): RecurrenceTx {
  return {
    date: new Date(Date.UTC(ymd[0], ymd[1] - 1, ymd[2])),
    amount: new Decimal(amount),
    description,
    categoryId: null,
    categoryNature: null,
    isInstallment: false,
    ...extra,
  };
}

/** Mesma cobrança nos meses informados (ano 2026), no dia `day`. */
function monthly(months: number[], day: number, amount: string, description: string, extra: Partial<RecurrenceTx> = {}) {
  return months.map((m) => tx([2026, m, day], amount, description, extra));
}

describe("merchantKey", () => {
  it("remove números, pontuação e marcadores de parcela", () => {
    expect(merchantKey("NETFLIX.COM 8812")).toBe("NETFLIX COM");
    expect(merchantKey("NETFLIX.COM 9921")).toBe("NETFLIX COM");
    expect(merchantKey("LOJAS AMERICANAS PARC 02/06")).toBe("LOJAS AMERICANAS");
  });
});

describe("expectedDateInMonth", () => {
  it("não estoura meses curtos", () => {
    expect(expectedDateInMonth(2026, 1, 31).toISOString().slice(0, 10)).toBe("2026-02-28");
  });
});

describe("detectRecurrences", () => {
  it("assinatura fixa, mesmo dia, sem lacunas → assinatura de confiança alta", () => {
    const [netflix] = detectRecurrences(
      monthly([5, 6, 7, 8, 9, 10], 10, "-39.90", "NETFLIX.COM", { categoryNature: "WANT" }),
      NOW,
    );
    expect(netflix).toMatchObject({ key: "NETFLIX COM", cadence: "MONTHLY", kind: "SUBSCRIPTION", confidence: "HIGH" });
    expect(netflix.dayOfMonth).toBe(10);
    expect(netflix.annualCost.toFixed(2)).toBe("478.80");
    expect(netflix.isActive).toBe(true);
  });

  it("conta de valor variável e vencimento regular é conta mensal de confiança média", () => {
    const energia = [
      tx([2026, 7, 10], "-180.10", "CIA ENERGIA ELETRICA"),
      tx([2026, 8, 11], "-95.40", "CIA ENERGIA ELETRICA"),
      tx([2026, 9, 9], "-210.00", "CIA ENERGIA ELETRICA"),
      tx([2026, 10, 10], "-150.00", "CIA ENERGIA ELETRICA"),
    ];
    const [result] = detectRecurrences(energia, NOW);
    expect(result).toMatchObject({ cadence: "MONTHLY", kind: "BILL", confidence: "MEDIUM" });
  });

  it("dia fixo de pagamento não é exigido: valor fixo em dias variados ainda é mensal", () => {
    const [condominio] = detectRecurrences(
      [
        tx([2026, 7, 2], "-450.00", "CONDOMINIO RESIDENCIAL"),
        tx([2026, 8, 27], "-450.00", "CONDOMINIO RESIDENCIAL"),
        tx([2026, 9, 14], "-450.00", "CONDOMINIO RESIDENCIAL"),
      ],
      NOW,
    );
    expect(condominio).toMatchObject({ cadence: "MONTHLY", confidence: "MEDIUM" });
  });

  it("valor E dia variando (ex.: delivery ~1x/mês) fica com confiança baixa e fora do calendário", () => {
    const delivery = [
      tx([2026, 8, 16], "-27.05", "IFOOD *IFOOD"),
      tx([2026, 9, 2], "-80.82", "IFOOD *IFOOD"),
      tx([2026, 10, 20], "-61.20", "IFOOD *IFOOD"),
    ];
    const recurrences = detectRecurrences(delivery, NOW);
    expect(recurrences[0].confidence).toBe("LOW");
    expect(buildBillCalendar(recurrences, NOW).entries).toEqual([]);
  });

  it("só 2 meses com valor variável é baixa, mesmo com dias parecidos; valor fixo já é média", () => {
    const variable = detectRecurrences(
      [tx([2026, 9, 16], "-27.05", "IFOOD *IFOOD"), tx([2026, 10, 20], "-80.82", "IFOOD *IFOOD")],
      NOW,
    );
    expect(variable[0].confidence).toBe("LOW");

    const fixed = detectRecurrences(monthly([9, 10], 12, "-19.90", "APP NOVO"), NOW);
    expect(fixed[0].confidence).toBe("MEDIUM");
  });

  it("valor fixo em categoria de Necessidade é conta, não assinatura", () => {
    const [condominio] = detectRecurrences(
      monthly([7, 8, 9, 10], 5, "-450.00", "PIX ENVIADO CONDOMINIO", { categoryNature: "NEED" }),
      NOW,
    );
    expect(condominio.kind).toBe("BILL");
  });

  it("ignora gastos frequentes (várias vezes por mês)", () => {
    const ifood = [7, 8, 9, 10].flatMap((m) => [
      tx([2026, m, 3], "-45.00", "IFOOD"),
      tx([2026, m, 12], "-62.00", "IFOOD"),
      tx([2026, m, 20], "-38.00", "IFOOD"),
    ]);
    expect(detectRecurrences(ifood, NOW)).toEqual([]);
  });

  it("ignora parcelamentos", () => {
    const parcelas = [
      ...monthly([7, 8, 9, 10], 15, "-200.00", "MAGAZINE LUIZA", { isInstallment: true }),
      ...[1, 2, 3, 4].map((n) => tx([2026, 6 + n, 15], "-99.00", `LOJAS AMERICANAS PARC 0${n}/06`)),
    ];
    expect(detectRecurrences(parcelas, NOW)).toEqual([]);
  });

  it("uma única cobrança ou meses muito esparsos não são recorrência", () => {
    expect(detectRecurrences([tx([2026, 10, 1], "-10.00", "LOJA X")], NOW)).toEqual([]);
    expect(detectRecurrences(monthly([1, 5, 10], 1, "-10.00", "LOJA Y"), NOW)).toEqual([]);
  });

  it("assinatura que parou de cobrar fica inativa", () => {
    const [old] = detectRecurrences(monthly([3, 4, 5, 6], 8, "-29.90", "APP CANCELADO"), NOW);
    expect(old.isActive).toBe(false);
  });

  it("detecta cobrança anual (~12 meses de intervalo)", () => {
    const [annual] = detectRecurrences(
      [tx([2025, 11, 3], "-199.00", "ANUIDADE CLUBE"), tx([2026, 11, 2], "-199.00", "ANUIDADE CLUBE")],
      new Date(Date.UTC(2026, 10, 20)),
    );
    expect(annual).toMatchObject({ cadence: "ANNUAL", confidence: "MEDIUM" });
    expect(annual.monthlyCost.toFixed(2)).toBe("16.58");
    expect(annual.nextDate.toISOString().slice(0, 10)).toBe("2027-11-02");
  });
});

describe("buildBillCalendar", () => {
  const recurrences = detectRecurrences(
    [
      // Paga neste mês (outubro), dia 10.
      ...monthly([7, 8, 9, 10], 10, "-39.90", "NETFLIX.COM", { categoryNature: "WANT" }),
      // Vence dia 15 e ainda não caiu em outubro → atrasada em 22/out (15 + 3 dias de tolerância < 22).
      ...monthly([7, 8, 9], 15, "-21.90", "SPOTIFY PREMIUM", { categoryNature: "WANT" }),
      // Vence dia 28 → a vencer.
      ...monthly([7, 8, 9], 28, "-129.90", "ACADEMIA SMARTFIT", { categoryNature: "WANT" }),
    ],
    NOW,
  );

  it("marca pago, atrasado e a vencer e ordena por data", () => {
    const calendar = buildBillCalendar(recurrences, NOW);
    expect(calendar.entries.map((e) => [e.recurrence.key, e.status, e.expectedDate.getUTCDate()])).toEqual([
      ["NETFLIX COM", "PAID", 10],
      ["SPOTIFY PREMIUM", "OVERDUE", 15],
      ["ACADEMIA SMARTFIT", "UPCOMING", 28],
    ]);
    expect(calendar.paid.toFixed(2)).toBe("39.90");
    expect(calendar.pending.toFixed(2)).toBe("151.80");
    expect(calendar.total.toFixed(2)).toBe("191.70");
  });

  it("dentro da tolerância ainda não é atrasada", () => {
    const calendar = buildBillCalendar(recurrences, new Date(Date.UTC(2026, 9, 18)));
    expect(calendar.entries.find((e) => e.recurrence.key === "SPOTIFY PREMIUM")?.status).toBe("UPCOMING");
  });

  it("anual só aparece no mês em que vence", () => {
    const annual = detectRecurrences(
      [tx([2025, 11, 3], "-199.00", "ANUIDADE CLUBE"), tx([2026, 11, 2], "-199.00", "ANUIDADE CLUBE")],
      new Date(Date.UTC(2026, 10, 20)),
    );
    expect(buildBillCalendar(annual, new Date(Date.UTC(2026, 10, 20))).entries).toHaveLength(1); // pago em nov/26
    expect(buildBillCalendar(annual, new Date(Date.UTC(2027, 3, 10))).entries).toHaveLength(0); // abr/27
    expect(buildBillCalendar(annual, new Date(Date.UTC(2027, 10, 1))).entries[0]?.status).toBe("UPCOMING");
  });
});
