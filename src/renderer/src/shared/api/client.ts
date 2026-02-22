import type { ActionInvokeResponse, AppInfo, ContextTimelineItem, InteractionResponse, SessionInfo, WindowInfo } from "../../types";
import { requestJson, requestRaw } from "./http";
import { parseActionInvokeResponse, parseApps, parseContextTimeline, parseInteractionResponse, parseSession, parseSessions, parseWindows } from "./parsers";
import { asArray, asRecord } from "./runtime";

/**
 * 将 `/context` 的结构化时间线还原成便于阅读的文本上下文。
 */
function buildRawContextFromTimeline(raw: unknown): string {
  const lines: string[] = [];
  const timeline = asArray(raw);

  for (const item of timeline) {
    const entry = asRecord(item);
    const type = String(entry.type ?? "");
    const rawContent = String(entry.rawContent ?? "");

    if (type === "Window") {
      const windowRecord = asRecord(entry.window);
      const rendered = windowRecord.rendered;
      if (typeof rendered === "string" && rendered.length > 0) {
        lines.push(rendered);
      } else {
        lines.push(rawContent);
      }
    } else {
      lines.push(rawContent);
    }

    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

/**
 * ACI 前端 API 客户端。
 */
export const ACIApi = {
  async createSession(baseUrl: string): Promise<SessionInfo> {
    const raw = await requestJson(baseUrl, "/api/sessions/", { method: "POST" });
    return parseSession(raw, "createSession.response");
  },

  async getSessions(baseUrl: string): Promise<SessionInfo[]> {
    const raw = await requestJson(baseUrl, "/api/sessions/");
    return parseSessions(raw, "getSessions.response");
  },

  async closeSession(baseUrl: string, sessionId: string): Promise<void> {
    const raw = await requestRaw(baseUrl, `/api/sessions/${sessionId}`, {
      method: "DELETE"
    });

    if (!raw.ok && raw.status !== 204) {
      throw new Error(`Failed to close session (${raw.status}): ${raw.text}`);
    }
  },

  async interact(baseUrl: string, sessionId: string, agentId: string, message: string): Promise<InteractionResponse> {
    const raw = await requestJson(baseUrl, `/api/sessions/${sessionId}/agents/${agentId}/interact/`, {
      method: "POST",
      body: JSON.stringify({ message })
    });

    return parseInteractionResponse(raw, "interact.response");
  },

  async simulateAssistantOutput(
    baseUrl: string,
    sessionId: string,
    agentId: string,
    assistantOutput: string
  ): Promise<InteractionResponse> {
    const raw = await requestJson(baseUrl, `/api/sessions/${sessionId}/agents/${agentId}/interact/simulate`, {
      method: "POST",
      body: JSON.stringify({ assistantOutput })
    });

    return parseInteractionResponse(raw, "simulateAssistantOutput.response");
  },

  async getWindows(baseUrl: string, sessionId: string, agentId: string): Promise<WindowInfo[]> {
    const raw = await requestJson(baseUrl, `/api/sessions/${sessionId}/agents/${agentId}/windows/`);
    return parseWindows(raw, "getWindows.response");
  },

  async getApps(baseUrl: string, sessionId: string, agentId: string): Promise<AppInfo[]> {
    const raw = await requestJson(baseUrl, `/api/sessions/${sessionId}/agents/${agentId}/apps`);
    return parseApps(raw, "getApps.response");
  },

  async getRawContext(baseUrl: string, sessionId: string, agentId: string, includeObsolete: boolean): Promise<string> {
    const encoded = includeObsolete ? "true" : "false";
    const raw = await requestJson(baseUrl, `/api/sessions/${sessionId}/agents/${agentId}/context?includeObsolete=${encoded}`);
    return buildRawContextFromTimeline(raw);
  },

  async getRawLlmInput(baseUrl: string, sessionId: string, agentId: string): Promise<string> {
    const raw = await requestRaw(baseUrl, `/api/sessions/${sessionId}/agents/${agentId}/llm-input/raw`);

    if (!raw.ok) {
      throw new Error(`Failed to load raw llm input (${raw.status}): ${raw.text}`);
    }

    return raw.text ?? "";
  },

  async getContextTimeline(
    baseUrl: string,
    sessionId: string,
    agentId: string,
    includeObsolete: boolean
  ): Promise<ContextTimelineItem[]> {
    const encoded = includeObsolete ? "true" : "false";
    const raw = await requestJson(baseUrl, `/api/sessions/${sessionId}/agents/${agentId}/context?includeObsolete=${encoded}`);
    return parseContextTimeline(raw, "getContextTimeline.response");
  },

  async runWindowAction(
    baseUrl: string,
    sessionId: string,
    agentId: string,
    windowId: string,
    actionId: string,
    params: unknown
  ): Promise<ActionInvokeResponse> {
    const raw = await requestJson(
      baseUrl,
      `/api/sessions/${sessionId}/agents/${agentId}/windows/${windowId}/actions/${actionId}`,
      {
        method: "POST",
        body: JSON.stringify({ params })
      }
    );

    return parseActionInvokeResponse(raw, "runWindowAction.response");
  }
};
