import type { ActionInvokeResponse, AppInfo, ContextTimelineItem, InteractionResponse, SessionInfo, WindowInfo } from "../../types";
import { requestJson, requestRaw } from "./http";
import { parseActionInvokeResponse, parseApps, parseContextTimeline, parseInteractionResponse, parseSession, parseSessions, parseWindows } from "./parsers";

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
    const raw = await requestRaw(baseUrl, `/api/sessions/${sessionId}/agents/${agentId}/context/raw?includeObsolete=${encoded}`);

    if (!raw.ok) {
      throw new Error(`Failed to load raw context (${raw.status}): ${raw.text}`);
    }

    return raw.text ?? "";
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
