import type {
  AgentInfo,
  ActionInfo,
  ActionInvokeResponse,
  ActionParamKind,
  ActionParamSchema,
  ActionResultInfo,
  AppInfo,
  ContextTimelineItem,
  InteractionResponse,
  InteractionStepInfo,
  SessionInfo,
  TokenUsage,
  WindowAction,
  WindowInfo
} from "../../types";
import { asArray, asRecord, requireArray, requireRecord, requireString, toBool, toDate, toInt } from "./runtime";

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

export function parseSession(raw: unknown, path: string): SessionInfo {
  const data = requireRecord(raw, path);
  const agentsRaw = requireArray(data.agents ?? [], `${path}.agents`);

  return {
    sessionId: requireString(data, "sessionId", path),
    createdAt: toDate(data.createdAt),
    agentCount: toInt(data.agentCount),
    agents: agentsRaw.map((agentRaw, index) => parseAgent(agentRaw, `${path}.agents[${index}]`))
  };
}

export function parseSessions(raw: unknown, path: string): SessionInfo[] {
  return requireArray(raw, path).map((item, index) => parseSession(item, `${path}[${index}]`));
}

export function parseAgent(raw: unknown, path: string): AgentInfo {
  const data = requireRecord(raw, path);
  return {
    agentId: requireString(data, "agentId", path),
    name: data.name == null ? null : String(data.name),
    role: data.role == null ? null : String(data.role)
  };
}

export function parseWindow(raw: unknown, path: string): WindowInfo {
  const data = requireRecord(raw, path);
  const namespaces = asArray(data.namespaces).map((item) => String(item));
  const actions = asArray(data.actions).map(parseWindowAction);

  return {
    id: requireString(data, "id", path),
    description: data.description == null ? null : String(data.description),
    content: String(data.content ?? ""),
    appName: data.appName == null ? null : String(data.appName),
    createdAt: toInt(data.createdAt),
    updatedAt: toInt(data.updatedAt),
    namespaces,
    actions
  };
}

export function parseWindows(raw: unknown, path: string): WindowInfo[] {
  return requireArray(raw, path).map((item, index) => parseWindow(item, `${path}[${index}]`));
}

export function parseApps(raw: unknown, path: string): AppInfo[] {
  return requireArray(raw, path).map((item, index) => {
    const itemPath = `${path}[${index}]`;
    const data = requireRecord(item, itemPath);

    return {
      name: requireString(data, "name", itemPath),
      description: data.description == null ? null : String(data.description),
      tags: asArray(data.tags).map((tag) => String(tag)),
      isStarted: toBool(data.isStarted)
    };
  });
}

export function parseContextTimeline(raw: unknown, path: string): ContextTimelineItem[] {
  return requireArray(raw, path).map((item, index) => {
    const itemPath = `${path}[${index}]`;
    const data = requireRecord(item, itemPath);

    return {
      id: requireString(data, "id", itemPath),
      type: String(data.type ?? ""),
      seq: toInt(data.seq),
      isObsolete: toBool(data.isObsolete),
      rawContent: String(data.rawContent ?? ""),
      estimatedTokens: toInt(data.estimatedTokens)
    };
  });
}

export function parseInteractionResponse(raw: unknown, path: string): InteractionResponse {
  const data = requireRecord(raw, path);
  return {
    success: toBool(data.success),
    error: data.error == null ? null : String(data.error),
    response: data.response == null ? null : String(data.response),
    action: data.action == null ? null : parseActionInfo(data.action),
    actionResult: data.actionResult == null ? null : parseActionResultInfo(data.actionResult),
    steps: data.steps == null ? null : asArray(data.steps).map(parseInteractionStepInfo),
    usage: data.usage == null ? null : parseUsage(data.usage)
  };
}

export function parseActionInvokeResponse(raw: unknown, path: string): ActionInvokeResponse {
  const data = requireRecord(raw, path);
  return {
    success: toBool(data.success),
    message: data.message == null ? null : String(data.message),
    summary: data.summary == null ? null : String(data.summary)
  };
}
