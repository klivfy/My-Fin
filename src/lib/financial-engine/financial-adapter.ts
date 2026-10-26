import Decimal from "decimal.js";

/**
 * Formato canônico ao qual todo adapter de ingestão deve normalizar seus
 * dados, independentemente da fonte (arquivo OFX, API do banco, gerador
 * mock). É o único formato que atravessa a fronteira entre
 * `financial-engine` e o restante da aplicação (Server Actions).
 */
export interface NormalizedTransaction {
  date: Date;
  /** Assinado: positivo = crédito, negativo = débito. Sempre Decimal. */
  amount: Decimal;
  /** Descrição já normalizada (maiúsculas, espaços colapsados, sem ruído). */
  description: string;
  /** Descrição bruta, exatamente como veio da fonte — preservada para auditoria. */
  originalDescription: string;
  /** Identificador único da transação na fonte (FITID do OFX, id da API). */
  fitId?: string;
}

export interface DateRange {
  from: Date;
  to: Date;
}

/**
 * Contrato que toda fonte de dados financeiros deve implementar. Cada
 * adapter é responsável por saber buscar/ler seus dados brutos, interpretar
 * o payload específico do seu formato e normalizá-lo — a deduplicação
 * (reconciliation.ts) e a persistência (Server Actions) são
 * responsabilidade de outra camada, nunca do adapter.
 */
export interface FinancialAdapter {
  /** Identifica a fonte para logs e para `SyncLog.provider`. */
  readonly source: "OFX_IMPORT" | "CSV_IMPORT" | "INTER_API" | "MOCK";

  /**
   * Ponto de entrada de alto nível: obtém e normaliza as transações do
   * período informado. Para adapters orientados a arquivo (OFX), filtra o
   * conteúdo já carregado pelo intervalo; para adapters de API (Inter),
   * dispara a chamada real; para o Mock, gera dados sintéticos no intervalo.
   */
  fetchTransactions(range: DateRange): Promise<NormalizedTransaction[]>;

  /** Interpreta o payload bruto da fonte (string/Buffer/JSON) em registros crus. */
  parsePayload(data: unknown): unknown[];

  /** Converte um único registro cru (já parseado) para o formato comum. */
  normalize(raw: unknown): NormalizedTransaction;
}
