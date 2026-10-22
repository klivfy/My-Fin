import { CheckCheck } from "lucide-react";
import { getReviewData, REVIEW_PAGE_SIZE } from "@/lib/queries/categorization";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/dashboard/empty-state";
import { AiCategorizeButton } from "@/components/review/ai-categorize-button";
import { ReviewRow } from "@/components/review/review-row";
import { CategoryNatureList } from "@/components/review/category-nature-list";
import { RulesList } from "@/components/review/rules-list";

export default async function ReviewPage() {
  const { pendingCount, pending, categories, rules, aiEnabled } = await getReviewData();

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-on-surface">Revisar categorias</h1>
          <p className="text-sm text-on-surface-variant">
            {pendingCount} transação(ões) sem categoria.
            {pendingCount > REVIEW_PAGE_SIZE && ` Mostrando as ${REVIEW_PAGE_SIZE} mais recentes.`}
          </p>
        </div>
        <AiCategorizeButton enabled={aiEnabled} pendingCount={pendingCount} />
      </div>

      {pending.length === 0 ? (
        <EmptyState
          icon={CheckCheck}
          title="Tudo categorizado"
          description="Novas importações passam primeiro pelas suas regras; o que sobrar aparece aqui."
        />
      ) : (
        <ul className="space-y-3">
          {pending.map((transaction) => (
            <ReviewRow key={transaction.id} transaction={transaction} categories={categories} />
          ))}
        </ul>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Natureza das despesas (50/30/20)</CardTitle>
          </CardHeader>
          <CardContent>
            <CategoryNatureList categories={categories} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Regras automáticas</CardTitle>
          </CardHeader>
          <CardContent>
            <RulesList rules={rules} />
          </CardContent>
        </Card>
      </div>

      <p className="text-xs text-on-surface-variant">
        A IA recebe só data, valor e a descrição com números longos e e-mails mascarados. Ferramenta
        educativa — não substitui aconselhamento financeiro.
      </p>
    </div>
  );
}
