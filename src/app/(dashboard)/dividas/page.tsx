import Link from "next/link";
import { HandCoins, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Money } from "@/components/money";
import { EmptyState } from "@/components/dashboard/empty-state";
import { DebtDialog } from "@/components/debts/debt-dialog";
import { DebtActions } from "@/components/debts/debt-actions";
import { StrategySwitch } from "@/components/debts/strategy-switch";
import { formatBRL } from "@/lib/format";
import { getDebtsData, resolveExtra, resolveStrategy, type PlanView } from "@/lib/queries/debts";
import { cn } from "@/lib/utils";

const monthYear = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(iso));
const pct = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });
const toInput = (n: number) => n.toFixed(2).replace(".", ",");
const months = (n: number) => (n === 1 ? "1 mês" : `${n} meses`);

export default async function DebtsPage({
  searchParams,
}: {
  searchParams: Promise<{ extra?: string; metodo?: string }>;
}) {
  const { extra: extraParam, metodo } = await searchParams;
  const data = await getDebtsData(resolveExtra(extraParam));
  const c = data.comparison;

  const header = (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-on-surface">Dívidas</h1>
        <p className="text-sm text-on-surface-variant">
          Plano de quitação: quando uma dívida acaba, a parcela dela rola para a próxima.
        </p>
      </div>
      <DebtDialog
        trigger={
          <Button size="sm" className="gap-1.5">
            <Plus className="size-4" aria-hidden />
            Nova dívida
          </Button>
        }
      />
    </div>
  );

  if (!c) {
    return (
      <div className="space-y-6">
        {header}
        <EmptyState
          icon={HandCoins}
          title="Nenhuma dívida cadastrada"
          description="Liste cada dívida parcelada com o valor da parcela, quantas faltam e o juro ao mês do contrato. O app compara pagar só as parcelas, a bola de neve e a avalanche."
          action={
            <DebtDialog
              trigger={
                <Button className="gap-1.5">
                  <Plus className="size-4" aria-hidden />
                  Adicionar a primeira
                </Button>
              }
            />
          }
        />
      </div>
    );
  }

  // Sem escolha na URL: o mais barato; no empate, a bola de neve (vitórias mais cedo, mesmo custo).
  const strategy = resolveStrategy(metodo) ?? (c.cheaper === "avalanche" ? "avalanche" : "bola-de-neve");
  const plan = strategy === "avalanche" ? c.avalanche : c.snowball;
  const nameById = new Map(data.debts.map((d) => [d.id, d.name]));
  const multiple = data.debts.length > 1;

  return (
    <div className="space-y-6">
      {header}

      <section aria-labelledby="lista" className="space-y-3">
        <h2 id="lista" className="text-sm font-medium text-on-surface">
          Suas dívidas
        </h2>
        <div className="relative overflow-x-auto rounded-xl border border-outline-variant bg-surface-container-lowest">
          <table className="w-full min-w-[720px] text-sm">
            <caption className="sr-only">Dívidas cadastradas</caption>
            <thead>
              <tr className="border-b border-outline-variant text-left text-xs text-on-surface-variant">
                <th scope="col" className="px-4 py-2.5 font-medium">Dívida</th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium">Parcela</th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium">Faltam</th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium">Juro a.m.</th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium">Para quitar hoje</th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium">
                  <span className="sr-only">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {data.debts.map((d) => (
                <tr key={d.id} className="border-b border-outline-variant last:border-0">
                  <th scope="row" className="px-4 py-2.5 text-left font-medium text-on-surface">
                    {d.name}
                  </th>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">{formatBRL(d.installment)}</td>
                  <td className="px-4 py-2.5 text-right">{d.remaining}</td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">{pct.format(d.monthlyRatePct)}%</td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap text-on-surface-variant">
                    ~{formatBRL(d.balanceToday)}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <DebtActions
                      debt={{
                        id: d.id,
                        name: d.name,
                        installment: toInput(d.installment),
                        remaining: String(d.remaining),
                        monthlyRatePct: String(d.monthlyRatePct).replace(".", ","),
                        remainingCount: d.remaining,
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-on-surface-variant">
          &ldquo;Para quitar hoje&rdquo; é o valor das parcelas restantes sem os juros futuros, uma estimativa. Peça o
          valor exato ao credor antes de quitar. Pagou uma parcela? Use &ldquo;Paguei 1&rdquo; para o plano andar junto.
        </p>
      </section>

      <section
        aria-labelledby="orcamento"
        className="space-y-4 rounded-xl border border-outline-variant bg-surface-container-lowest p-5"
      >
        <div className="space-y-1">
          <h2 id="orcamento" className="text-sm font-medium text-on-surface">
            Quanto vai para as dívidas por mês
          </h2>
          <p className="text-sm text-on-surface-variant">
            As parcelas de hoje somam{" "}
            <span className="font-medium text-on-surface tabular-nums">
              {formatBRL(data.monthlyBudget - data.extra)}
            </span>
            . Esse valor continua indo para as dívidas até a última acabar. Um extra, se houver, vai todo para a
            primeira da fila.
          </p>
        </div>
        <form method="get" className="flex flex-wrap items-end gap-3">
          {metodo && <input type="hidden" name="metodo" value={metodo} />}
          <div className="space-y-1.5">
            <Label htmlFor="extra">Extra por mês (R$)</Label>
            <Input
              id="extra"
              name="extra"
              inputMode="decimal"
              defaultValue={data.extra ? toInput(data.extra) : ""}
              placeholder="0,00"
              className="w-36"
            />
          </div>
          <Button type="submit" variant="outline">
            Simular
          </Button>
          {data.surplusContribution !== null && data.extra !== data.surplusContribution && (
            <Link
              href={`?${new URLSearchParams({ ...(metodo ? { metodo } : {}), extra: toInput(data.surplusContribution) })}`}
              scroll={false}
              className="inline-flex min-h-10 items-center rounded-lg px-3 text-sm font-medium text-primary hover:bg-secondary"
            >
              Usar a sobra real ({formatBRL(data.surplusContribution)}/mês)
            </Link>
          )}
        </form>
        {data.surplusContribution !== null && (
          <p className="text-xs text-on-surface-variant">
            A sobra real é a mesma das{" "}
            <Link href="/budgets" className="font-medium text-primary underline-offset-4 hover:underline">
              metas de poupança
            </Link>
            : se usar aqui, não conte com ela lá também.
          </p>
        )}
      </section>

      <section aria-labelledby="comparacao" className="space-y-3">
        <h2 id="comparacao" className="text-sm font-medium text-on-surface">
          Comparação{data.extra > 0 && ` · com ${formatBRL(data.extra)} extra por mês`}
        </h2>
        <div className="relative overflow-x-auto rounded-xl border border-outline-variant bg-surface-container-lowest">
          <table className="w-full min-w-[560px] text-sm">
            <caption className="sr-only">Só as parcelas, bola de neve e avalanche</caption>
            <thead>
              <tr className="border-b border-outline-variant text-left text-xs text-on-surface-variant">
                <td className="px-4 py-2.5" />
                <th scope="col" className="px-4 py-2.5 text-right font-medium">Só as parcelas</th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium">Bola de neve</th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium">Avalanche</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              <CompareRow label="Livre em" plans={[c.contract, c.snowball, c.avalanche]} cell={(p) => `${monthYear(p.freeOn)} (${months(p.months)})`} />
              <CompareRow label="Sai do bolso" plans={[c.contract, c.snowball, c.avalanche]} cell={(p) => formatBRL(p.totalPaid)} />
              <CompareRow label="Juros pagos" plans={[c.contract, c.snowball, c.avalanche]} cell={(p) => formatBRL(p.interest)} />
              <tr className="border-b border-outline-variant last:border-0">
                <th scope="row" className="px-4 py-2.5 text-left font-normal text-on-surface-variant">
                  Economia sobre só as parcelas
                </th>
                <td className="px-4 py-2.5 text-right text-on-surface-variant">base</td>
                {[c.snowball, c.avalanche].map((p, i) => (
                  <td key={i} className="px-4 py-2.5 text-right">
                    <Money value={c.contract.totalPaid - p.totalPaid} />
                  </td>
                ))}
              </tr>
              {multiple && (
                <tr>
                  <th scope="row" className="px-4 py-2.5 text-left font-normal text-on-surface-variant">
                    Segunda dívida quitada
                  </th>
                  <td className="px-4 py-2.5 text-right text-on-surface-variant">
                    {nthMonth(c.contract, 2)}
                  </td>
                  <td className="px-4 py-2.5 text-right">{c.secondWin.snowball ? `mês ${c.secondWin.snowball}` : ""}</td>
                  <td className="px-4 py-2.5 text-right">{c.secondWin.avalanche ? `mês ${c.secondWin.avalanche}` : ""}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <Verdict
          cheaper={c.cheaper}
          difference={c.difference}
          snowballSecond={c.secondWin.snowball}
          avalancheSecond={c.secondWin.avalanche}
          multiple={multiple}
        />
      </section>

      <section aria-labelledby="plano" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="plano" className="text-sm font-medium text-on-surface">
            Plano mês a mês
          </h2>
          <StrategySwitch current={strategy} />
        </div>
        <ol className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-on-surface-variant" aria-label="Ordem de ataque">
          {plan.order.map((id, i) => (
            <li key={id}>
              <span className="tabular-nums">{i + 1}.</span>{" "}
              <span className="font-medium text-on-surface">{nameById.get(id)}</span>
              {plan.payoffMonth[id] !== undefined && <> quitada no mês {plan.payoffMonth[id]}</>}
            </li>
          ))}
        </ol>
        <div className="relative overflow-x-auto rounded-xl border border-outline-variant bg-surface-container-lowest">
          <table className="w-max min-w-full text-sm">
            <caption className="sr-only">Pagamento de cada dívida mês a mês</caption>
            <thead>
              <tr className="border-b border-outline-variant text-left text-xs text-on-surface-variant">
                <th scope="col" className="px-4 py-2.5 font-medium">Mês</th>
                {data.debts.map((d) => (
                  <th key={d.id} scope="col" className="px-4 py-2.5 text-right font-medium">
                    {d.name}
                  </th>
                ))}
                <th scope="col" className="px-4 py-2.5 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {plan.schedule.map((row) => (
                <tr key={row.month} className="border-b border-outline-variant last:border-0">
                  <th scope="row" className="px-4 py-2 text-left font-normal whitespace-nowrap text-on-surface-variant">
                    {row.month} · {monthYear(row.date)}
                  </th>
                  {row.payments.map((p, i) => {
                    const id = data.debts[i].id;
                    const closes = row.paidOff.includes(id);
                    return (
                      <td
                        key={id}
                        className={cn("px-4 py-2 text-right whitespace-nowrap", p === 0 && "text-on-surface-variant")}
                      >
                        {p === 0 ? "" : formatBRL(p)}
                        {closes && <span className="ml-1.5 text-xs font-medium text-income">quitada</span>}
                      </td>
                    );
                  })}
                  <td className="px-4 py-2 text-right font-medium whitespace-nowrap">{formatBRL(row.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="regras" className="space-y-1.5 text-xs text-on-surface-variant">
        <h2 id="regras" className="text-sm font-medium text-on-surface">
          Premissas
        </h2>
        <ul className="list-disc space-y-1 pl-4">
          <li>
            O mínimo de cada dívida é a parcela inteira. Pagar só o mínimo da fatura do cartão para sobrar dinheiro
            não entra no plano: o rotativo costuma cobrar mais do que qualquer dívida da lista.
          </li>
          <li>
            Adiantar parcelas tira os juros proporcionais (Código de Defesa do Consumidor, art. 52, § 2º). Se o credor
            não der esse desconto, a economia real é menor. Peça o valor com desconto antes de pagar.
          </li>
          <li>Juro fixo e parcelas iguais (tabela Price). Atraso, multa e renegociação mudam a conta.</li>
          <li>Simulação educativa: não substitui conversar com o credor nem aconselhamento financeiro.</li>
        </ul>
      </section>
    </div>
  );
}

function nthMonth(plan: PlanView, n: number): string {
  const m = Object.values(plan.payoffMonth).sort((a, b) => a - b)[n - 1];
  return m ? `mês ${m}` : "";
}

function CompareRow({ label, plans, cell }: { label: string; plans: PlanView[]; cell: (p: PlanView) => string }) {
  return (
    <tr className="border-b border-outline-variant last:border-0">
      <th scope="row" className="px-4 py-2.5 text-left font-normal text-on-surface-variant">
        {label}
      </th>
      {plans.map((p, i) => (
        <td key={i} className={cn("px-4 py-2.5 text-right whitespace-nowrap", i === 0 ? "text-on-surface-variant" : "font-medium text-on-surface")}>
          {cell(p)}
        </td>
      ))}
    </tr>
  );
}

function Verdict({
  cheaper,
  difference,
  snowballSecond,
  avalancheSecond,
  multiple,
}: {
  cheaper: "bola-de-neve" | "avalanche" | "empate";
  difference: number;
  snowballSecond: number | null;
  avalancheSecond: number | null;
  multiple: boolean;
}) {
  if (!multiple) {
    return (
      <p className="text-sm text-on-surface-variant">
        Com uma dívida só, os dois métodos são iguais: o ganho vem do extra mensal.
      </p>
    );
  }
  const earlier = snowballSecond !== null && avalancheSecond !== null ? avalancheSecond - snowballSecond : 0;
  return (
    <div className="space-y-1 text-sm text-on-surface-variant">
      <p>
        {cheaper === "empate" ? (
          <>Na conta, os dois métodos custam praticamente o mesmo.</>
        ) : (
          <>
            Na conta, a <span className="font-medium text-on-surface">{cheaper === "avalanche" ? "avalanche" : "bola de neve"}</span>{" "}
            sai <span className="font-medium text-on-surface tabular-nums">{formatBRL(difference)}</span> mais barata.
          </>
        )}
        {earlier > 0 && (
          <>
            {" "}
            A bola de neve fecha a segunda dívida {months(earlier)} antes, e ver dívidas acabando ajuda a não desistir no
            meio.
          </>
        )}
      </p>
      <p className="text-xs">
        Escolha a avalanche se você segue o plano sem precisar de vitórias rápidas. Escolha a bola de neve se precisa ver
        resultado para continuar. O que não dá é pagar só as parcelas e gastar a parcela que sobra quando uma dívida acaba.
      </p>
    </div>
  );
}
