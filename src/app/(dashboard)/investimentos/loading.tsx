import { Skeleton } from "@/components/ui/skeleton";

/** Esqueleto no mesmo desenho da Carteira: nada pula quando os dados chegam. */
export default function InvestmentsLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Carregando a carteira">
      <div className="space-y-2">
        <Skeleton className="h-6 w-28" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-x-6 gap-y-5 rounded-xl border border-outline-variant bg-surface-container-lowest p-5 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-7 w-24" />
              </div>
            ))}
          </div>
          <div className="space-y-2">
            <Skeleton className="h-4 w-28" />
            <div className="space-y-3 rounded-xl border border-outline-variant bg-surface-container-lowest p-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-5 w-full" />
              ))}
            </div>
          </div>
        </div>
        <div className="space-y-4 rounded-xl border border-outline-variant bg-surface-container-lowest p-5">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-9 w-44" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
