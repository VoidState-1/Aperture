import { useEffect, useMemo, useRef, useState } from "react";
import { contextUiApi } from "./api";
import type {
  ActionParameterDef,
  AppInfo,
  ComposerMode,
  InteractionResponse,
  SessionInfo,
  SimulatorMode,
  TranscriptEntry,
  WindowAction,
  WindowInfo
} from "./types";

const DEFAULT_MANUAL_OUTPUT = `<tool_call>
{"name":"create","arguments":{"name":"launcher"}}
</tool_call>`;

const EMPTY_APPS: AppInfo[] = [];
const EMPTY_WINDOWS: WindowInfo[] = [];

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
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
  const time = `${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes()
  ).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
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
  const [baseUrl, setBaseUrl] = useState("http://localhost:5000");
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [actionParamText, setActionParamText] = useState<Record<string, string>>({});
  const [actionParamBool, setActionParamBool] = useState<Record<string, boolean | null>>({});

  const transcriptRef = useRef<HTMLDivElement>(null);

  const selectedWindow = useMemo(
    () => windows.find((window) => window.id === selectedActionWindowId) ?? null,
    [selectedActionWindowId, windows]
  );

  const selectedAction = useMemo(
    () => selectedWindow?.actions.find((action) => action.id === selectedActionId) ?? null,
    [selectedActionId, selectedWindow]
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
  }, [entries, busy]);

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
      return JSON.parse(raw);
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

  function applyInteractionResult(result: InteractionResponse): void {
    if (!result.success) {
      setEntries((prev) => [...prev, nowEntry("system", `Request failed: ${result.error ?? "unknown"}`)]);
      return;
    }

    const lines: string[] = [];
    if ((result.response ?? "").length > 0) {
      lines.push(result.response ?? "");
    }
    if (result.action) {
      lines.push(
        `[action] type=${result.action.type}, app=${result.action.appName}, window=${result.action.windowId}, actionId=${result.action.actionId}`
      );
    }
    if (result.actionResult) {
      lines.push(
        `[actionResult] success=${result.actionResult.success}, message=${result.actionResult.message ?? ""}, summary=${result.actionResult.summary ?? ""}`
      );
    }
    if (result.usage) {
      lines.push(
        `[usage] prompt=${result.usage.promptTokens}, completion=${result.usage.completionTokens}, total=${result.usage.totalTokens}`
      );
    }

    setEntries((prev) => [...prev, nowEntry("assistant", lines.join("\n"))]);
  }

  async function loadSessionState(
    sessionId: string,
    includeObsoleteValue = includeObsolete
  ): Promise<void> {
    const [nextWindows, nextApps, nextRawContext, nextRawLlmInput] = await Promise.all([
      contextUiApi.getWindows(baseUrl, sessionId),
      contextUiApi.getApps(baseUrl, sessionId),
      contextUiApi.getRawContext(baseUrl, sessionId, includeObsoleteValue),
      contextUiApi.getRawLlmInput(baseUrl, sessionId)
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

    const created = await contextUiApi.createSession(baseUrl);
    setSelectedSessionId(created.sessionId);
    setEntries((prev) => [...prev, nowEntry("system", `Auto-created session ${created.sessionId}`)]);

    await reloadSessionCatalog();
    return created.sessionId;
  }

  async function reloadSessionCatalog(autoCreateIfEmpty = false): Promise<void> {
    let nextSessions = await contextUiApi.getSessions(baseUrl);
    let nextSelected = selectedSessionId;

    if (nextSessions.length === 0 && autoCreateIfEmpty) {
      const created = await contextUiApi.createSession(baseUrl);
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
      const created = await contextUiApi.createSession(baseUrl);
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
      await contextUiApi.closeSession(baseUrl, sessionId);
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
    await runGuarded(async () => {
      const sessionId = await ensureSessionReady();
      if (!sessionId) return;

      if (composerMode === "llm") {
        const content = composerInput.trim();
        if (content.length === 0) {
          throw new Error("Message cannot be empty");
        }

        setComposerInput("");
        setEntries((prev) => [...prev, nowEntry("user", content)]);

        const result = await contextUiApi.interact(baseUrl, sessionId, content);
        applyInteractionResult(result);
      } else {
        const content = manualOutputInput.trim();
        if (content.length === 0) {
          throw new Error("Assistant output cannot be empty");
        }

        setEntries((prev) => [...prev, nowEntry("simulator", content)]);
        const result = await contextUiApi.simulateAssistantOutput(baseUrl, sessionId, content);
        applyInteractionResult(result);
      }

      await loadSessionState(sessionId);
    });
  }

  async function simulateToolCall(payload: Record<string, unknown>): Promise<void> {
    const sessionId = await ensureSessionReady();
    if (!sessionId) return;

    const assistantOutput = `<tool_call>\n${JSON.stringify(payload)}\n</tool_call>`;
    setEntries((prev) => [...prev, nowEntry("simulator", assistantOutput)]);
    const result = await contextUiApi.simulateAssistantOutput(baseUrl, sessionId, assistantOutput);
    applyInteractionResult(result);
    await loadSessionState(sessionId);
  }

  async function simulateCreateToolCall(): Promise<void> {
    await runGuarded(async () => {
      if (!selectedCreateApp || selectedCreateApp.trim().length === 0) {
        throw new Error("Select an app first");
      }

      const args: Record<string, unknown> = { name: selectedCreateApp };
      const target = createTarget.trim();
      if (target.length > 0) {
        args.target = target;
      }

      await simulateToolCall({ name: "create", arguments: args });
    });
  }

  async function simulateActionToolCall(): Promise<void> {
    await runGuarded(async () => {
      if (!selectedWindow || !selectedAction) {
        throw new Error("Select a window and action first");
      }

      const params = collectActionParams(selectedWindow, selectedAction);
      await simulateToolCall({
        name: "action",
        arguments: {
          window_id: selectedWindow.id,
          action_id: selectedAction.id,
          params
        }
      });
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
      const result = await contextUiApi.runWindowAction(
        baseUrl,
        sessionId,
        selectedWindow.id,
        selectedAction.id,
        params
      );

      setEntries((prev) => [
        ...prev,
        nowEntry(
          "system",
          `Direct invoke ${selectedWindow.id}.${selectedAction.id}: success=${result.success}, message=${result.message ?? ""}, summary=${result.summary ?? ""}`
        )
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
              [key]: next === "unset" ? null : next === "true"
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
          <p>Electron + React + TypeScript</p>
        </div>
        <button className="button secondary" disabled={busy} onClick={() => void refreshCurrentSession()}>
          Refresh
        </button>
      </header>

      <section className="card connection">
        <div className="field">
          <label>Server URL</label>
          <input
            className="input"
            disabled={busy}
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder="http://localhost:5000"
          />
        </div>
        <div className="field">
          <label>Session</label>
          <select
            className="input"
            disabled={busy}
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
          <button className="button secondary" disabled={busy} onClick={() => void runGuarded(() => reloadSessionCatalog(true))}>
            Reload
          </button>
          <button className="button" disabled={busy} onClick={() => void createSession()}>
            New Session
          </button>
          <button className="button danger" disabled={busy || !selectedSessionId} onClick={() => void deleteCurrentSession()}>
            Close Session
          </button>
        </div>
      </section>

      {error && (
        <section className="card error-banner">
          <strong>Error:</strong> {error}
        </section>
      )}

      <main className="panels">
        <section className="card panel">
          <div className="panel-title">Chat</div>
          <div className="transcript" ref={transcriptRef}>
            {entries.length === 0 && <div className="empty">No transcript yet.</div>}
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
                disabled={busy}
                onClick={() => setComposerMode("llm")}
              >
                LLM
              </button>
              <button
                className={`chip ${composerMode === "simulatedAssistant" ? "chip-active" : ""}`}
                disabled={busy}
                onClick={() => setComposerMode("simulatedAssistant")}
              >
                Simulated Assistant
              </button>
            </div>

            {composerMode === "llm" ? (
              <textarea
                className="input textarea"
                disabled={busy}
                value={composerInput}
                onChange={(event) => setComposerInput(event.target.value)}
                placeholder="Type user message..."
              />
            ) : (
              <textarea
                className="input textarea mono"
                disabled={busy}
                value={manualOutputInput}
                onChange={(event) => setManualOutputInput(event.target.value)}
                placeholder="<tool_call>...</tool_call>"
              />
            )}
            <button className="button" disabled={busy} onClick={() => void sendComposer()}>
              Send
            </button>
          </div>
        </section>

        <section className="card panel">
          <div className="panel-title">Simulator</div>
          <div className="mode-row">
            <button
              className={`chip ${simulatorMode === "create" ? "chip-active" : ""}`}
              disabled={busy}
              onClick={() => setSimulatorMode("create")}
            >
              Create
            </button>
            <button
              className={`chip ${simulatorMode === "action" ? "chip-active" : ""}`}
              disabled={busy}
              onClick={() => setSimulatorMode("action")}
            >
              Action
            </button>
          </div>

          {simulatorMode === "create" ? (
            <div className="stack">
              <div className="field">
                <label>App name</label>
                <select
                  className="input"
                  disabled={busy}
                  value={selectedCreateApp ?? ""}
                  onChange={(event) => setSelectedCreateApp(event.target.value)}
                >
                  {apps.length === 0 && <option value="">No app</option>}
                  {apps.map((app) => (
                    <option key={app.name} value={app.name}>
                      {app.name}
                      {app.isStarted ? " (started)" : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Target (optional)</label>
                <input
                  className="input"
                  disabled={busy}
                  value={createTarget}
                  onChange={(event) => setCreateTarget(event.target.value)}
                  placeholder="Intent/target for app launch"
                />
              </div>
              <button className="button" disabled={busy} onClick={() => void simulateCreateToolCall()}>
                Simulate tool_call
              </button>
            </div>
          ) : (
            <div className="stack">
              <div className="field">
                <label>Window</label>
                <select
                  className="input"
                  disabled={busy}
                  value={selectedActionWindowId ?? ""}
                  onChange={(event) => onSelectActionWindow(event.target.value)}
                >
                  {windows.length === 0 && <option value="">No window</option>}
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
                  disabled={busy || !selectedWindow}
                  value={selectedActionId ?? ""}
                  onChange={(event) => onSelectAction(event.target.value)}
                >
                  {!selectedWindow && <option value="">No action</option>}
                  {selectedWindow?.actions.map((action) => (
                    <option key={action.id} value={action.id}>
                      {action.id} ({action.label})
                    </option>
                  ))}
                </select>
              </div>

              {selectedAction ? (
                <>
                  <div className="field">
                    <label>Parameters</label>
                    <div className="param-list">
                      {selectedAction.parameters.length === 0 && (
                        <div className="empty small">This action has no parameters.</div>
                      )}
                      {selectedAction.parameters.map((param) => (
                        <div className="param-row" key={param.name}>
                          <span className="param-name">
                            {param.name} ({param.type})
                            {param.required ? " *" : ""}
                          </span>
                          {renderParamEditor(param)}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="row">
                    <button className="button" disabled={busy} onClick={() => void simulateActionToolCall()}>
                      Simulate tool_call
                    </button>
                    <button className="button secondary" disabled={busy} onClick={() => void invokeActionDirectly()}>
                      Invoke directly
                    </button>
                  </div>
                </>
              ) : (
                <div className="empty small">Select a window and action first.</div>
              )}
            </div>
          )}
        </section>

        <section className="card panel">
          <div className="panel-title">Inspector</div>
          <div className="field row">
            <label className="checkbox">
              <input
                type="checkbox"
                checked={includeObsolete}
                disabled={busy}
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
              includeObsolete
            </label>
          </div>

          <details open>
            <summary>Raw Context</summary>
            <pre className="mono block">{rawContext.trim().length > 0 ? rawContext : "No data loaded."}</pre>
          </details>

          <details open>
            <summary>Raw LLM Input</summary>
            <pre className="mono block">{rawLlmInput.trim().length > 0 ? rawLlmInput : "No data loaded."}</pre>
          </details>

          <details open>
            <summary>Windows ({windows.length})</summary>
            <div className="stack">
              {windows.length === 0 && <div className="empty small">No windows in current session.</div>}
              {windows.map((window) => (
                <details key={window.id}>
                  <summary>
                    {window.id} ({window.appName ?? "unknown"}) | createdAt={window.createdAt} updatedAt=
                    {window.updatedAt}
                  </summary>
                  <pre className="mono block">{window.content}</pre>
                  <div className="chips">
                    {window.actions.map((action) => (
                      <span className="chip mini" key={`${window.id}-${action.id}`}>
                        {action.id}
                        {action.parameters.length > 0 ? ` (${action.parameters.length})` : ""}
                      </span>
                    ))}
                  </div>
                </details>
              ))}
            </div>
          </details>
        </section>
      </main>
    </div>
  );
}
