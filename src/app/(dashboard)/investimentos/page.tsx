import { Briefcase } from "lucide-react";
import { Money } from "@/components/money";
import { EmptyState } from "@/components/dashboard/empty-state";
import { InvestmentsImport } from "@/components/investments/investments-import";
import { formatDateShort } from "@/lib/format";
import { getPortfolio, type InvestmentTradeRow, type PositionRow } from "@/lib/queries/investments";

const qty = new Intl.NumberFormat("pt-BR");
const price = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 4 });

export default async function InvestmentsPage() {
  const portfolio = await getPortfolio();

  if (!portfolio.hasAny) {
    return (
      <div className="space-y-6">
        <PageHeader subtitle="Negócios executados na bolsa, a partir dos arquivos oficiais." />
        <EmptyState
          icon={Briefcase}
          title="Nenhum negócio importado"
          description="Na Área do Investidor da B3, exporte Extratos > Negociação em Excel e importe aqui. Depois, importe as notas de corretagem em PDF para somar os custos ao preço médio."
          action={<InvestmentsImport />}
        />
      </div>
    );
  }

  const { totals, positions } = portfolio;
  const open = positions.filter((p) => p.quantity > 0);
  const closed = positions.filter((p) => p.quantity === 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageHeader subtitle="Preço médio e resultado a partir da B3 e das notas de corretagem." />
        <InvestmentsImport />
      </div>

      <section aria-labelledby="resumo" className="rounded-xl border border-outline-variant bg-card p-5">
        <h2 id="resumo" className="sr-only">
          Resumo da carteira
        </h2>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
          <div className="col-span-2 sm:col-span-1">
            <dt className="text-sm text-on-surface-variant">Custo da posição aberta</dt>
            <dd className="mt-1 text-2xl">
              <Money value={totals.openCost} tone="neutral" showSign={false} />
            </dd>
            <dd className="mt-0.5 text-xs text-on-surface-variant">
              {qty.format(open.length)} {open.length === 1 ? "ativo" : "ativos"}
            </dd>
          </div>
          <Stat label="Resultado swing" value={<Money value={totals.realizedSwing} />} />
          <Stat label="Resultado day trade" value={<Money value={totals.realizedDayTrade} />} />
          <Stat
            label="Custos das notas"
            value={<Money value={totals.fees} tone="neutral" showSign={false} />}
            context={`${qty.format(totals.notes)} ${totals.notes === 1 ? "nota" : "notas"}`}
          />
        </dl>
      </section>

      {portfolio.tradesWithoutNote > 0 && (
        <p className="rounded-xl border border-outline-variant bg-surface-container-low px-4 py-3 text-sm text-on-surface-variant">
          {qty.format(portfolio.tradesWithoutNote)}{" "}
          {portfolio.tradesWithoutNote === 1 ? "negócio ainda não tem nota" : "negócios ainda não têm nota"} de
          corretagem: o preço médio deles está sem custos até a nota ser importada.
        </p>
      )}

      <PositionsTable title="Posição aberta" rows={open} showOpen />
      {closed.length > 0 && <PositionsTable title="Posições encerradas" rows={closed} />}
      <TradesTable rows={portfolio.recentTrades} />

      <p className="text-xs text-on-surface-variant">
        Só leitura: o app não envia ordens. Desdobramentos, grupamentos e bonificações ainda não entram no preço
        médio.
        {portfolio.lastImport &&
          ` Última importação (${portfolio.lastImport.provider}): ${
            portfolio.lastImport.status === "SUCCESS" ? "concluída" : "com falha"
          }${portfolio.lastImport.finishedAt ? ` em ${formatDateShort(portfolio.lastImport.finishedAt).replace(/\.$/, "")}` : ""}.`}
      </p>
    </div>
  );
}

function PageHeader({ subtitle }: { subtitle: string }) {
  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight text-on-surface">Carteira</h1>
      <p className="text-sm text-on-surface-variant">{subtitle}</p>
    </div>
  );
}

function Stat({ label, value, context }: { label: string; value: React.ReactNode; context?: string }) {
  return (
    <div>
      <dt className="text-sm text-on-surface-variant">{label}</dt>
      <dd className="mt-1 text-lg">{value}</dd>
      {context && <dd className="mt-0.5 text-xs text-on-surface-variant">{context}</dd>}
    </div>
  );
}

function PositionsTable({ title, rows, showOpen }: { title: string; rows: PositionRow[]; showOpen?: boolean }) {
  if (rows.length === 0) return null;
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium text-on-surface">{title}</h2>
      <div className="overflow-x-auto rounded-xl border border-outline-variant bg-card">
        <table className="w-full min-w-[560px] text-sm">
          <caption className="sr-only">{title}</caption>
          <thead>
            <tr className="border-b border-outline-variant text-left text-xs text-on-surface-variant">
              <th scope="col" className="px-4 py-2.5 font-medium">Ativo</th>
              {showOpen && <th scope="col" className="px-4 py-2.5 text-right font-medium">Qtd.</th>}
              {showOpen && <th scope="col" className="px-4 py-2.5 text-right font-medium">Preço médio</th>}
              {showOpen && <th scope="col" className="px-4 py-2.5 text-right font-medium">Custo</th>}
              <th scope="col" className="px-4 py-2.5 text-right font-medium">Swing</th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">Day trade</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {rows.map((p) => (
              <tr key={p.ticker} className="border-b border-outline-variant last:border-0">
                <td className="px-4 py-2.5">
                  <span className="font-medium text-on-surface">{p.ticker}</span>
                  {p.inconsistent && (
                    <span className="ml-2 text-xs text-warning">venda acima da posição: confira os arquivos</span>
                  )}
                </td>
                {showOpen && <td className="px-4 py-2.5 text-right">{qty.format(p.quantity)}</td>}
                {showOpen && <td className="px-4 py-2.5 text-right">{price.format(p.averagePrice)}</td>}
                {showOpen && (
                  <td className="px-4 py-2.5 text-right">
                    <Money value={p.totalCost} tone="neutral" showSign={false} className="font-normal" />
                  </td>
                )}
                <td className="px-4 py-2.5 text-right">
                  <Money value={p.realizedSwing} className="font-normal" />
                </td>
                <td className="px-4 py-2.5 text-right">
                  <Money value={p.realizedDayTrade} className="font-normal" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function TradesTable({ rows }: { rows: InvestmentTradeRow[] }) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium text-on-surface">Últimos negócios</h2>
      <div className="overflow-x-auto rounded-xl border border-outline-variant bg-card">
        <table className="w-full min-w-[640px] text-sm">
          <caption className="sr-only">Últimos negócios importados</caption>
          <thead>
            <tr className="border-b border-outline-variant text-left text-xs text-on-surface-variant">
              <th scope="col" className="px-4 py-2.5 font-medium">Data</th>
              <th scope="col" className="px-4 py-2.5 font-medium">Ativo</th>
              <th scope="col" className="px-4 py-2.5 font-medium">Lado</th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">Qtd.</th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">Preço</th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">Valor</th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">Custos</th>
              <th scope="col" className="px-4 py-2.5 font-medium">Origem</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {rows.map((t) => (
              <tr key={t.id} className="border-b border-outline-variant last:border-0">
                <td className="px-4 py-2.5 whitespace-nowrap text-on-surface-variant">{formatDateShort(t.tradeDate)}</td>
                <td className="max-w-48 truncate px-4 py-2.5 font-medium text-on-surface" title={t.ticker}>
                  {t.ticker}
                </td>
                <td className="px-4 py-2.5 text-on-surface-variant">{t.side === "BUY" ? "Compra" : "Venda"}</td>
                <td className="px-4 py-2.5 text-right">{qty.format(t.quantity)}</td>
                <td className="px-4 py-2.5 text-right">{price.format(t.price)}</td>
                <td className="px-4 py-2.5 text-right">
                  <Money value={t.grossAmount} tone="neutral" showSign={false} className="font-normal" />
                </td>
                <td className="px-4 py-2.5 text-right text-on-surface-variant">
                  {t.hasNote ? price.format(t.fees) : "sem nota"}
                </td>
                <td className="px-4 py-2.5 text-xs text-on-surface-variant">
                  {t.source}
                  {t.broker && ` · ${t.broker}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
