export type ApiErrorKind = "network" | "http" | "parse" | "contract";

/**
 * API 客户端统一错误模型。
 */
export class ApiClientError extends Error {
  kind: ApiErrorKind;
  status: number | null;
  body: string | null;

  constructor(kind: ApiErrorKind, message: string, options?: { status?: number | null; body?: string | null }) {
    super(message);
    this.name = "ApiClientError";
    this.kind = kind;
    this.status = options?.status ?? null;
    this.body = options?.body ?? null;
  }
}

/**
 * 统一将未知异常归一化为 Error。
 */
export function normalizeError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  return new Error(String(error ?? "unknown error"));
}
