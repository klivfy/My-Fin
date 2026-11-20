import { Money } from "@/components/money";
import { SourcesPanel } from "@/components/investments/sources-panel";
import {
  getPortfolio,
  type InvestmentTradeRow,
  type PositionRow,
} from "@/lib/queries/investments";

const qty = new Intl.NumberFormat("pt-BR");
const price = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});
const percent = new Intl.NumberFormat("pt-BR", {
  style: "percent",
  maximumFractionDigits: 1,
});

export default async function InvestmentsPage() {
  const portfolio = await getPortfolio();

  const { totals, positions } = portfolio;
  const open = positions.filter((p) => p.quantity > 0);
  const closed = positions.filter((p) => p.quantity === 0);

  return (
    <div className="space-y-6">
      <PageHeader subtitle="Preço médio e resultado a partir da B3 e das notas de corretagem." />

      {/* A mesma árvore com e sem dados: o painel de fontes não remonta na
          primeira importação e a mensagem de resultado continua na tela. */}
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        {!portfolio.hasAny ? (
          <section
            aria-labelledby="comece"
            className="space-y-2 lg:col-start-1"
          >
            <h2 id="comece" className="text-sm font-medium text-on-surface">
              Nenhum negócio importado
            </h2>
            <p className="max-w-prose text-sm text-pretty text-on-surface-variant">
              Comece pela planilha de negociação da B3, que traz os negócios de
              todas as corretoras. Depois importe as notas de corretagem para
              somar taxas e corretagem ao preço médio. O app só lê os arquivos:
              nunca envia ordens.
            </p>
          </section>
        ) : (
          <section
            aria-labelledby="resumo"
            className="rounded-xl border border-outline-variant bg-surface-container-lowest p-5 lg:col-start-1"
          >
            <h2 id="resumo" className="sr-only">
              Resumo da carteira
            </h2>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
              <div className="col-span-2 sm:col-span-1">
                <dt className="text-sm text-on-surface-variant">
                  Custo da posição aberta
                </dt>
                <dd className="mt-1 text-2xl">
                  <Money
                    value={totals.openCost}
                    tone="neutral"
                    showSign={false}
                  />
                </dd>
                <dd className="mt-0.5 text-xs text-on-surface-variant">
                  {qty.format(open.length)}{" "}
                  {open.length === 1 ? "ativo" : "ativos"}
                </dd>
              </div>
              <Stat
                label="Resultado swing"
                value={<Money value={totals.realizedSwing} />}
                context="realizado"
              />
              <Stat
                label="Resultado day trade"
                value={<Money value={totals.realizedDayTrade} />}
                context="realizado"
              />
              <Stat
                label="Custos registrados"
                value={
                  <Money value={totals.fees} tone="neutral" showSign={false} />
                }
                context={`${qty.format(totals.notes)} ${totals.notes === 1 ? "nota" : "notas"}`}
              />
            </dl>
          </section>
        )}

        <aside className="order-last lg:order-none lg:sticky lg:top-20 lg:col-start-2 lg:row-span-4 lg:row-start-1">
          <SourcesPanel sources={portfolio.sources} />
        </aside>

        {portfolio.hasAny && (
          <div className="space-y-6 lg:col-start-1">
            <OpenPositions rows={open} total={totals.openCost} />
            {closed.length > 0 && <ClosedPositions rows={closed} />}
            <TradesTable rows={portfolio.recentTrades} />
            <p className="text-xs text-pretty text-on-surface-variant">
              Só leitura: o app não envia ordens. Desdobramentos, grupamentos e
              bonificações ainda não entram no preço médio.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function PageHeader({ subtitle }: { subtitle: string }) {
  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight text-on-surface">
        Carteira
      </h1>
      <p className="text-sm text-on-surface-variant">{subtitle}</p>
    </div>
  );
}

function Stat({
  label,
  value,
  context,
}: {
  label: string;
  value: React.ReactNode;
  context?: string;
}) {
  return (
    <div>
      <dt className="text-sm text-on-surface-variant">{label}</dt>
      <dd className="mt-1 text-lg">{value}</dd>
      {context && (
        <dd className="mt-0.5 text-xs text-on-surface-variant">{context}</dd>
      )}
    </div>
  );
}

const TH = "px-4 py-2.5 font-medium";
const TD = "px-4 py-2.5";
// Tabela de negócios tem 8 colunas: célula mais estreita para caber ao lado do painel em 1280.
const ORIGIN: Record<
  InvestmentTradeRow["source"],
  { short: string; title: string }
> = {
  B3: { short: "B3", title: "Planilha de negociação da B3" },
  Nota: { short: "Nota", title: "Nota de corretagem" },
  "Open Finance": { short: "Pluggy", title: "Open Finance, lido pelo Pluggy" },
};
const THC = "px-3 py-2.5 font-medium";
const TDC = "px-3 py-2.5";
/** "2026-11-06" → "06/11": dia do pregão em algarismos tabulares. */
const dayMonth = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

function TableFrame({
  title,
  caption,
  minWidth,
  children,
}: {
  title: string;
  caption: string;
  minWidth: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium text-on-surface">{title}</h2>
      <div className="overflow-x-auto rounded-xl border border-outline-variant bg-surface-container-lowest">
        <table className={`w-full text-sm ${minWidth}`}>
          <caption className="sr-only">{caption}</caption>
          {children}
        </table>
      </div>
    </section>
  );
}

function Inconsistent() {
  return (
    <span className="mt-0.5 block text-xs font-normal text-warning-on-container">
      venda acima da posição: confira os arquivos
    </span>
  );
}

function OpenPositions({
  rows,
  total,
}: {
  rows: PositionRow[];
  total: number;
}) {
  if (rows.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-outline-variant px-5 py-8 text-center text-sm text-on-surface-variant">
        Nenhuma posição aberta: todos os ativos importados foram vendidos.
      </p>
    );
  }
  return (
    <TableFrame
      title="Posição aberta"
      caption="Posição aberta por ativo, com peso pelo custo"
      minWidth="min-w-[640px]"
    >
      <thead>
        <tr className="border-b border-outline-variant text-left text-xs text-on-surface-variant">
          <th scope="col" className={TH}>
            Ativo
          </th>
          <th scope="col" className={`${TH} text-right`}>
            Qtd.
          </th>
          <th scope="col" className={`${TH} text-right`}>
            Preço médio
          </th>
          <th scope="col" className={`${TH} text-right`}>
            Custo
          </th>
          <th scope="col" className={`${TH} w-36`}>
            Peso pelo custo
          </th>
          <th scope="col" className={`${TH} text-right`}>
            Swing realizado
          </th>
        </tr>
      </thead>
      <tbody className="tabular-nums">
        {rows.map((p) => {
          const share = total > 0 ? p.totalCost / total : 0;
          return (
            <tr
              key={p.ticker}
              className="border-b border-outline-variant last:border-0"
            >
              <th
                scope="row"
                className={`${TD} text-left font-medium text-on-surface`}
              >
                {p.ticker}
                {p.inconsistent && <Inconsistent />}
              </th>
              <td className={`${TD} text-right`}>{qty.format(p.quantity)}</td>
              <td className={`${TD} text-right`}>
                {price.format(p.averagePrice)}
              </td>
              <td className={`${TD} text-right`}>
                <Money
                  value={p.totalCost}
                  tone="neutral"
                  showSign={false}
                  className="font-normal"
                />
              </td>
              <td className={TD}>
                <div className="flex items-center gap-2">
                  <div
                    className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-container-high"
                    aria-hidden
                  >
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${(share * 100).toFixed(1)}%` }}
                    />
                  </div>
                  <span className="w-12 text-right text-xs text-on-surface-variant">
                    {percent.format(share)}
                  </span>
                </div>
              </td>
              <td className={`${TD} text-right`}>
                <Money value={p.realizedSwing} className="font-normal" />
              </td>
            </tr>
          );
        })}
      </tbody>
    </TableFrame>
  );
}

function ClosedPositions({ rows }: { rows: PositionRow[] }) {
  return (
    <TableFrame
      title="Posições encerradas"
      caption="Resultado realizado de ativos já vendidos"
      minWidth="min-w-[420px]"
    >
      <thead>
        <tr className="border-b border-outline-variant text-left text-xs text-on-surface-variant">
          <th scope="col" className={TH}>
            Ativo
          </th>
          <th scope="col" className={`${TH} text-right`}>
            Swing
          </th>
          <th scope="col" className={`${TH} text-right`}>
            Day trade
          </th>
          <th scope="col" className={`${TH} text-right`}>
            Total
          </th>
        </tr>
      </thead>
      <tbody className="tabular-nums">
        {rows.map((p) => (
          <tr
            key={p.ticker}
            className="border-b border-outline-variant last:border-0"
          >
            <th
              scope="row"
              className={`${TD} text-left font-medium text-on-surface`}
            >
              {p.ticker}
              {p.inconsistent && <Inconsistent />}
            </th>
            <td className={`${TD} text-right`}>
              <Money value={p.realizedSwing} className="font-normal" />
            </td>
            <td className={`${TD} text-right`}>
              <Money value={p.realizedDayTrade} className="font-normal" />
            </td>
            <td className={`${TD} text-right`}>
              <Money value={p.realizedSwing + p.realizedDayTrade} />
            </td>
          </tr>
        ))}
      </tbody>
    </TableFrame>
  );
}

function TradesTable({ rows }: { rows: InvestmentTradeRow[] }) {
  return (
    <TableFrame
      title="Últimos negócios"
      caption="Últimos negócios importados, mais recentes primeiro"
      minWidth="min-w-[600px]"
    >
      <thead>
        <tr className="border-b border-outline-variant text-left text-xs text-on-surface-variant">
          <th scope="col" className={THC}>
            Pregão
          </th>
          <th scope="col" className={THC}>
            Ativo
          </th>
          <th scope="col" className={THC}>
            Operação
          </th>
          <th scope="col" className={`${THC} text-right`}>
            Qtd.
          </th>
          <th scope="col" className={`${THC} text-right`}>
            Preço
          </th>
          <th scope="col" className={`${THC} text-right`}>
            Valor
          </th>
          <th scope="col" className={`${THC} text-right`}>
            Custos
          </th>
          <th scope="col" className={THC}>
            Origem
          </th>
        </tr>
      </thead>
      <tbody className="tabular-nums">
        {rows.map((t) => (
          <tr
            key={t.id}
            className="border-b border-outline-variant last:border-0"
          >
            <td className={`${TDC} whitespace-nowrap text-on-surface-variant`}>
              {dayMonth(t.tradeDate)}
            </td>
            <td
              className={`${TDC} max-w-44 truncate font-medium text-on-surface`}
              title={t.ticker}
            >
              {t.ticker}
            </td>
            <td className={`${TDC} text-on-surface-variant`}>
              {t.side === "BUY" ? "Compra" : "Venda"}
            </td>
            <td className={`${TDC} text-right`}>{qty.format(t.quantity)}</td>
            <td className={`${TDC} text-right`}>{price.format(t.price)}</td>
            <td className={`${TDC} text-right`}>
              <Money
                value={t.grossAmount}
                tone="neutral"
                showSign={false}
                className="font-normal"
              />
            </td>
            <td className={`${TDC} text-right whitespace-nowrap`}>
              {t.hasNote ? (
                <Money
                  value={t.fees}
                  tone="neutral"
                  showSign={false}
                  className="font-normal"
                />
              ) : (
                <span className="text-xs text-warning-on-container">
                  sem nota
                </span>
              )}
            </td>
            <td
              className={`${TDC} max-w-32 truncate whitespace-nowrap text-xs text-on-surface-variant`}
              title={ORIGIN[t.source].title}
            >
              {ORIGIN[t.source].short}
              {t.broker && ` · ${t.broker}`}
            </td>
          </tr>
        ))}
      </tbody>
    </TableFrame>
  );
}
