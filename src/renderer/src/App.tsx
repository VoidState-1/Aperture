import { useEffect, useMemo, useRef, useState } from "react";
import { ACIApi } from "./api";
import type {
  ActionParameterDef,
  AppInfo,
  ComposerMode,
  InteractionResponse,
  SessionInfo,
  SimulatorMode,
  TranscriptEntry,
  WindowAction,
  WindowInfo,
} from "./types";

const DEFAULT_MANUAL_OUTPUT = `<tool_call>
{"calls":[{"window_id":"launcher","action_id":"open","params":{"app":"file_explorer"}}]}
</tool_call>`;

const EMPTY_APPS: AppInfo[] = [];
const EMPTY_WINDOWS: WindowInfo[] = [];

// Icons
const Icons = {
  Refresh: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M23 4v6h-6" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  ),
  Plus: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  ),
  Trash: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  ),
  Send: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  ),
  Terminal: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  ),
  Zap: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  ),
};

function nowEntry(role: TranscriptEntry["role"], content: string): TranscriptEntry {
  return { role, content, time: new Date() };
}

function formatTime(value: Date): string {
  const hh = String(value.getHours()).padStart(2, "0");
  const mm = String(value.getMinutes()).padStart(2, "0");
  const ss = String(value.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function formatSessionLabel(session: SessionInfo): string {
  if (!session.createdAt) {
    return session.sessionId;
  }

  const d = session.createdAt;
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
  return `${session.sessionId} [${date} ${time}]`;
}

function normalizeType(raw: string): string {
  const lowered = raw.trim().toLowerCase();
  if (lowered === "integer") return "int";
  if (lowered === "number") return "float";
  return lowered;
}

function isIntType(type: string): boolean {
  return type === "int";
}

function isFloatType(type: string): boolean {
  return type === "float" || type === "double";
}

function isBoolType(type: string): boolean {
  return type === "bool" || type === "boolean";
}

function parseBoolDefault(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  const text = String(value ?? "").toLowerCase();
  if (text === "true") return true;
  if (text === "false") return false;
  return null;
}

function defaultValueText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function errorText(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err ?? "unknown error");
}

export function App(): JSX.Element {
  const [baseUrl, setBaseUrl] = useState("http://localhost:5228");
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [apps, setApps] = useState<AppInfo[]>(EMPTY_APPS);
  const [windows, setWindows] = useState<WindowInfo[]>(EMPTY_WINDOWS);
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);
  const [rawContext, setRawContext] = useState("");
  const [rawLlmInput, setRawLlmInput] = useState("");

  const [composerMode, setComposerMode] = useState<ComposerMode>("llm");
  const [simulatorMode, setSimulatorMode] = useState<SimulatorMode>("create");
  const [composerInput, setComposerInput] = useState("");
  const [manualOutputInput, setManualOutputInput] = useState(DEFAULT_MANUAL_OUTPUT);

  const [selectedCreateApp, setSelectedCreateApp] = useState<string | null>(null);
  const [createTarget, setCreateTarget] = useState("");
  const [selectedActionWindowId, setSelectedActionWindowId] = useState<string | null>(null);
  const [selectedActionId, setSelectedActionId] = useState<string | null>(null);

  const [includeObsolete, setIncludeObsolete] = useState(true);
  const [inspectorTab, setInspectorTab] = useState<"context" | "llm" | "windows">("windows");
  const [busy, setBusy] = useState(false);
  const [interacting, setInteracting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [actionParamText, setActionParamText] = useState<Record<string, string>>({});
  const [actionParamBool, setActionParamBool] = useState<Record<string, boolean | null>>({});

  const transcriptRef = useRef<HTMLDivElement>(null);
  const pollTimerRef = useRef<number | null>(null);
  const seenAssistantSeqRef = useRef<Set<number>>(new Set());

  const selectedWindow = useMemo(() => windows.find((window) => window.id === selectedActionWindowId) ?? null, [selectedActionWindowId, windows]);

  const selectedAction = useMemo(
    () => selectedWindow?.actions.find((action) => action.id === selectedActionId) ?? null,
    [selectedActionId, selectedWindow],
  );

  useEffect(() => {
    void runGuarded(async () => {
      await reloadSessionCatalog(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!transcriptRef.current) return;
    transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight + 64;
  }, [entries, busy, interacting]);

  useEffect(() => {
    return () => {
      if (pollTimerRef.current != null) {
        window.clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, []);

  async function runGuarded(action: () => Promise<void>): Promise<void> {
    if (busy) return;

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

  function syncSimulatorSelections(nextApps: AppInfo[], nextWindows: WindowInfo[]): void {
    let createApp = selectedCreateApp;
    if (!createApp || !nextApps.some((item) => item.name === createApp)) {
      createApp = nextApps[0]?.name ?? null;
    }

    let windowId = selectedActionWindowId;
    if (!windowId || !nextWindows.some((item) => item.id === windowId)) {
      windowId = nextWindows[0]?.id ?? null;
    }

    const window = nextWindows.find((item) => item.id === windowId) ?? null;
    const actions = window?.actions ?? [];
    let actionId = selectedActionId;
    if (!actionId || !actions.some((item) => item.id === actionId)) {
      actionId = actions[0]?.id ?? null;
    }

    setSelectedCreateApp(createApp);
    setSelectedActionWindowId(windowId);
    setSelectedActionId(actionId);

    if (window && actionId) {
      const action = actions.find((item) => item.id === actionId) ?? null;
      if (action) {
        prepareParamEditors(window, action);
      }
    }
  }

  function paramKey(windowId: string, actionId: string, paramName: string): string {
    return `${windowId}::${actionId}::${paramName}`;
  }

  function prepareParamEditors(window: WindowInfo, action: WindowAction): void {
    const nextText = { ...actionParamText };
    const nextBool = { ...actionParamBool };

    for (const param of action.parameters) {
      const key = paramKey(window.id, action.id, param.name);
      const normalizedType = normalizeType(param.type);
      if (isBoolType(normalizedType)) {
        if (!(key in nextBool)) {
          nextBool[key] = parseBoolDefault(param.defaultValue);
        }
      } else if (!(key in nextText)) {
        nextText[key] = defaultValueText(param.defaultValue);
      }
    }

    setActionParamText(nextText);
    setActionParamBool(nextBool);
  }

  function parseTypedParamValue(type: string, raw: string): unknown {
    const normalizedType = normalizeType(type);

    if (isIntType(normalizedType)) {
      const parsed = Number(raw);
      if (!Number.isInteger(parsed)) {
        throw new Error(`Expected int for type ${type}, got "${raw}"`);
      }
      return parsed;
    }

    if (isFloatType(normalizedType)) {
      const parsed = Number.parseFloat(raw);
      if (Number.isNaN(parsed)) {
        throw new Error(`Expected number for type ${type}, got "${raw}"`);
      }
      return parsed;
    }

    if (isBoolType(normalizedType)) {
      const lowered = raw.toLowerCase();
      if (lowered === "true") return true;
      if (lowered === "false") return false;
      throw new Error(`Expected bool for type ${type}, got "${raw}"`);
    }

    if (normalizedType === "json" || normalizedType === "object" || normalizedType === "map") {
      try {
        return JSON.parse(raw);
      } catch (e) {
        throw new Error(`Invalid JSON: ${errorText(e)}`);
      }
    }

    return raw;
  }

  function collectActionParams(window: WindowInfo, action: WindowAction): Record<string, unknown> {
    const params: Record<string, unknown> = {};

    for (const param of action.parameters) {
      const key = paramKey(window.id, action.id, param.name);
      const normalizedType = normalizeType(param.type);

      if (isBoolType(normalizedType)) {
        const boolValue = actionParamBool[key];
        if (boolValue == null) {
          if (param.required) {
            throw new Error(`Parameter ${param.name} is required`);
          }
          continue;
        }
        params[param.name] = boolValue;
        continue;
      }

      const raw = (actionParamText[key] ?? "").trim();
      if (raw.length === 0) {
        if (param.required) {
          throw new Error(`Parameter ${param.name} is required`);
        }
        continue;
      }

      params[param.name] = parseTypedParamValue(param.type, raw);
    }

    return params;
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
        if (step.message) {
          lines.push(`  message: ${step.message}`);
        }
        if (step.summary) {
          lines.push(`  summary: ${step.summary}`);
        }
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

  function isAssistantTimelineType(type: string): boolean {
    const normalized = type
      .trim()
      .toLowerCase()
      .replace(/[\s_-]/g, "");
    return normalized.startsWith("assistant");
  }

  async function initAssistantTracking(sessionId: string): Promise<void> {
    const timeline = await ACIApi.getContextTimeline(baseUrl, sessionId, true);
    const seen = new Set<number>();

    for (const item of timeline) {
      if (!isAssistantTimelineType(item.type)) continue;
      seen.add(item.seq);
    }

    seenAssistantSeqRef.current = seen;
  }

  async function pullAssistantDeltas(sessionId: string): Promise<number> {
    const timeline = await ACIApi.getContextTimeline(baseUrl, sessionId, true);
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

  async function loadSessionState(sessionId: string, includeObsoleteValue = includeObsolete): Promise<void> {
    const [nextWindows, nextApps, nextRawContext, nextRawLlmInput] = await Promise.all([
      ACIApi.getWindows(baseUrl, sessionId),
      ACIApi.getApps(baseUrl, sessionId),
      ACIApi.getRawContext(baseUrl, sessionId, includeObsoleteValue),
      ACIApi.getRawLlmInput(baseUrl, sessionId),
    ]);

    setWindows(nextWindows);
    setApps(nextApps);
    setRawContext(nextRawContext);
    setRawLlmInput(nextRawLlmInput);
    syncSimulatorSelections(nextApps, nextWindows);
  }

  async function ensureSessionReady(): Promise<string | null> {
    if (selectedSessionId && selectedSessionId.length > 0) {
      return selectedSessionId;
    }

    const created = await ACIApi.createSession(baseUrl);
    setSelectedSessionId(created.sessionId);
    setEntries((prev) => [...prev, nowEntry("system", `Auto-created session ${created.sessionId}`)]);

    await reloadSessionCatalog();
    return created.sessionId;
  }

  async function reloadSessionCatalog(autoCreateIfEmpty = false): Promise<void> {
    let nextSessions = await ACIApi.getSessions(baseUrl);
    let nextSelected = selectedSessionId;

    if (nextSessions.length === 0 && autoCreateIfEmpty) {
      const created = await ACIApi.createSession(baseUrl);
      nextSessions = [created];
      nextSelected = created.sessionId;
      setEntries((prev) => [...prev, nowEntry("system", `Auto-created session ${created.sessionId}`)]);
    }

    if (!nextSelected || !nextSessions.some((session) => session.sessionId === nextSelected)) {
      nextSelected = nextSessions[0]?.sessionId ?? null;
    }

    setSessions(nextSessions);
    setSelectedSessionId(nextSelected);

    if (nextSelected) {
      await loadSessionState(nextSelected);
    } else {
      setApps(EMPTY_APPS);
      setWindows(EMPTY_WINDOWS);
      setRawContext("");
      setRawLlmInput("");
    }
  }

  async function createSession(): Promise<void> {
    await runGuarded(async () => {
      const created = await ACIApi.createSession(baseUrl);
      setEntries((prev) => [...prev, nowEntry("system", `Created session ${created.sessionId}`)]);
      setSelectedSessionId(created.sessionId);
      await reloadSessionCatalog();
      await loadSessionState(created.sessionId);
    });
  }

  async function deleteCurrentSession(): Promise<void> {
    const sessionId = selectedSessionId;
    if (!sessionId) return;

    await runGuarded(async () => {
      await ACIApi.closeSession(baseUrl, sessionId);
      setEntries((prev) => [...prev, nowEntry("system", `Closed session ${sessionId}`)]);
      setSelectedSessionId(null);
      await reloadSessionCatalog();
    });
  }

  async function refreshCurrentSession(): Promise<void> {
    await runGuarded(async () => {
      if (!selectedSessionId) {
        await reloadSessionCatalog(true);
        return;
      }
      await loadSessionState(selectedSessionId);
    });
  }

  async function sendComposer(): Promise<void> {
    if (composerMode !== "llm") {
      await runGuarded(async () => {
        const sessionId = await ensureSessionReady();
        if (!sessionId) return;

        const content = manualOutputInput.trim();
        if (content.length === 0) {
          throw new Error("Assistant output cannot be empty");
        }

        setEntries((prev) => [...prev, nowEntry("simulator", content)]);
        const result = await ACIApi.simulateAssistantOutput(baseUrl, sessionId, content);
        applyInteractionResult(result);
        await loadSessionState(sessionId);
      });
      return;
    }

    if (interacting) return;

    setError(null);
    const content = composerInput.trim();
    if (content.length === 0) {
      setError("Message cannot be empty");
      return;
    }

    let sessionId: string | null = null;
    try {
      sessionId = await ensureSessionReady();
      if (!sessionId) return;

      setInteracting(true);
      setComposerInput("");
      setEntries((prev) => [...prev, nowEntry("user", content)]);

      await initAssistantTracking(sessionId);

      const activeSessionId = sessionId;
      let hasLiveAssistantOutput = false;
      const poll = async () => {
        const deltaCount = await pullAssistantDeltas(activeSessionId);
        if (deltaCount > 0) {
          hasLiveAssistantOutput = true;
        }
      };

      stopInteractionPolling();
      pollTimerRef.current = window.setInterval(() => {
        void poll().catch(() => {
          // Keep loop resilient; final request result still determines success/failure.
        });
      }, 700);

      const result = await ACIApi.interact(baseUrl, activeSessionId, content);
      const finalDeltaCount = await pullAssistantDeltas(activeSessionId);
      if (finalDeltaCount > 0) {
        hasLiveAssistantOutput = true;
      }
      applyInteractionResult(result, { skipResponse: hasLiveAssistantOutput });
      await loadSessionState(activeSessionId);
    } catch (err) {
      setError(errorText(err));
      setEntries((prev) => [...prev, nowEntry("system", `Request failed: ${errorText(err)}`)]);
    } finally {
      stopInteractionPolling();
      setInteracting(false);
    }
  }

  async function simulateToolCall(calls: Array<Record<string, unknown>>): Promise<void> {
    const sessionId = await ensureSessionReady();
    if (!sessionId) return;

    // Simulated assistant output follows backend parser format directly.
    const assistantOutput = `<tool_call>\n${JSON.stringify({ calls }, null, 2)}\n</tool_call>`;
    setEntries((prev) => [...prev, nowEntry("simulator", assistantOutput)]);
    const result = await ACIApi.simulateAssistantOutput(baseUrl, sessionId, assistantOutput);
    applyInteractionResult(result);
    await loadSessionState(sessionId);
  }

  async function simulateCreateToolCall(): Promise<void> {
    await runGuarded(async () => {
      if (!selectedCreateApp || selectedCreateApp.trim().length === 0) {
        throw new Error("Select an app first");
      }

      // In the new protocol, opening an app is an action on launcher.
      const params: Record<string, unknown> = { app: selectedCreateApp };
      const target = createTarget.trim();
      if (target.length > 0) {
        params.target = target;
      }

      await simulateToolCall([
        {
          window_id: "launcher",
          action_id: "open",
          params,
        },
      ]);
    });
  }

  async function simulateActionToolCall(): Promise<void> {
    await runGuarded(async () => {
      if (!selectedWindow || !selectedAction) {
        throw new Error("Select a window and action first");
      }

      const params = collectActionParams(selectedWindow, selectedAction);
      // Unified action-only tool_call payload.
      await simulateToolCall([
        {
          window_id: selectedWindow.id,
          action_id: selectedAction.id,
          params,
        },
      ]);
    });
  }

  async function invokeActionDirectly(): Promise<void> {
    await runGuarded(async () => {
      const sessionId = await ensureSessionReady();
      if (!sessionId) return;

      if (!selectedWindow || !selectedAction) {
        throw new Error("Select a window and action first");
      }

      const params = collectActionParams(selectedWindow, selectedAction);
      const result = await ACIApi.runWindowAction(baseUrl, sessionId, selectedWindow.id, selectedAction.id, params);

      setEntries((prev) => [
        ...prev,
        nowEntry(
          "system",
          `Direct invoke ${selectedWindow.id}.${selectedAction.id}: success=${result.success}, message=${result.message ?? ""}, summary=${result.summary ?? ""}`,
        ),
      ]);

      await loadSessionState(sessionId);
    });
  }

  function onSelectActionWindow(windowId: string): void {
    setSelectedActionWindowId(windowId);
    const window = windows.find((item) => item.id === windowId) ?? null;
    const nextAction = window?.actions[0]?.id ?? null;
    setSelectedActionId(nextAction);
    if (window && nextAction) {
      const action = window.actions.find((item) => item.id === nextAction);
      if (action) {
        prepareParamEditors(window, action);
      }
    }
  }

  function onSelectAction(actionId: string): void {
    setSelectedActionId(actionId);
    const window = windows.find((item) => item.id === selectedActionWindowId) ?? null;
    if (!window) return;
    const action = window.actions.find((item) => item.id === actionId);
    if (action) {
      prepareParamEditors(window, action);
    }
  }

  function renderParamEditor(param: ActionParameterDef): JSX.Element {
    if (!selectedWindow || !selectedAction) {
      return <></>;
    }

    const key = paramKey(selectedWindow.id, selectedAction.id, param.name);
    const normalizedType = normalizeType(param.type);

    if (isBoolType(normalizedType)) {
      const current = actionParamBool[key];
      return (
        <select
          className="input"
          disabled={busy}
          value={current == null ? "unset" : String(current)}
          onChange={(event) => {
            const next = event.target.value;
            setActionParamBool((prev) => ({
              ...prev,
              [key]: next === "unset" ? null : next === "true",
            }));
          }}
        >
          <option value="true">true</option>
          <option value="false">false</option>
          <option value="unset">unset</option>
        </select>
      );
    }

    const value = actionParamText[key] ?? defaultValueText(param.defaultValue);
    return (
      <input
        className="input"
        disabled={busy}
        value={value}
        onChange={(event) => {
          const nextValue = event.target.value;
          setActionParamText((prev) => ({ ...prev, [key]: nextValue }));
        }}
        placeholder={param.required ? "required" : "optional"}
      />
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-title">
          <h1>Aperture Debug Workbench</h1>
          <p>ACI Electron Interface</p>
        </div>
        <button className="button secondary" disabled={busy || interacting} onClick={() => void refreshCurrentSession()}>
          <Icons.Refresh />
          Refresh
        </button>
      </header>

      <section className="connection">
        <div className="connection-row">
          <div className="field">
            <label>Server URL</label>
            <input
              className="input"
              disabled={busy || interacting}
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder="http://localhost:5228"
            />
          </div>
          <div className="field">
            <label>Session</label>
            <select
              className="input"
              disabled={busy || interacting}
              value={selectedSessionId ?? ""}
              onChange={(event) => {
                const value = event.target.value;
                setSelectedSessionId(value.length === 0 ? null : value);
                if (value.length > 0) {
                  void runGuarded(async () => {
                    await loadSessionState(value);
                  });
                }
              }}
            >
              {sessions.length === 0 && <option value="">No session</option>}
              {sessions.map((session) => (
                <option key={session.sessionId} value={session.sessionId}>
                  {formatSessionLabel(session)}
                </option>
              ))}
            </select>
          </div>
          <div className="connection-actions">
            <button className="button secondary" disabled={busy || interacting} onClick={() => void runGuarded(() => reloadSessionCatalog(true))}>
              <Icons.Terminal />
              Reload
            </button>
            <button className="button" disabled={busy || interacting} onClick={() => void createSession()}>
              <Icons.Plus />
              New
            </button>
            <button className="button danger" disabled={busy || interacting || !selectedSessionId} onClick={() => void deleteCurrentSession()}>
              <Icons.Trash />
              Close
            </button>
          </div>
        </div>
      </section>

      {error && (
        <section className="error-banner">
          <strong>Error:</strong> {error}
        </section>
      )}

      <main className="panels">
        {/* PANEL 1: CHAT */}
        <section className="panel">
          <div className="panel-title">
            <Icons.Send />
            Interaction
          </div>
          <div className="transcript" ref={transcriptRef}>
            {entries.length === 0 && <div className="empty">No activity recorded for this session.</div>}
            {entries.map((entry, index) => (
              <div className={`entry role-${entry.role}`} key={`${entry.time.toISOString()}-${index}`}>
                <div className="entry-meta">
                  <span>{entry.role}</span>
                  <span>{formatTime(entry.time)}</span>
                </div>
                <pre>{entry.content}</pre>
              </div>
            ))}
          </div>

          <div className="composer">
            <div className="mode-row">
              <button
                className={`chip ${composerMode === "llm" ? "chip-active" : ""}`}
                disabled={busy || interacting}
                onClick={() => setComposerMode("llm")}
              >
                LLM
              </button>
              <button
                className={`chip ${composerMode === "simulatedAssistant" ? "chip-active" : ""}`}
                disabled={busy || interacting}
                onClick={() => setComposerMode("simulatedAssistant")}
              >
                Simulated AI
              </button>
            </div>

            {composerMode === "llm" ? (
              <textarea
                className="input textarea"
                disabled={busy || interacting}
                value={composerInput}
                onChange={(event) => setComposerInput(event.target.value)}
                placeholder="Send a message to the AI..."
              />
            ) : (
              <textarea
                className="input textarea mono"
                disabled={busy || interacting}
                value={manualOutputInput}
                onChange={(event) => setManualOutputInput(event.target.value)}
                placeholder="<tool_call>...</tool_call>"
              />
            )}
            <button
              className="button"
              disabled={busy || interacting || (composerMode === "llm" ? !composerInput.trim() : !manualOutputInput.trim())}
              onClick={() => void sendComposer()}
            >
              <Icons.Send />
              {interacting ? "Running Loop..." : "Execute"}
            </button>
          </div>
        </section>

        {/* PANEL 2: SIMULATOR */}
        <section className="panel">
          <div className="panel-title">
            <Icons.Zap />
            Simulator
          </div>
          <div className="stack">
            <div className="mode-row">
              <button
                className={`chip ${simulatorMode === "create" ? "chip-active" : ""}`}
                disabled={busy || interacting}
                onClick={() => setSimulatorMode("create")}
              >
                Open App
              </button>
              <button
                className={`chip ${simulatorMode === "action" ? "chip-active" : ""}`}
                disabled={busy || interacting}
                onClick={() => setSimulatorMode("action")}
              >
                Window Action
              </button>
            </div>

            {simulatorMode === "create" ? (
              <div className="stack" style={{ padding: 0 }}>
                <div className="field">
                  <label>Application</label>
                  <select
                    className="input"
                    disabled={busy || interacting}
                    value={selectedCreateApp ?? ""}
                    onChange={(event) => setSelectedCreateApp(event.target.value)}
                  >
                    {apps.length === 0 && <option value="">No apps available</option>}
                    {apps.map((app) => (
                      <option key={app.name} value={app.name}>
                        {app.name} {app.isStarted ? "• Active" : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Target / Intent (optional)</label>
                  <input
                    className="input"
                    disabled={busy || interacting}
                    value={createTarget}
                    onChange={(event) => setCreateTarget(event.target.value)}
                    placeholder="e.g. 'open settings'"
                  />
                </div>
                <button className="button" disabled={busy || interacting || !selectedCreateApp} onClick={() => void simulateCreateToolCall()}>
                  Simulate Open
                </button>
              </div>
            ) : (
              <div className="stack" style={{ padding: 0 }}>
                <div className="field">
                  <label>Target Window</label>
                  <select
                    className="input"
                    disabled={busy || interacting}
                    value={selectedActionWindowId ?? ""}
                    onChange={(event) => onSelectActionWindow(event.target.value)}
                  >
                    {windows.length === 0 && <option value="">No active windows</option>}
                    {windows.map((window) => (
                      <option key={window.id} value={window.id}>
                        {window.id} ({window.appName ?? "unknown"})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="field">
                  <label>Action</label>
                  <select
                    className="input"
                    disabled={busy || interacting || !selectedWindow}
                    value={selectedActionId ?? ""}
                    onChange={(event) => onSelectAction(event.target.value)}
                  >
                    {!selectedWindow && <option value="">Select a window first</option>}
                    {selectedWindow?.actions.map((action) => (
                      <option key={action.id} value={action.id}>
                        {action.label} ({action.id}) {action.mode ? `• ${action.mode}` : ""}
                      </option>
                    ))}
                  </select>
                </div>

                {selectedAction ? (
                  <div className="stack" style={{ padding: 0 }}>
                    <div className="field">
                      <label>Action Parameters</label>
                      <div className="param-list">
                        {selectedAction.parameters.length === 0 && (
                          <div className="empty" style={{ padding: "10px" }}>
                            No parameters for this action.
                          </div>
                        )}
                        {selectedAction.parameters.map((param) => (
                          <div className="param-row" key={param.name}>
                            <span className="param-name">
                              {param.name} {param.required ? "*" : ""}
                            </span>
                            {renderParamEditor(param)}
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="row" style={{ marginTop: "8px" }}>
                      <button className="button" style={{ flex: 1 }} disabled={busy || interacting} onClick={() => void simulateActionToolCall()}>
                        Simulate Action
                      </button>
                      <button
                        className="button secondary"
                        style={{ flex: 1 }}
                        disabled={busy || interacting}
                        onClick={() => void invokeActionDirectly()}
                      >
                        Direct Invoke
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="empty" style={{ padding: "20px" }}>
                    Select an action to continue.
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        {/* PANEL 3: INSPECTOR */}
        <section className="panel">
          <div className="panel-title">
            <Icons.Terminal />
            System Inspector
          </div>
          <div className="mode-row" style={{ padding: "0 16px", marginTop: "12px" }}>
            <button className={`chip ${inspectorTab === "context" ? "chip-active" : ""}`} disabled={busy} onClick={() => setInspectorTab("context")}>
              Context
            </button>
            <button className={`chip ${inspectorTab === "llm" ? "chip-active" : ""}`} disabled={busy} onClick={() => setInspectorTab("llm")}>
              LLM Input
            </button>
            <button className={`chip ${inspectorTab === "windows" ? "chip-active" : ""}`} disabled={busy} onClick={() => setInspectorTab("windows")}>
              Windows ({windows.length})
            </button>
          </div>

          <div className="inspector-content stack" style={{ marginTop: "8px" }}>
            {inspectorTab === "context" && (
              <div className="stack" style={{ padding: 0, flex: 1 }}>
                <div className="field row" style={{ flexShrink: 0 }}>
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={includeObsolete}
                      disabled={busy || interacting}
                      onChange={(event) => {
                        const checked = event.target.checked;
                        setIncludeObsolete(checked);
                        if (selectedSessionId) {
                          void runGuarded(async () => {
                            await loadSessionState(selectedSessionId, checked);
                          });
                        }
                      }}
                    />
                    Show Obsolete Context
                  </label>
                </div>
                <pre className="block" style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
                  {rawContext.trim().length > 0 ? rawContext : "Empty context"}
                </pre>
              </div>
            )}

            {inspectorTab === "llm" && (
              <pre className="block" style={{ flex: 1, minHeight: 0, overflow: "auto", margin: 0 }}>
                {rawLlmInput.trim().length > 0 ? rawLlmInput : "No input data"}
              </pre>
            )}

            {inspectorTab === "windows" && (
              <div className="stack" style={{ padding: 0, overflowY: "auto", flex: 1, minHeight: 0 }}>
                {windows.length === 0 && <div className="empty">No windows found.</div>}
                {windows.map((window) => (
                  <details key={window.id}>
                    <summary>
                      {window.id} <span style={{ color: "var(--text-muted)", fontSize: "0.7rem" }}>• {window.appName}</span>
                    </summary>
                    <div className="block">
                      <div style={{ marginBottom: "8px", color: "var(--accent)" }}>// content</div>
                      {window.content}
                    </div>
                  </details>
                ))}
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
