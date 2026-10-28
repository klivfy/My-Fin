import { CheckCircle2, Flag, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { GoalDialog } from "@/components/goals/goal-dialog";
import { GoalActions } from "@/components/goals/goal-actions";
import { formatBRL, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { GoalsData, GoalView } from "@/lib/queries/goals";

const monthYear = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(iso));

const STATUS: Record<GoalView["status"], { label: string; className: string } | null> = {
  DONE: { label: "Concluída", className: "bg-income-container text-income-on-container" },
  ON_TRACK: { label: "No prazo", className: "bg-income-container text-income-on-container" },
  AT_RISK: { label: "Prazo apertado", className: "bg-expense-container text-expense-on-container" },
  NO_SURPLUS: { label: "Sem sobra", className: "bg-expense-container text-expense-on-container" },
  NO_DEADLINE: null,
};

/** Metas de poupança dimensionadas pela sobra real, com marcos de 25/50/75/100%. */
export function GoalsSection({ data }: { data: GoalsData }) {
  const { surplus, emergencyFund, goals, linkableAccounts } = data;
  const contribution = surplus?.contribution ?? 0;

  const emptyGoal = { name: "", targetAmount: "", targetDate: "", accountId: null };
  const emergencyGoal = emergencyFund
    ? { ...emptyGoal, name: "Reserva de emergência", targetAmount: emergencyFund.amount.toFixed(2).replace(".", ",") }
    : emptyGoal;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-on-surface">Metas de poupança</h2>
        <GoalDialog
          initial={goals.length === 0 ? emergencyGoal : emptyGoal}
          accounts={linkableAccounts}
          trigger={
            <Button size="sm" variant="outline" className="gap-1.5">
              <Plus className="size-4" />
              Nova meta
            </Button>
          }
        />
      </div>

      <Card>
        <CardContent className="space-y-1 text-sm">
          {surplus ? (
            <>
              <p className="text-on-surface">
                Sua sobra real: <span className="font-medium">{formatBRL(surplus.average)}/mês</span>
                <span className="text-xs text-on-surface-variant">
                  {" "}
                  (média de {surplus.monthLabels.join(", ")}; pior mês {formatBRL(surplus.worst)})
                </span>
              </p>
              {contribution > 0 ? (
                <p className="text-xs text-on-surface-variant">
                  Aporte sugerido: <span className="font-medium text-on-surface">{formatBRL(contribution)}/mês</span> —{" "}
                  {formatPercent(surplus.contributionShare, 0)} da sobra, deixando folga para meses mais apertados.
                </p>
              ) : (
                <p className="text-xs text-expense">
                  Sem sobra nos últimos meses: antes de uma meta, veja os cortes sugeridos na regra 50/30/20 acima.
                </p>
              )}
              {emergencyFund && goals.length === 0 && (
                <p className="text-xs text-on-surface-variant">
                  Comece pela reserva de emergência: {emergencyFund.months} meses de{" "}
                  {emergencyFund.basedOn === "NEED" ? "Necessidades" : "gastos (marque as Necessidades em Revisar para refinar)"}{" "}
                  ≈ <span className="font-medium text-on-surface">{formatBRL(emergencyFund.amount)}</span>. O botão “Nova meta”
                  já vem preenchido.
                </p>
              )}
            </>
          ) : (
            <p className="text-xs text-on-surface-variant">
              Ainda não há um mês completo de extrato para medir sua sobra real. Importe pelo menos dois meses para o app
              sugerir metas e aportes.
            </p>
          )}
        </CardContent>
      </Card>

      {goals.length > 0 && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {goals.map((goal) => (
            <GoalCard key={goal.id} goal={goal} contribution={contribution} accounts={linkableAccounts} />
          ))}
        </div>
      )}
    </section>
  );
}

function GoalCard({
  goal,
  contribution,
  accounts,
}: {
  goal: GoalView;
  contribution: number;
  accounts: GoalsData["linkableAccounts"];
}) {
  const status = STATUS[goal.status];
  const nextMilestone = goal.milestones.find((ms) => !ms.reached);

  return (
    <Card>
      <CardHeader>
        <div className="min-w-0 space-y-0.5">
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <span className="truncate" title={goal.name}>
              {goal.name}
            </span>
            {status && (
              <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium", status.className)}>
                {status.label}
              </span>
            )}
          </CardTitle>
          <p className="text-xs text-on-surface-variant">
            {goal.accountName ? `Saldo da conta ${goal.accountName}` : "Aportes registrados"}
            {goal.targetDate && ` · até ${monthYear(goal.targetDate)}`}
          </p>
        </div>
        <CardAction>
          <GoalActions
            goal={{
              id: goal.id,
              name: goal.name,
              targetAmount: goal.target.toFixed(2).replace(".", ","),
              targetDate: goal.targetDate?.slice(0, 10) ?? "",
              accountId: goal.accountId,
            }}
            accounts={accounts}
            suggestedContribution={contribution}
          />
        </CardAction>
      </CardHeader>

      <CardContent className="space-y-3">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-lg font-semibold tabular-nums text-on-surface">{formatBRL(goal.saved)}</span>
          <span className="text-xs text-on-surface-variant">
            de {formatBRL(goal.target)} · {formatPercent(goal.progress, 0)}
          </span>
        </div>

        {/* Barra com marcos de 25/50/75%. */}
        <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-surface-container-highest">
          <div className="h-full rounded-full bg-income" style={{ width: `${goal.progress * 100}%` }} />
          {goal.milestones
            .filter((ms) => ms.fraction < 1)
            .map((ms) => (
              <div
                key={ms.fraction}
                className="absolute top-0 h-full w-0.5 bg-surface"
                style={{ left: `${ms.fraction * 100}%` }}
              />
            ))}
        </div>

        <ol className="grid grid-cols-4 gap-1 text-center">
          {goal.milestones.map((ms) => (
            <li key={ms.fraction} className="space-y-0.5">
              <p
                className={cn(
                  "flex items-center justify-center gap-1 text-xs font-medium",
                  ms.reached ? "text-income" : "text-on-surface-variant",
                )}
              >
                {ms.reached ? <CheckCircle2 className="size-3" /> : <Flag className="size-3" />}
                {formatPercent(ms.fraction, 0)}
              </p>
              <p className="text-[10px] tabular-nums text-on-surface-variant">{formatBRL(ms.amount)}</p>
              <p className="text-[10px] text-on-surface-variant">
                {ms.reached ? "atingido" : ms.projectedDate ? monthYear(ms.projectedDate) : "—"}
              </p>
            </li>
          ))}
        </ol>

        <GoalAdvice goal={goal} contribution={contribution} nextMilestoneAmount={nextMilestone?.amount ?? null} />
      </CardContent>
    </Card>
  );
}

function GoalAdvice({
  goal,
  contribution,
  nextMilestoneAmount,
}: {
  goal: GoalView;
  contribution: number;
  nextMilestoneAmount: number | null;
}) {
  if (goal.status === "DONE") {
    return <p className="text-xs text-income">Meta atingida. Hora de definir a próxima!</p>;
  }
  if (goal.status === "NO_SURPLUS") {
    return (
      <p className="text-xs text-expense">
        Sem sobra para aportar agora{goal.requiredMonthly !== null && ` (o prazo pede ${formatBRL(goal.requiredMonthly)}/mês)`}.
        Os cortes da regra 50/30/20 são o primeiro passo.
      </p>
    );
  }
  return (
    <div className="space-y-0.5 text-xs text-on-surface-variant">
      <p>
        Guardando {formatBRL(contribution)}/mês, conclui em{" "}
        <span className="font-medium text-on-surface">{goal.projectedDate ? monthYear(goal.projectedDate) : "—"}</span>
        {nextMilestoneAmount !== null && ` · próximo marco: ${formatBRL(nextMilestoneAmount)}`}.
      </p>
      {goal.status === "AT_RISK" && goal.requiredMonthly !== null && (
        <p className="text-expense">
          Para chegar até {monthYear(goal.targetDate!)} seriam {formatBRL(goal.requiredMonthly)}/mês — acima do aporte
          sugerido. Estenda o prazo ou reduza Desejos.
        </p>
      )}
      {goal.status === "ON_TRACK" && goal.requiredMonthly !== null && (
        <p>Cumpre o prazo com {formatBRL(goal.requiredMonthly)}/mês.</p>
      )}
    </div>
  );
}
