import { formatBRL, formatDateLong, formatDateShort } from "@/lib/format";
import { getRisk, resolveMode } from "@/lib/queries/trading";
import { ModeSwitch } from "@/components/trading/mode-switch";
import { LimitsForm } from "@/components/trading/limits-form";
import { RiskPanel, type RiskBannerView, type RiskLimitView } from "@/components/trading/risk-panel";

export default async function TradingRiskPage({ searchParams }: { searchParams: Promise<{ modo?: string }> }) {
  const { modo } = await searchParams;
  const mode = resolveMode(modo);
  const { snapshot: s, limits } = await getRisk(mode);
  const anySet = s.day.state !== "unset" || s.month.state !== "unset" || s.trades.state !== "unset";
  const modeLabel = mode === "real" ? "real" : "simulado";

  const reasons: string[] = [];
  if (s.day.state === "reached") reasons.push("a perda do dia chegou ao limite");
  if (s.trades.state === "reached") reasons.push("o número de entradas do dia chegou ao máximo");
  if (s.month.state === "reached") reasons.push("a perda do mês chegou ao limite");
  if (s.pause.active && s.pauseUntil)
    reasons.push(`há pausa até ${formatDateShort(s.pauseUntil)} porque o limite mensal foi batido em ${formatDateShort(s.monthHitOn!)}`);

  const banner: RiskBannerView = s.entriesBlocked
    ? {
        status: "error",
        title: "Novas entradas bloqueadas",
        description: `O b3-risco recusa novas entradas: ${reasons.join("; ")}. Saídas nunca são bloqueadas.`,
      }
    : anySet
      ? {
          status: "info",
          title: "Dentro dos limites pelo diário",
          description:
            "Nenhum limite visível aqui foi atingido. O b3-risco ainda soma o risco das posições abertas antes de aprovar. Saídas nunca são bloqueadas.",
        }
      : {
          status: "warning",
          title: "Limites não configurados",
          description:
            "Preencha os limites abaixo com os números do seu config.json para acompanhar o dia. Saídas nunca são bloqueadas.",
        };

  const formatCount = (n: number) => new Intl.NumberFormat("pt-BR").format(n);
  const limitViews: RiskLimitView[] = [
    {
      label: "Perda realizada no dia",
      used: s.lossesToday.toNumber(),
      usedText: formatBRL(s.lossesToday.toNumber()),
      limit: limits.maxLossDay,
      limitText: limits.maxLossDay === null ? "sem limite" : formatBRL(limits.maxLossDay),
      reached: s.day.state === "reached",
      roomText: s.day.room ? `folga de ${formatBRL(s.day.room.toNumber())}` : null,
    },
    {
      label: "Entradas hoje",
      used: s.entriesToday,
      usedText: formatCount(s.entriesToday),
      limit: limits.maxTradesDay,
      limitText: limits.maxTradesDay === null ? "sem limite" : formatCount(limits.maxTradesDay),
      reached: s.trades.state === "reached",
      roomText: s.trades.room !== null ? (s.trades.room === 1 ? "resta 1" : `restam ${s.trades.room}`) : null,
    },
    {
      label: "Perda no mês",
      used: Math.max(-s.monthResult.toNumber(), 0),
      usedText: formatBRL(Math.max(-s.monthResult.toNumber(), 0)),
      limit: limits.maxLossMonth,
      limitText: limits.maxLossMonth === null ? "sem limite" : formatBRL(limits.maxLossMonth),
      reached: s.month.state === "reached",
      roomText: s.month.room ? `folga de ${formatBRL(s.month.room.toNumber())}` : null,
      note: `resultado do mês: ${formatBRL(s.monthResult.toNumber())}`,
    },
  ];
  const pause = {
    active: s.pause.active,
    text: s.pause.active && s.pauseUntil ? `ativa até ${formatDateShort(s.pauseUntil)}` : "sem pausa",
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-on-surface">Risco de hoje</h1>
          <p className="text-sm text-on-surface-variant">
            {formatDateLong(s.today)} · modo {modeLabel}
          </p>
        </div>
        <ModeSwitch current={mode} />
      </div>

      <RiskPanel banner={banner} limits={limitViews} pause={pause} />

      <section aria-labelledby="config" className="space-y-3">
        <div>
          <h2 id="config" className="text-sm font-medium text-on-surface">
            Configurar limites
          </h2>
          <p className="max-w-prose text-sm text-on-surface-variant">
            Ficam só no banco do app e servem para este painel. A regra que vale é a do config.json do trader-b3.
          </p>
        </div>
        <LimitsForm key={JSON.stringify(limits)} limits={limits} />
      </section>
    </div>
  );
}
