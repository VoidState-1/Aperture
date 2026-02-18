import { ApiClientError } from "./errors";

export interface RawResponse {
  ok: boolean;
  status: number;
  text: string;
}

/**
 * 规范化服务地址。
 */
export function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  if (trimmed.length === 0) {
    return "http://localhost:5228";
  }

  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

/**
 * 发送原始 HTTP 请求。
 */
export async function requestRaw(baseUrl: string, path: string, init?: RequestInit): Promise<RawResponse> {
  try {
    const response = await fetch(`${normalizeBaseUrl(baseUrl)}${path}`, {
      ...init,
      headers: {
        Accept: "application/json, text/plain;q=0.9, */*;q=0.8",
        "Content-Type": "application/json",
        ...(init?.headers ?? {})
      }
    });

    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      text
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ApiClientError("network", `Network request failed: ${message}`);
  }
}

/**
 * 将文本解析为 JSON。
 */
export function parseJsonOrThrow(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const trimmed = text.trimStart();
    const snippet = trimmed.slice(0, 800);
    const looksLikeHtml = snippet.startsWith("<!DOCTYPE html") || snippet.startsWith("<html");
    const hint = looksLikeHtml
      ? 'It looks like HTML. "Server URL" likely points to a website, not ACI backend.'
      : "Server URL may be incorrect, or backend returned non-JSON output.";

    throw new ApiClientError("parse", `Failed to parse API response as JSON. ${hint} Raw response: ${snippet}`);
  }
}

/**
 * 请求并返回 JSON，自动处理 HTTP 错误。
 */
export async function requestJson(baseUrl: string, path: string, init?: RequestInit): Promise<unknown> {
  const raw = await requestRaw(baseUrl, path, init);
  const parsed = parseJsonOrThrow(raw.text);

  if (!raw.ok) {
    const body = typeof parsed === "string" ? parsed : JSON.stringify(parsed);
    throw new ApiClientError("http", `HTTP ${raw.status}: ${body}`, {
      status: raw.status,
      body
    });
  }

  return parsed;
}
