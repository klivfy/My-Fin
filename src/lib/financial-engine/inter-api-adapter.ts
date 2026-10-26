import Decimal from "decimal.js";
import type { DateRange, FinancialAdapter, NormalizedTransaction } from "./financial-adapter";
import { normalizeDescription } from "./reconciliation";
import { DomainError } from "@/lib/errors";

/**
 * Adapter da API do Banco Inter (Open Finance / PJ).
 *
 * Autenticação: OAuth2 client_credentials + mTLS (certificado de cliente).
 * O certificado e a chave chegam via variáveis de ambiente em Base64
 * (INTER_CERT_BASE64 / INTER_KEY_BASE64) — nunca em texto puro.
 *
 * O cliente HTTP é injetável (`InterHttpClient`) para permitir testes com
 * fixtures sem rede; em produção, injete uma implementação que use
 * `https.Agent({ cert, key })` (mTLS exigido pelo banco).
 */

/** Resposta crua da API do Inter (subset dos campos usados). */
export interface InterTransactionPayload {
  transactions?: Array<{
    dataTransacao?: string;
    valor?: string | number;
    descricao?: string;
    tipoTransacao?: string;
    idTransacao?: string;
  }>;
}

export interface InterHttpClient {
  /** POST no endpoint de token; retorna o access_token. */
  fetchToken(input: {
    clientId: string;
    clientSecret: string;
    cert: Buffer;
    key: Buffer;
  }): Promise<string>;
  /** GET paginado no endpoint de extrato. */
  fetchTransactionsPage(input: {
    accessToken: string;
    cert: Buffer;
    key: Buffer;
    from: string; // ISO date (yyyy-mm-dd)
    to: string;
    page: number;
  }): Promise<InterTransactionPayload>;
}

export class InterApiAdapter implements FinancialAdapter {
  readonly source = "INTER_API" as const;

  constructor(private readonly httpClient?: InterHttpClient) {}

  private get clientId() {
    return process.env.INTER_CLIENT_ID;
  }
  private get clientSecret() {
    return process.env.INTER_CLIENT_SECRET;
  }
  private get certBase64() {
    return process.env.INTER_CERT_BASE64;
  }
  private get keyBase64() {
    return process.env.INTER_KEY_BASE64;
  }

  private loadMtlsMaterial(): { cert: Buffer; key: Buffer } {
    if (!this.certBase64 || !this.keyBase64) {
      throw new DomainError(
        "INTER_CERT_BASE64/INTER_KEY_BASE64 não configurados. Consulte .env.example.",
      );
    }
    return {
      cert: Buffer.from(this.certBase64, "base64"),
      key: Buffer.from(this.keyBase64, "base64"),
    };
  }

  parsePayload(data: unknown): unknown[] {
    if (!data || typeof data !== "object") return [];
    const payload = data as InterTransactionPayload;
    return payload.transactions ?? [];
  }

  normalize(raw: unknown): NormalizedTransaction {
    const record = raw as NonNullable<InterTransactionPayload["transactions"]>[number];
    if (!record.dataTransacao || record.valor === undefined) {
      throw new Error("Registro da API do Inter inválido: dataTransacao/valor ausentes.");
    }
    const amount = new Decimal(String(record.valor));
    const signed = record.tipoTransacao === "DEBITO" ? amount.abs().negated() : amount.abs();
    return {
      date: new Date(`${record.dataTransacao}T00:00:00.000Z`),
      amount: signed,
      description: normalizeDescription(record.descricao ?? ""),
      originalDescription: record.descricao ?? "",
      fitId: record.idTransacao,
    };
  }

  async fetchTransactions(range: DateRange): Promise<NormalizedTransaction[]> {
    if (!this.clientId || !this.clientSecret) {
      throw new DomainError(
        "INTER_CLIENT_ID/INTER_CLIENT_SECRET não configurados. Consulte .env.example.",
      );
    }
    const { cert, key } = this.loadMtlsMaterial();

    if (!this.httpClient) {
      throw new DomainError(
        "Cliente HTTP do InterApiAdapter não configurado neste ambiente " +
          "(a integração real exige agente mTLS — injete um InterHttpClient).",
      );
    }

    const accessToken = await this.httpClient.fetchToken({
      clientId: this.clientId,
      clientSecret: this.clientSecret,
      cert,
      key,
    });

    const from = range.from.toISOString().slice(0, 10);
    const to = range.to.toISOString().slice(0, 10);

    const all: NormalizedTransaction[] = [];
    // Paginação defensiva: para quando a página vem vazia, quando vem menor
    // que o tamanho padrão (100) ou no teto de 100 páginas (proteção contra
    // loop infinito em resposta malformada).
    for (let page = 0; page < 100; page += 1) {
      const payload = await this.httpClient.fetchTransactionsPage({
        accessToken,
        cert,
        key,
        from,
        to,
        page,
      });
      const records = this.parsePayload(payload);
      if (records.length === 0) break;
      for (const record of records) all.push(this.normalize(record));
      if (records.length < 100) break;
    }
    return all;
  }
}
