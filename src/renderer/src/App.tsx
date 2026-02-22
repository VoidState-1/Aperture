import { useEffect, useMemo, useRef, useState } from "react";
import { ACIApi } from "./api";
import { SessionSidebar } from "./components/SessionSidebar";
import { ConversationPanel } from "./components/ConversationPanel";
import { DebugConsole } from "./components/DebugConsole";
import type {
  ActionParamSchema,
  AppInfo,
  CenterViewMode,
  ComposerMode,
  InteractionResponse,
  SessionInfo,
  ToolFormField,
  TranscriptEntry,
  WindowAction,
  WindowInfo,
} from "./types";

const DEFAULT_BASE_URL = "http://localhost:5228";
const DEFAULT_MANUAL_OUTPUT = `<action_call>
{"calls":[{"window_id":"launcher","action_id":"launcher.open","params":{"app":"file_explorer"}}]}
</action_call>`;
const DEFAULT_TOOL_WINDOW_ID = "launcher";

const EMPTY_WINDOWS: WindowInfo[] = [];
const EMPTY_APPS: AppInfo[] = [];

const LAUNCHER_OPEN_PARAM_SCHEMA: ActionParamSchema = {
  kind: "object",
  required: true,
  description: "Open an app from launcher.",
  items: null,
  properties: {
    app: {
      kind: "string",
      required: true,
      description: "Application id.",
      items: null,
      properties: {},
      defaultValue: null,
    },
    target: {
      kind: "string",
      required: false,
      description: "Optional startup target.",
      items: null,
      properties: {},
      defaultValue: null,
    },
  },
  defaultValue: null,
};

const BUILTIN_LAUNCHER_ACTIONS: WindowAction[] = [
  {
    id: "launcher.open",
    label: "Open App",
    paramSchema: LAUNCHER_OPEN_PARAM_SCHEMA,
  },
];

function parseParamKindFromSignature(signature: string): ActionParamSchema["kind"] {
  const normalized = signature.trim().toLowerCase();
  if (normalized.startsWith("array")) return "array";
  if (normalized === "integer" || normalized === "int" || normalized === "long") return "integer";
  if (normalized === "number" || normalized === "float" || normalized === "double" || normalized === "decimal") return "number";
  if (normalized === "boolean" || normalized === "bool") return "boolean";
  if (normalized === "null") return "null";
  if (normalized === "object") return "object";
  if (normalized === "string") return "string";
  return "unknown";
}

function parseParamSchemaFromSignature(signature: string): ActionParamSchema {
  const trimmed = signature.trim();
  const required = !trimmed.endsWith("?");
  const base = required ? trimmed : trimmed.slice(0, -1).trim();

  let items: ActionParamSchema | null = null;
  const kind = parseParamKindFromSignature(base);
  const arrayMatch = /^array<(.+)>$/i.exec(base);
  if (arrayMatch && arrayMatch[1]) {
    items = parseParamSchemaFromSignature(arrayMatch[1]);
  }

  return {
    kind,
    required,
    description: null,
    items,
    properties: {},
    defaultValue: null,
  };
}

function buildParamSchemaFromDescriptorParams(rawParams: unknown): ActionParamSchema {
  const paramsObj = rawParams !== null && typeof rawParams === "object" && !Array.isArray(rawParams) ? (rawParams as Record<string, unknown>) : {};
  const properties: Record<string, ActionParamSchema> = {};

  for (const [name, signature] of Object.entries(paramsObj)) {
    if (!name.trim()) {
      continue;
    }

    properties[name] = parseParamSchemaFromSignature(String(signature ?? ""));
  }

  return {
    kind: "object",
    required: false,
    description: null,
    items: null,
    properties,
    defaultValue: null,
  };
}

function parseNamespaceActionsFromRawLlmInput(rawLlmInput: string): Record<string, WindowAction[]> {
  const map: Record<string, WindowAction[]> = {};
  const regex = /<namespace\s+id="([^"]+)"\s*><!\[CDATA\[(.*?)\]\]><\/namespace>/gms;

  for (const match of rawLlmInput.matchAll(regex)) {
    const namespaceId = (match[1] ?? "").trim();
    const jsonText = match[2] ?? "";
    if (!namespaceId || !jsonText.trim()) {
      continue;
    }

    try {
      const parsed = JSON.parse(jsonText);
      if (!Array.isArray(parsed)) {
        continue;
      }

      const actions: WindowAction[] = [];
      for (const item of parsed) {
        if (item === null || typeof item !== "object" || Array.isArray(item)) {
          continue;
        }

        const itemObj = item as Record<string, unknown>;
        const rawId = String(itemObj.id ?? "").trim();
        if (!rawId) {
          continue;
        }

        const qualifiedId = rawId.includes(".") ? rawId : `${namespaceId}.${rawId}`;
        const description = String(itemObj.description ?? "").trim();
        actions.push({
          id: qualifiedId,
          label: description || qualifiedId,
          paramSchema: buildParamSchemaFromDescriptorParams(itemObj.params),
        });
      }

      if (actions.length > 0) {
        map[namespaceId] = actions;
      }
    } catch {
      // Ignore malformed namespace payloads from raw text.
    }
  }

  return map;
}

function mergeActions(primary: WindowAction[], secondary: WindowAction[]): WindowAction[] {
  const result: WindowAction[] = [];
  const seen = new Set<string>();

  for (const action of [...primary, ...secondary]) {
    const id = action.id.trim();
    if (!id || seen.has(id)) {
      continue;
    }

    seen.add(id);
    result.push(action);
  }

  return result;
}

function hydrateWindowActionsFromNamespaces(windows: WindowInfo[], namespaceActions: Record<string, WindowAction[]>): WindowInfo[] {
  return windows.map((window) => {
    const fromNamespaces = window.namespaces.flatMap((namespaceId) => namespaceActions[namespaceId] ?? []);
    return {
      ...window,
      actions: mergeActions(window.actions, fromNamespaces),
    };
  });
}

function nowEntry(role: TranscriptEntry["role"], content: string): TranscriptEntry {
  return { role, content, time: new Date() };
}

function formatTime(value: Date): string {
  const hh = String(value.getHours()).padStart(2, "0");
  const mm = String(value.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function sessionShortId(sessionId: string): string {
  return sessionId.slice(0, 8);
}

function formatSessionTitle(session: SessionInfo | null): string {
  if (!session) {
    return "No Session";
  }

  if (!session.createdAt) {
    return `Session #${sessionShortId(session.sessionId)}`;
  }

  const d = session.createdAt;
  return `Session #${sessionShortId(session.sessionId)} @ ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function errorText(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err ?? "unknown error");
}

function isAssistantTimelineType(type: string): boolean {
  const normalized = type
    .trim()
    .toLowerCase()
    .replace(/[\s_-]/g, "");
  return normalized.startsWith("assistant");
}

function buildToolWindowOptions(windows: WindowInfo[]): string[] {
  const set = new Set<string>();
  set.add(DEFAULT_TOOL_WINDOW_ID);

  for (const window of windows) {
    if (window.id.trim().length > 0) {
      set.add(window.id);
    }
  }

  return Array.from(set);
}

function getToolActionsForWindow(windowId: string | null, windows: WindowInfo[]): WindowAction[] {
  if (!windowId) {
    return [];
  }

  if (windowId === DEFAULT_TOOL_WINDOW_ID) {
    return BUILTIN_LAUNCHER_ACTIONS;
  }

  return windows.find((item) => item.id === windowId)?.actions ?? [];
}

function suggestToolActionId(windowId: string | null, windows: WindowInfo[]): string {
  if (!windowId) {
    return "";
  }

  const actions = getToolActionsForWindow(windowId, windows);
  if (actions.length > 0) {
    return actions[0]?.id ?? "";
  }

  const match = windows.find((window) => window.id === windowId);
  if (!match || match.namespaces.length === 0) {
    return "";
  }

  return `${match.namespaces[0]}.`;
}

function defaultFieldValue(schema: ActionParamSchema): string {
  if (schema.defaultValue !== undefined && schema.defaultValue !== null) {
    if (schema.kind === "number" || schema.kind === "integer" || schema.kind === "string") {
      return String(schema.defaultValue);
    }

    if (schema.kind === "boolean") {
      return schema.defaultValue === true ? "true" : "false";
    }

    return JSON.stringify(schema.defaultValue, null, 2);
  }

  if (schema.kind === "boolean") {
    return schema.required ? "false" : "";
  }

  return "";
}

function buildToolFormFields(schema: ActionParamSchema | null, path: string[] = []): ToolFormField[] {
  if (!schema) {
    return [];
  }

  const propertyEntries = Object.entries(schema.properties);
  if (schema.kind === "object" && propertyEntries.length > 0) {
    const fields: ToolFormField[] = [];
    for (const [name, child] of propertyEntries) {
      fields.push(...buildToolFormFields(child, [...path, name]));
    }
    return fields;
  }

  const label = path.length > 0 ? path.join(".") : "(root)";
  return [
    {
      path: path.join("."),
      label,
      kind: schema.kind,
      required: schema.required,
      description: schema.description,
    },
  ];
}

function buildDefaultToolFormValues(schema: ActionParamSchema | null, path: string[] = []): Record<string, string> {
  if (!schema) {
    return {};
  }

  const propertyEntries = Object.entries(schema.properties);
  if (schema.kind === "object" && propertyEntries.length > 0) {
    const merged: Record<string, string> = {};
    for (const [name, child] of propertyEntries) {
      const nested = buildDefaultToolFormValues(child, [...path, name]);
      for (const [k, v] of Object.entries(nested)) {
        merged[k] = v;
      }
    }
    return merged;
  }

  return { [path.join(".")]: defaultFieldValue(schema) };
}

function parseLeafSchemaValue(schema: ActionParamSchema, raw: string, label: string): { has: boolean; value: unknown } {
  const trimmed = raw.trim();

  if (schema.kind === "null") {
    return schema.required ? { has: true, value: null } : { has: false, value: null };
  }

  if (schema.kind === "boolean") {
    if (!trimmed) {
      if (schema.required) {
        throw new Error(`Param '${label}' is required.`);
      }
      return { has: false, value: null };
    }

    if (trimmed !== "true" && trimmed !== "false") {
      throw new Error(`Param '${label}' must be true or false.`);
    }

    return { has: true, value: trimmed === "true" };
  }

  if (schema.kind === "string") {
    if (!trimmed && schema.required) {
      throw new Error(`Param '${label}' is required.`);
    }
    return trimmed ? { has: true, value: raw } : { has: false, value: null };
  }

  if (schema.kind === "number" || schema.kind === "integer") {
    if (!trimmed) {
      if (schema.required) {
        throw new Error(`Param '${label}' is required.`);
      }
      return { has: false, value: null };
    }

    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      throw new Error(`Param '${label}' must be a valid number.`);
    }
    if (schema.kind === "integer" && !Number.isInteger(parsed)) {
      throw new Error(`Param '${label}' must be an integer.`);
    }
    return { has: true, value: parsed };
  }

  if (!trimmed) {
    if (schema.required) {
      throw new Error(`Param '${label}' is required.`);
    }
    return { has: false, value: null };
  }

  try {
    const parsed = JSON.parse(raw);
    if (schema.kind === "array" && !Array.isArray(parsed)) {
      throw new Error("Expected JSON array.");
    }
    return { has: true, value: parsed };
  } catch (e) {
    throw new Error(`Param '${label}' contains invalid JSON: ${errorText(e)}`);
  }
}

function buildToolParamsBySchema(schema: ActionParamSchema, values: Record<string, string>, path: string[] = []): { has: boolean; value: unknown } {
  const propertyEntries = Object.entries(schema.properties);
  if (schema.kind === "object" && propertyEntries.length > 0) {
    const obj: Record<string, unknown> = {};
    let hasAny = false;

    for (const [name, child] of propertyEntries) {
      const nested = buildToolParamsBySchema(child, values, [...path, name]);
      if (nested.has) {
        obj[name] = nested.value;
        hasAny = true;
      }
    }

    if (hasAny) {
      return { has: true, value: obj };
    }

    return schema.required ? { has: true, value: {} } : { has: false, value: null };
  }

  const key = path.join(".");
  const raw = values[key] ?? "";
  const label = key || "(root)";
  return parseLeafSchemaValue(schema, raw, label);
}

function parseFallbackParams(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(`Invalid params JSON: ${errorText(e)}`);
  }
}

export function App(): JSX.Element {
  const [baseUrl, setBaseUrl] = useState(DEFAULT_BASE_URL);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);

  const [apps, setApps] = useState<AppInfo[]>(EMPTY_APPS);
  const [windows, setWindows] = useState<WindowInfo[]>(EMPTY_WINDOWS);
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);
  const [rawLlmInput, setRawLlmInput] = useState("");

  const [viewMode, setViewMode] = useState<CenterViewMode>("rendered");
  const [composerMode, setComposerMode] = useState<ComposerMode>("llm");
  const [composerInput, setComposerInput] = useState("");
  const [manualOutputInput, setManualOutputInput] = useState(DEFAULT_MANUAL_OUTPUT);

  const [selectedToolWindowId, setSelectedToolWindowId] = useState<string | null>(DEFAULT_TOOL_WINDOW_ID);
  const [selectedToolActionId, setSelectedToolActionId] = useState("launcher.open");
  const [toolFormValues, setToolFormValues] = useState<Record<string, string>>({});
  const [fallbackToolParamsJson, setFallbackToolParamsJson] = useState("");

  const [busy, setBusy] = useState(false);
  const [interacting, setInteracting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const transcriptRef = useRef<HTMLDivElement>(null);
  const pollTimerRef = useRef<number | null>(null);
  const seenAssistantSeqRef = useRef<Set<number>>(new Set());

  const activeSession = useMemo(() => sessions.find((session) => session.sessionId === selectedSessionId) ?? null, [selectedSessionId, sessions]);

  const toolWindowOptions = useMemo(() => buildToolWindowOptions(windows), [windows]);
  const selectedToolWindow = useMemo(() => windows.find((window) => window.id === selectedToolWindowId) ?? null, [windows, selectedToolWindowId]);
  const selectedToolActions = useMemo(() => getToolActionsForWindow(selectedToolWindowId, windows), [selectedToolWindowId, windows]);
  const selectedToolAction = useMemo(
    () => selectedToolActions.find((item) => item.id === selectedToolActionId) ?? null,
    [selectedToolActions, selectedToolActionId],
  );
  const toolFormFields = useMemo(
    () => buildToolFormFields(selectedToolAction?.paramSchema ?? null),
    [selectedToolAction?.id, selectedToolAction?.paramSchema],
  );
  const appOptions = useMemo(() => apps.map((item) => item.name), [apps]);

  useEffect(() => {
    void runGuarded(async () => {
      await reloadSessionCatalog(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!transcriptRef.current || viewMode !== "rendered") return;
    transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight + 80;
  }, [entries, busy, interacting, viewMode]);

  useEffect(() => {
    if (!selectedToolWindowId) {
      return;
    }

    if (selectedToolActions.length === 0) {
      const suggested = suggestToolActionId(selectedToolWindowId, windows);
      if (selectedToolActionId !== suggested) {
        setSelectedToolActionId(suggested);
      }
      return;
    }

    if (!selectedToolActions.some((item) => item.id === selectedToolActionId)) {
      setSelectedToolActionId(selectedToolActions[0]!.id);
    }
  }, [selectedToolWindowId, selectedToolActions, selectedToolActionId, windows]);

  useEffect(() => {
    const schema = selectedToolAction?.paramSchema ?? null;
    setToolFormValues(buildDefaultToolFormValues(schema));
    setFallbackToolParamsJson("");
  }, [selectedToolWindowId, selectedToolAction?.id]);

  useEffect(() => {
    return () => {
      if (pollTimerRef.current != null) {
        window.clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, []);

  async function runGuarded(action: () => Promise<void>): Promise<void> {
    if (busy || interacting) {
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  function getDefaultAgentId(session: SessionInfo | null): string | null {
    if (!session || session.agents.length === 0) {
      return null;
    }
    return session.agents[0]?.agentId ?? null;
  }

  function syncToolCallSelection(nextWindows: WindowInfo[]): void {
    const options = buildToolWindowOptions(nextWindows);
    const previousWindowId = selectedToolWindowId;

    let nextWindowId = previousWindowId;
    if (!nextWindowId || !options.includes(nextWindowId)) {
      nextWindowId = options[0] ?? null;
    }

    if (nextWindowId !== previousWindowId) {
      setSelectedToolWindowId(nextWindowId);
      setSelectedToolActionId(suggestToolActionId(nextWindowId, nextWindows));
      return;
    }

    if (!selectedToolActionId.trim()) {
      setSelectedToolActionId(suggestToolActionId(nextWindowId, nextWindows));
    }
  }

  async function loadSessionAgentState(sessionId: string, agentId: string): Promise<void> {
    const [nextWindows, nextRawLlmInput, nextApps] = await Promise.all([
      ACIApi.getWindows(baseUrl, sessionId, agentId),
      ACIApi.getRawLlmInput(baseUrl, sessionId, agentId),
      ACIApi.getApps(baseUrl, sessionId, agentId),
    ]);

    const namespaceActions = parseNamespaceActionsFromRawLlmInput(nextRawLlmInput);
    const hydratedWindows = hydrateWindowActionsFromNamespaces(nextWindows, namespaceActions);

    setWindows(hydratedWindows);
    setRawLlmInput(nextRawLlmInput);
    setApps(nextApps);
    syncToolCallSelection(hydratedWindows);
  }

  async function reloadSessionCatalog(autoCreateIfEmpty = false): Promise<void> {
    let nextSessions = await ACIApi.getSessions(baseUrl);
    let nextSelectedSessionId = selectedSessionId;
    let nextSelectedAgentId = selectedAgentId;

    if (nextSessions.length === 0 && autoCreateIfEmpty) {
      const created = await ACIApi.createSession(baseUrl);
      nextSessions = [created];
      nextSelectedSessionId = created.sessionId;
      nextSelectedAgentId = getDefaultAgentId(created);
      setEntries((prev) => [...prev, nowEntry("system", `Auto-created session ${created.sessionId}`)]);
    }

    if (!nextSelectedSessionId || !nextSessions.some((session) => session.sessionId === nextSelectedSessionId)) {
      nextSelectedSessionId = nextSessions[0]?.sessionId ?? null;
    }

    const nextSession = nextSessions.find((session) => session.sessionId === nextSelectedSessionId) ?? null;
    if (!nextSelectedAgentId || !nextSession?.agents.some((agent) => agent.agentId === nextSelectedAgentId)) {
      nextSelectedAgentId = getDefaultAgentId(nextSession);
    }

    setSessions(nextSessions);
    setSelectedSessionId(nextSelectedSessionId);
    setSelectedAgentId(nextSelectedAgentId);

    if (nextSelectedSessionId && nextSelectedAgentId) {
      await loadSessionAgentState(nextSelectedSessionId, nextSelectedAgentId);
      return;
    }

    setWindows(EMPTY_WINDOWS);
    setApps(EMPTY_APPS);
    setRawLlmInput("");
  }

  async function ensureSessionReady(): Promise<{ sessionId: string; agentId: string } | null> {
    if (selectedSessionId && selectedAgentId) {
      return { sessionId: selectedSessionId, agentId: selectedAgentId };
    }

    let nextSession = activeSession;
    if (!nextSession) {
      const created = await ACIApi.createSession(baseUrl);
      setEntries((prev) => [...prev, nowEntry("system", `Auto-created session ${created.sessionId}`)]);
      await reloadSessionCatalog();
      nextSession = created;
    }

    const agentId = selectedAgentId ?? getDefaultAgentId(nextSession);
    if (!nextSession || !agentId) {
      return null;
    }

    setSelectedSessionId(nextSession.sessionId);
    setSelectedAgentId(agentId);
    return { sessionId: nextSession.sessionId, agentId };
  }

  async function createSession(): Promise<void> {
    await runGuarded(async () => {
      const created = await ACIApi.createSession(baseUrl);
      const agentId = getDefaultAgentId(created);
      setEntries((prev) => [...prev, nowEntry("system", `Created session ${created.sessionId}`)]);

      await reloadSessionCatalog();
      if (agentId) {
        setSelectedSessionId(created.sessionId);
        setSelectedAgentId(agentId);
        await loadSessionAgentState(created.sessionId, agentId);
      }
    });
  }

  async function deleteCurrentSession(): Promise<void> {
    if (!selectedSessionId) {
      return;
    }

    await runGuarded(async () => {
      await ACIApi.closeSession(baseUrl, selectedSessionId);
      setEntries((prev) => [...prev, nowEntry("system", `Closed session ${selectedSessionId}`)]);
      setSelectedSessionId(null);
      setSelectedAgentId(null);
      await reloadSessionCatalog();
    });
  }

  async function refreshCurrent(): Promise<void> {
    await runGuarded(async () => {
      if (!selectedSessionId || !selectedAgentId) {
        await reloadSessionCatalog(true);
        return;
      }

      await reloadSessionCatalog();
      await loadSessionAgentState(selectedSessionId, selectedAgentId);
    });
  }

  function applyInteractionResult(result: InteractionResponse, options?: { skipResponse?: boolean }): void {
    if (!result.success) {
      setEntries((prev) => [...prev, nowEntry("system", `Request failed: ${result.error ?? "unknown"}`)]);
      return;
    }

    const lines: string[] = [];
    if (!options?.skipResponse && (result.response ?? "").length > 0) {
      lines.push(result.response ?? "");
    }
    if (result.action) {
      lines.push(
        `[action] type=${result.action.type}, app=${result.action.appName}, window=${result.action.windowId}, actionId=${result.action.actionId}`,
      );
    }
    if (result.actionResult) {
      lines.push(
        `[actionResult] success=${result.actionResult.success}, message=${result.actionResult.message ?? ""}, summary=${result.actionResult.summary ?? ""}`,
      );
    }
    if (result.steps && result.steps.length > 0) {
      for (const step of result.steps) {
        lines.push(
          `[step] call=${step.callId}, turn=${step.turn}, idx=${step.index}, mode=${step.resolvedMode}, target=${step.windowId}.${step.actionId}, success=${step.success}, task=${step.taskId ?? ""}`,
        );
        if (step.message) lines.push(`  message: ${step.message}`);
        if (step.summary) lines.push(`  summary: ${step.summary}`);
      }
    }
    if (result.usage) {
      lines.push(`[usage] prompt=${result.usage.promptTokens}, completion=${result.usage.completionTokens}, total=${result.usage.totalTokens}`);
    }

    if (lines.length > 0) {
      setEntries((prev) => [...prev, nowEntry("assistant", lines.join("\n"))]);
    }
  }

  function stopInteractionPolling(): void {
    if (pollTimerRef.current != null) {
      window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }

  async function initAssistantTracking(sessionId: string, agentId: string): Promise<void> {
    const timeline = await ACIApi.getContextTimeline(baseUrl, sessionId, agentId, true);
    const seen = new Set<number>();
    for (const item of timeline) {
      if (isAssistantTimelineType(item.type)) {
        seen.add(item.seq);
      }
    }
    seenAssistantSeqRef.current = seen;
  }

  async function pullAssistantDeltas(sessionId: string, agentId: string): Promise<number> {
    const timeline = await ACIApi.getContextTimeline(baseUrl, sessionId, agentId, true);
    const items = timeline
      .filter((item) => isAssistantTimelineType(item.type) && !seenAssistantSeqRef.current.has(item.seq))
      .sort((left, right) => left.seq - right.seq);

    if (items.length === 0) {
      return 0;
    }

    setEntries((prev) => [...prev, ...items.map((item) => nowEntry("assistant", item.rawContent))]);
    for (const item of items) {
      seenAssistantSeqRef.current.add(item.seq);
    }
    return items.length;
  }

  async function simulateToolCall(calls: Array<Record<string, unknown>>): Promise<void> {
    const context = await ensureSessionReady();
    if (!context) {
      throw new Error("No active agent.");
    }

    const { sessionId, agentId } = context;
    const assistantOutput = `<action_call>\n${JSON.stringify({ calls }, null, 2)}\n</action_call>`;
    setEntries((prev) => [...prev, nowEntry("simulator", assistantOutput)]);
    const result = await ACIApi.simulateAssistantOutput(baseUrl, sessionId, agentId, assistantOutput);
    applyInteractionResult(result);
    await loadSessionAgentState(sessionId, agentId);
  }

  async function sendComposer(): Promise<void> {
    const context = await ensureSessionReady();
    if (!context) {
      setError("No active agent.");
      return;
    }

    const { sessionId, agentId } = context;

    if (composerMode === "simulatedAssistant") {
      await runGuarded(async () => {
        const content = manualOutputInput.trim();
        if (!content) {
          throw new Error("Assistant output cannot be empty.");
        }

        setEntries((prev) => [...prev, nowEntry("simulator", content)]);
        const result = await ACIApi.simulateAssistantOutput(baseUrl, sessionId, agentId, content);
        applyInteractionResult(result);
        await loadSessionAgentState(sessionId, agentId);
      });
      return;
    }

    if (composerMode === "toolCall") {
      await runGuarded(async () => {
        if (!selectedToolWindowId) {
          throw new Error("Select a window first.");
        }

        const actionId = selectedToolActionId.trim();
        if (!actionId) {
          throw new Error("Action id cannot be empty.");
        }

        let params: unknown;
        if (selectedToolAction?.paramSchema) {
          const parsed = buildToolParamsBySchema(selectedToolAction.paramSchema, toolFormValues);
          params = parsed.has ? parsed.value : null;
        } else {
          params = parseFallbackParams(fallbackToolParamsJson);
        }

        await simulateToolCall([
          {
            window_id: selectedToolWindowId,
            action_id: actionId,
            params,
          },
        ]);
      });
      return;
    }

    if (interacting) {
      return;
    }

    const content = composerInput.trim();
    if (!content) {
      setError("Message cannot be empty.");
      return;
    }

    try {
      setInteracting(true);
      setError(null);
      setComposerInput("");
      setEntries((prev) => [...prev, nowEntry("user", content)]);
      await initAssistantTracking(sessionId, agentId);

      let hasLiveAssistantOutput = false;
      const poll = async () => {
        const deltaCount = await pullAssistantDeltas(sessionId, agentId);
        if (deltaCount > 0) {
          hasLiveAssistantOutput = true;
        }
      };

      stopInteractionPolling();
      pollTimerRef.current = window.setInterval(() => {
        void poll().catch(() => {
          // Keep polling resilient.
        });
      }, 700);

      const result = await ACIApi.interact(baseUrl, sessionId, agentId, content);
      const finalDeltaCount = await pullAssistantDeltas(sessionId, agentId);
      if (finalDeltaCount > 0) {
        hasLiveAssistantOutput = true;
      }

      applyInteractionResult(result, { skipResponse: hasLiveAssistantOutput });
      await loadSessionAgentState(sessionId, agentId);
    } catch (err) {
      const message = errorText(err);
      setError(message);
      setEntries((prev) => [...prev, nowEntry("system", `Request failed: ${message}`)]);
    } finally {
      stopInteractionPolling();
      setInteracting(false);
    }
  }

  function onSelectToolWindow(windowId: string): void {
    const resolvedWindowId = windowId.trim() || null;
    setSelectedToolWindowId(resolvedWindowId);
    setSelectedToolActionId(suggestToolActionId(resolvedWindowId, windows));
  }

  function onUseAsToolTarget(windowId: string, actionId?: string): void {
    onSelectToolWindow(windowId);
    if (actionId) {
      setSelectedToolActionId(actionId);
    }
    setComposerMode("toolCall");
  }

  function onToolFieldValueChange(path: string, value: string): void {
    setToolFormValues((prev) => ({
      ...prev,
      [path]: value,
    }));
  }

  async function selectSessionAgent(sessionId: string, agentId: string): Promise<void> {
    await runGuarded(async () => {
      setSelectedSessionId(sessionId);
      setSelectedAgentId(agentId);
      await loadSessionAgentState(sessionId, agentId);
    });
  }

  return (
    <div className="aci-app">
      <SessionSidebar
        sessions={sessions}
        selectedSessionId={selectedSessionId}
        selectedAgentId={selectedAgentId}
        busy={busy}
        interacting={interacting}
        onCreateSession={() => void createSession()}
        onRefresh={() => void refreshCurrent()}
        onDeleteSession={() => void deleteCurrentSession()}
        onSelectSessionAgent={(sessionId, agentId) => void selectSessionAgent(sessionId, agentId)}
        formatSessionTitle={formatSessionTitle}
      />

      <ConversationPanel
        activeSession={activeSession}
        selectedAgentId={selectedAgentId}
        baseUrl={baseUrl}
        error={error}
        entries={entries}
        transcriptRef={transcriptRef}
        busy={busy}
        interacting={interacting}
        viewMode={viewMode}
        rawLlmInput={rawLlmInput}
        composerMode={composerMode}
        composerInput={composerInput}
        manualOutputInput={manualOutputInput}
        toolWindowOptions={toolWindowOptions}
        selectedToolWindow={selectedToolWindow}
        selectedToolWindowId={selectedToolWindowId}
        selectedToolActions={selectedToolActions}
        selectedToolActionId={selectedToolActionId}
        selectedToolAction={selectedToolAction}
        toolFormFields={toolFormFields}
        toolFormValues={toolFormValues}
        fallbackToolParamsJson={fallbackToolParamsJson}
        appOptions={appOptions}
        onSetViewMode={setViewMode}
        onSetComposerMode={setComposerMode}
        onComposerInputChange={setComposerInput}
        onManualOutputInputChange={setManualOutputInput}
        onSelectToolWindow={onSelectToolWindow}
        onSelectToolAction={setSelectedToolActionId}
        onToolFieldValueChange={onToolFieldValueChange}
        onFallbackToolParamsJsonChange={setFallbackToolParamsJson}
        onSend={() => void sendComposer()}
        onRefresh={() => void refreshCurrent()}
        formatEntryTime={formatTime}
        sessionShortId={sessionShortId}
      />

      <DebugConsole
        busy={busy}
        interacting={interacting}
        baseUrl={baseUrl}
        onBaseUrlChange={setBaseUrl}
        windows={windows}
        selectedToolWindowId={selectedToolWindowId}
        onUseAsToolTarget={onUseAsToolTarget}
      />
    </div>
  );
}
