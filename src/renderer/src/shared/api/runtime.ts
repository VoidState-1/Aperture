import { ApiClientError } from "./errors";

export function asRecord(input: unknown): Record<string, unknown> {
  if (input !== null && typeof input === "object" && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }

  return {};
}

export function asArray(input: unknown): unknown[] {
  return Array.isArray(input) ? input : [];
}

export function toInt(input: unknown): number {
  if (typeof input === "number" && Number.isFinite(input)) {
    return Math.trunc(input);
  }

  if (typeof input === "string") {
    const parsed = Number.parseInt(input, 10);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  return 0;
}

export function toBool(input: unknown): boolean {
  return input === true;
}

export function toDate(input: unknown): Date | null {
  if (typeof input !== "string" || input.trim().length === 0) {
    return null;
  }

  const parsed = new Date(input);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * 校验并提取必填字符串字段。
 */
export function requireString(data: Record<string, unknown>, key: string, path: string): string {
  const value = data[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ApiClientError("contract", `Invalid API contract at ${path}.${key}: expected non-empty string.`);
  }

  return value;
}

/**
 * 校验根节点是否为对象。
 */
export function requireRecord(input: unknown, path: string): Record<string, unknown> {
  if (input !== null && typeof input === "object" && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }

  throw new ApiClientError("contract", `Invalid API contract at ${path}: expected object.`);
}

/**
 * 校验根节点是否为数组。
 */
export function requireArray(input: unknown, path: string): unknown[] {
  if (Array.isArray(input)) {
    return input;
  }

  throw new ApiClientError("contract", `Invalid API contract at ${path}: expected array.`);
}
