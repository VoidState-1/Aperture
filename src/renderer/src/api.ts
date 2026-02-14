import type {
  AgentInfo,
  ActionInfo,
  ActionInvokeResponse,
  ActionParamKind,
  ActionParamSchema,
  ActionResultInfo,
  AppInfo,
  ContextTimelineItem,
  InteractionStepInfo,
  InteractionResponse,
  SessionInfo,
  TokenUsage,
  WindowAction,
  WindowInfo
} from "./types";

function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  if (trimmed.length === 0) {
    return "http://localhost:5000";
  }

  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

function asRecord(input: unknown): Record<string, unknown> {
  if (input !== null && typeof input === "object" && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }

  return {};
}

function asArray(input: unknown): unknown[] {
  return Array.isArray(input) ? input : [];
}

function toInt(input: unknown): number {
  if (typeof input === "number" && Number.isFinite(input)) {
    return Math.trunc(input);
  }

  if (typeof input === "string") {
    const parsed = Number.parseInt(input, 10);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  return 0;
}

function toBool(input: unknown): boolean {
  return input === true;
}

function toDate(input: unknown): Date | null {
  if (typeof input !== "string" || input.trim().length === 0) {
    return null;
  }

  const parsed = new Date(input);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function decodeJsonOrThrow(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const trimmed = text.trimStart();
    const snippet = trimmed.slice(0, 800);
    const looksLikeHtml =
      snippet.startsWith("<!DOCTYPE html") || snippet.startsWith("<html");
    const hint = looksLikeHtml
      ? 'It looks like HTML. "Server URL" likely points to a website, not ACI backend.'
      : "Server URL may be incorrect, or backend returned non-JSON output.";

    throw new Error(
      `Failed to parse API response as JSON. ${hint} Raw response: ${snippet}`
    );
  }
}

async function requestRaw(
  baseUrl: string,
  path: string,
  init?: RequestInit
): Promise<{ ok: boolean; status: number; text: string }> {
  const response = await fetch(`${normalizeBaseUrl(baseUrl)}${path}`, {
    ...init,
    headers: {
      Accept: "application/json, text/plain;q=0.9, */*;q=0.8",
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    }
  });

  const text = await response.text();
  return { ok: response.ok, status: response.status, text };
}

async function requestJson(
  baseUrl: string,
  path: string,
  init?: RequestInit
): Promise<unknown> {
  const raw = await requestRaw(baseUrl, path, init);
  const parsed = decodeJsonOrThrow(raw.text);

  if (!raw.ok) {
    throw new Error(
      `HTTP ${raw.status}: ${
        typeof parsed === "string" ? parsed : JSON.stringify(parsed)
      }`
    );
  }

  return parsed;
}

function parseParamKind(raw: unknown): ActionParamKind {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    switch (Math.trunc(raw)) {
      case 0:
        return "string";
      case 1:
        return "integer";
      case 2:
        return "number";
      case 3:
        return "boolean";
      case 4:
        return "null";
      case 5:
        return "object";
      case 6:
        return "array";
      default:
        return "unknown";
    }
  }

  const lowered = String(raw ?? "").trim().toLowerCase();
  if (lowered === "string") return "string";
  if (lowered === "integer" || lowered === "int") return "integer";
  if (lowered === "number" || lowered === "float" || lowered === "double") return "number";
  if (lowered === "boolean" || lowered === "bool") return "boolean";
  if (lowered === "null") return "null";
  if (lowered === "object") return "object";
  if (lowered === "array") return "array";
  return "unknown";
}

function parseActionParamSchema(raw: unknown): ActionParamSchema {
  const data = asRecord(raw);
  const parsedProperties: Record<string, ActionParamSchema> = {};
  const properties = asRecord(data.properties);
  for (const [name, node] of Object.entries(properties)) {
    parsedProperties[name] = parseActionParamSchema(node);
  }

  return {
    kind: parseParamKind(data.kind),
    required: data.required == null ? true : toBool(data.required),
    description: data.description == null ? null : String(data.description),
    items: data.items == null ? null : parseActionParamSchema(data.items),
    properties: parsedProperties,
    defaultValue: data.default
  };
}

function parseWindowAction(raw: unknown): WindowAction {
  const data = asRecord(raw);
  return {
    id: String(data.id ?? ""),
    label: String(data.label ?? ""),
    paramSchema: data.paramSchema == null ? null : parseActionParamSchema(data.paramSchema)
  };
}

function parseWindow(raw: unknown): WindowInfo {
  const data = asRecord(raw);
  return {
    id: String(data.id ?? ""),
    description: data.description == null ? null : String(data.description),
    content: String(data.content ?? ""),
    appName: data.appName == null ? null : String(data.appName),
    createdAt: toInt(data.createdAt),
    updatedAt: toInt(data.updatedAt),
    actions: asArray(data.actions).map(parseWindowAction)
  };
}

function parseActionInfo(raw: unknown): ActionInfo {
  const data = asRecord(raw);
  return {
    type: data.type == null ? null : String(data.type),
    appName: data.appName == null ? null : String(data.appName),
    windowId: data.windowId == null ? null : String(data.windowId),
    actionId: data.actionId == null ? null : String(data.actionId)
  };
}

function parseActionResultInfo(raw: unknown): ActionResultInfo {
  const data = asRecord(raw);
  return {
    success: toBool(data.success),
    message: data.message == null ? null : String(data.message),
    summary: data.summary == null ? null : String(data.summary)
  };
}

function parseUsage(raw: unknown): TokenUsage {
  const data = asRecord(raw);
  return {
    promptTokens: toInt(data.promptTokens),
    completionTokens: toInt(data.completionTokens),
    totalTokens: toInt(data.totalTokens)
  };
}

function parseInteractionStepInfo(raw: unknown): InteractionStepInfo {
  const data = asRecord(raw);
  return {
    callId: String(data.callId ?? ""),
    windowId: String(data.windowId ?? ""),
    actionId: String(data.actionId ?? ""),
    resolvedMode: String(data.resolvedMode ?? ""),
    success: toBool(data.success),
    message: data.message == null ? null : String(data.message),
    summary: data.summary == null ? null : String(data.summary),
    taskId: data.taskId == null ? null : String(data.taskId),
    turn: toInt(data.turn),
    index: toInt(data.index)
  };
}

function parseInteractionResponse(raw: unknown): InteractionResponse {
  const data = asRecord(raw);
  return {
    success: toBool(data.success),
    error: data.error == null ? null : String(data.error),
    response: data.response == null ? null : String(data.response),
    action: data.action == null ? null : parseActionInfo(data.action),
    actionResult:
      data.actionResult == null ? null : parseActionResultInfo(data.actionResult),
    steps: data.steps == null ? null : asArray(data.steps).map(parseInteractionStepInfo),
    usage: data.usage == null ? null : parseUsage(data.usage)
  };
}

function parseAgent(raw: unknown): AgentInfo {
  const data = asRecord(raw);
  return {
    agentId: String(data.agentId ?? ""),
    name: data.name == null ? null : String(data.name),
    role: data.role == null ? null : String(data.role)
  };
}

function parseSession(raw: unknown): SessionInfo {
  const data = asRecord(raw);
  const agents = asArray(data.agents).map(parseAgent);
  return {
    sessionId: String(data.sessionId ?? ""),
    createdAt: toDate(data.createdAt),
    agentCount: toInt(data.agentCount),
    agents
  };
}

export const ACIApi = {
  async createSession(baseUrl: string): Promise<SessionInfo> {
    const raw = await requestJson(baseUrl, "/api/sessions/", { method: "POST" });
    return parseSession(raw);
  },

  async getSessions(baseUrl: string): Promise<SessionInfo[]> {
    const raw = await requestJson(baseUrl, "/api/sessions/");
    return asArray(raw).map(parseSession);
  },

  async closeSession(baseUrl: string, sessionId: string): Promise<void> {
    const raw = await requestRaw(baseUrl, `/api/sessions/${sessionId}`, {
      method: "DELETE"
    });
    if (!raw.ok && raw.status !== 204) {
      throw new Error(`Failed to close session (${raw.status}): ${raw.text}`);
    }
  },

  async interact(
    baseUrl: string,
    sessionId: string,
    agentId: string,
    message: string
  ): Promise<InteractionResponse> {
    const raw = await requestJson(
      baseUrl,
      `/api/sessions/${sessionId}/agents/${agentId}/interact/`,
      {
        method: "POST",
        body: JSON.stringify({ message })
      }
    );
    return parseInteractionResponse(raw);
  },

  async simulateAssistantOutput(
    baseUrl: string,
    sessionId: string,
    agentId: string,
    assistantOutput: string
  ): Promise<InteractionResponse> {
    const raw = await requestJson(
      baseUrl,
      `/api/sessions/${sessionId}/agents/${agentId}/interact/simulate`,
      {
        method: "POST",
        body: JSON.stringify({ assistantOutput })
      }
    );
    return parseInteractionResponse(raw);
  },

  async getWindows(baseUrl: string, sessionId: string, agentId: string): Promise<WindowInfo[]> {
    const raw = await requestJson(baseUrl, `/api/sessions/${sessionId}/agents/${agentId}/windows/`);
    return asArray(raw).map(parseWindow);
  },

  async getApps(baseUrl: string, sessionId: string, agentId: string): Promise<AppInfo[]> {
    const raw = await requestJson(baseUrl, `/api/sessions/${sessionId}/agents/${agentId}/apps`);
    return asArray(raw).map((item) => {
      const data = asRecord(item);
      return {
        name: String(data.name ?? ""),
        description: data.description == null ? null : String(data.description),
        tags: asArray(data.tags).map((tag) => String(tag)),
        isStarted: toBool(data.isStarted)
      };
    });
  },

  async getRawContext(
    baseUrl: string,
    sessionId: string,
    agentId: string,
    includeObsolete: boolean
  ): Promise<string> {
    const encoded = includeObsolete ? "true" : "false";
    const raw = await requestRaw(
      baseUrl,
      `/api/sessions/${sessionId}/agents/${agentId}/context/raw?includeObsolete=${encoded}`
    );
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
    const raw = await requestJson(
      baseUrl,
      `/api/sessions/${sessionId}/agents/${agentId}/context?includeObsolete=${encoded}`
    );

    return asArray(raw).map((item) => {
      const data = asRecord(item);
      return {
        id: String(data.id ?? ""),
        type: String(data.type ?? ""),
        seq: toInt(data.seq),
        isObsolete: toBool(data.isObsolete),
        rawContent: String(data.rawContent ?? ""),
        estimatedTokens: toInt(data.estimatedTokens)
      };
    });
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

    const data = asRecord(raw);
    return {
      success: toBool(data.success),
      message: data.message == null ? null : String(data.message),
      summary: data.summary == null ? null : String(data.summary)
    };
  }
};
