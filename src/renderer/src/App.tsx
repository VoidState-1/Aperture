import { useEffect, useMemo, useRef, useState } from "react";
import { ACIApi } from "./api";
import type {
  AppInfo,
  ComposerMode,
  InteractionResponse,
  SessionInfo,
  SimulatorMode,
  TranscriptEntry,
  WindowInfo
} from "./types";

const DEFAULT_BASE_URL = "http://localhost:5228";
const DEFAULT_MANUAL_OUTPUT = `<action_call>
{"calls":[{"window_id":"launcher","action_id":"launcher.open","params":{"app":"file_explorer"}}]}
</action_call>`;

const EMPTY_APPS: AppInfo[] = [];
const EMPTY_WINDOWS: WindowInfo[] = [];

type InspectorTab = "context" | "llm" | "windows";

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
  return `Session #${sessionShortId(session.sessionId)} · ${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes()
  ).padStart(2, "0")}`;
}

function errorText(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err ?? "unknown error");
}

function isAssistantTimelineType(type: string): boolean {
  const normalized = type.trim().toLowerCase().replace(/[\s_-]/g, "");
  return normalized.startsWith("assistant");
}

export function App(): JSX.Element {
  const [baseUrl, setBaseUrl] = useState(DEFAULT_BASE_URL);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);

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
  const [manualActionId, setManualActionId] = useState("");
  const [manualActionParams, setManualActionParams] = useState("{}");

  const [includeObsolete, setIncludeObsolete] = useState(true);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("windows");
  const [busy, setBusy] = useState(false);
  const [interacting, setInteracting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const transcriptRef = useRef<HTMLDivElement>(null);
  const pollTimerRef = useRef<number | null>(null);
  const seenAssistantSeqRef = useRef<Set<number>>(new Set());

  const activeSession = useMemo(
    () => sessions.find((session) => session.sessionId === selectedSessionId) ?? null,
    [selectedSessionId, sessions]
  );

  const selectedWindow = useMemo(
    () => windows.find((window) => window.id === selectedActionWindowId) ?? null,
    [selectedActionWindowId, windows]
  );

  useEffect(() => {
    void runGuarded(async () => {
      await reloadSessionCatalog(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!transcriptRef.current) return;
    transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight + 80;
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

  function suggestActionId(window: WindowInfo | null): string {
    if (!window || window.namespaces.length === 0) {
      return "";
    }

    return `${window.namespaces[0]}.`;
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

    setSelectedCreateApp(createApp);
    setSelectedActionWindowId(windowId);

    if (!manualActionId.trim()) {
      const window = nextWindows.find((item) => item.id === windowId) ?? null;
      setManualActionId(suggestActionId(window));
    }
  }

  function collectActionParams(): unknown {
    const raw = manualActionParams.trim();
    if (raw.length === 0) {
      return null;
    }

    try {
      return JSON.parse(raw);
    } catch (e) {
      throw new Error(`Invalid params JSON: ${errorText(e)}`);
    }
  }

  async function loadSessionAgentState(
    sessionId: string,
    agentId: string,
    includeObsoleteValue = includeObsolete
  ): Promise<void> {
    const [nextWindows, nextApps, nextRawContext, nextRawLlmInput] = await Promise.all([
      ACIApi.getWindows(baseUrl, sessionId, agentId),
      ACIApi.getApps(baseUrl, sessionId, agentId),
      ACIApi.getRawContext(baseUrl, sessionId, agentId, includeObsoleteValue),
      ACIApi.getRawLlmInput(baseUrl, sessionId, agentId)
    ]);

    setWindows(nextWindows);
    setApps(nextApps);
    setRawContext(nextRawContext);
    setRawLlmInput(nextRawLlmInput);
    syncSimulatorSelections(nextApps, nextWindows);
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

    setApps(EMPTY_APPS);
    setWindows(EMPTY_WINDOWS);
    setRawContext("");
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
        `[action] type=${result.action.type}, app=${result.action.appName}, window=${result.action.windowId}, actionId=${result.action.actionId}`
      );
    }
    if (result.actionResult) {
      lines.push(
        `[actionResult] success=${result.actionResult.success}, message=${result.actionResult.message ?? ""}, summary=${result.actionResult.summary ?? ""}`
      );
    }
    if (result.steps && result.steps.length > 0) {
      for (const step of result.steps) {
        lines.push(
          `[step] call=${step.callId}, turn=${step.turn}, idx=${step.index}, mode=${step.resolvedMode}, target=${step.windowId}.${step.actionId}, success=${step.success}, task=${step.taskId ?? ""}`
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

  async function sendComposer(): Promise<void> {
    const context = await ensureSessionReady();
    if (!context) {
      setError("No active agent.");
      return;
    }

    const { sessionId, agentId } = context;

    if (composerMode !== "llm") {
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

  async function simulateCreateToolCall(): Promise<void> {
    await runGuarded(async () => {
      if (!selectedCreateApp) {
        throw new Error("Select an app first.");
      }

      const params: Record<string, unknown> = { app: selectedCreateApp };
      const target = createTarget.trim();
      if (target) {
        params.target = target;
      }

      await simulateToolCall([
        {
          window_id: "launcher",
          action_id: "launcher.open",
          params
        }
      ]);
    });
  }

  async function simulateActionToolCall(): Promise<void> {
    await runGuarded(async () => {
      if (!selectedWindow) {
        throw new Error("Select a window first.");
      }

      const actionId = manualActionId.trim();
      if (!actionId) {
        throw new Error("Enter action id (namespace.action).");
      }

      const params = collectActionParams();
      await simulateToolCall([
        {
          window_id: selectedWindow.id,
          action_id: actionId,
          params
        }
      ]);
    });
  }

  async function invokeActionDirectly(): Promise<void> {
    await runGuarded(async () => {
      const context = await ensureSessionReady();
      if (!context) {
        throw new Error("No active agent.");
      }

      if (!selectedWindow) {
        throw new Error("Select a window first.");
      }

      const actionId = manualActionId.trim();
      if (!actionId) {
        throw new Error("Enter action id (namespace.action).");
      }

      const { sessionId, agentId } = context;
      const params = collectActionParams();
      const result = await ACIApi.runWindowAction(baseUrl, sessionId, agentId, selectedWindow.id, actionId, params);

      setEntries((prev) => [
        ...prev,
        nowEntry(
          "system",
          `Direct invoke ${selectedWindow.id}.${actionId}: success=${result.success}, message=${result.message ?? ""}, summary=${result.summary ?? ""}`
        )
      ]);

      await loadSessionAgentState(sessionId, agentId);
    });
  }

  function onSelectActionWindow(windowId: string): void {
    setSelectedActionWindowId(windowId);
    if (!manualActionId.trim()) {
      const window = windows.find((item) => item.id === windowId) ?? null;
      setManualActionId(suggestActionId(window));
    }
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
      <aside className="aci-sidebar">
        <div className="aci-brand">
          <div className="aci-brand-dot" />
          <div>
            <div className="aci-brand-title">Aperture</div>
            <div className="aci-brand-sub">ACI Workbench</div>
          </div>
        </div>

        <button className="aci-button aci-button-primary aci-full" disabled={busy || interacting} onClick={() => void createSession()}>
          + New Session
        </button>

        <div className="aci-sidebar-label">Sessions</div>
        <div className="aci-session-list">
          {sessions.length === 0 && <div className="aci-empty">No session found.</div>}
          {sessions.map((session) => (
            <div key={session.sessionId} className={`aci-session-card ${session.sessionId === selectedSessionId ? "is-active" : ""}`}>
              <button
                className="aci-session-head"
                disabled={busy || interacting || session.agents.length === 0}
                onClick={() => {
                  const fallbackAgentId = session.agents[0]?.agentId ?? null;
                  if (fallbackAgentId) {
                    void selectSessionAgent(session.sessionId, fallbackAgentId);
                  }
                }}
              >
                <span>{formatSessionTitle(session)}</span>
                <span>{session.agentCount} agents</span>
              </button>
              <div className="aci-agent-list">
                {session.agents.map((agent) => (
                  <button
                    key={agent.agentId}
                    className={`aci-agent-item ${
                      session.sessionId === selectedSessionId && agent.agentId === selectedAgentId ? "is-active" : ""
                    }`}
                    disabled={busy || interacting}
                    onClick={() => void selectSessionAgent(session.sessionId, agent.agentId)}
                  >
                    <span>{agent.name ?? agent.agentId}</span>
                    <small>{agent.role ?? "agent"}</small>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="aci-sidebar-foot">
          <button className="aci-button aci-button-ghost aci-full" disabled={busy || interacting} onClick={() => void refreshCurrent()}>
            Refresh
          </button>
          <button
            className="aci-button aci-button-danger aci-full"
            disabled={busy || interacting || !selectedSessionId}
            onClick={() => void deleteCurrentSession()}
          >
            Close Session
          </button>
        </div>
      </aside>

      <section className="aci-center">
        <header className="aci-center-header">
          <div className="aci-breadcrumb">
            <span>{activeSession ? `Session #${sessionShortId(activeSession.sessionId)}` : "No Session"}</span>
            <span>/</span>
            <span>{selectedAgentId ?? "No Agent"}</span>
          </div>
          <div className="aci-compact-actions">
            <button className="aci-icon-button" disabled={busy || interacting} onClick={() => void refreshCurrent()}>
              ↻
            </button>
          </div>
        </header>

        <div className="aci-system-banner">
          System initialized. Active endpoint: <strong>{baseUrl}</strong>
        </div>

        {error && <div className="aci-error-banner">Request failed: {error}</div>}

        <div className="aci-transcript" ref={transcriptRef}>
          {entries.length === 0 && <div className="aci-empty">Start by sending a message.</div>}
          {entries.map((entry, index) => (
            <article key={`${entry.time.toISOString()}-${index}`} className={`aci-entry role-${entry.role}`}>
              <header>
                <span>{entry.role.toUpperCase()}</span>
                <span>{formatTime(entry.time)}</span>
              </header>
              <pre>{entry.content}</pre>
            </article>
          ))}
        </div>

        <footer className="aci-composer">
          <div className="aci-chip-row">
            <button
              className={`aci-chip ${composerMode === "llm" ? "is-active" : ""}`}
              disabled={busy || interacting}
              onClick={() => setComposerMode("llm")}
            >
              LLM
            </button>
            <button
              className={`aci-chip ${composerMode === "simulatedAssistant" ? "is-active" : ""}`}
              disabled={busy || interacting}
              onClick={() => setComposerMode("simulatedAssistant")}
            >
              Simulated
            </button>
          </div>

          {composerMode === "llm" ? (
            <textarea
              className="aci-input aci-textarea"
              disabled={busy || interacting}
              value={composerInput}
              onChange={(event) => setComposerInput(event.target.value)}
              placeholder="Type a message..."
            />
          ) : (
            <textarea
              className="aci-input aci-textarea aci-mono"
              disabled={busy || interacting}
              value={manualOutputInput}
              onChange={(event) => setManualOutputInput(event.target.value)}
              placeholder="<action_call>...</action_call>"
            />
          )}

          <button
            className="aci-button aci-button-primary"
            disabled={busy || interacting || (composerMode === "llm" ? !composerInput.trim() : !manualOutputInput.trim())}
            onClick={() => void sendComposer()}
          >
            {interacting ? "Running Loop..." : "Send"}
          </button>
        </footer>
      </section>

      <aside className="aci-debug">
        <header className="aci-debug-header">Debug Console</header>

        <section className="aci-debug-section">
          <div className="aci-section-title">Connection</div>
          <label className="aci-field-label">Server URL</label>
          <input
            className="aci-input"
            disabled={busy || interacting}
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder={DEFAULT_BASE_URL}
          />
          <label className="aci-checkbox">
            <input
              type="checkbox"
              checked={includeObsolete}
              disabled={busy || interacting}
              onChange={(event) => {
                const checked = event.target.checked;
                setIncludeObsolete(checked);
                if (selectedSessionId && selectedAgentId) {
                  void runGuarded(async () => {
                    await loadSessionAgentState(selectedSessionId, selectedAgentId, checked);
                  });
                }
              }}
            />
            Include obsolete context
          </label>
        </section>

        <section className="aci-debug-section">
          <div className="aci-section-title">Simulator</div>
          <div className="aci-chip-row">
            <button
              className={`aci-chip ${simulatorMode === "create" ? "is-active" : ""}`}
              disabled={busy || interacting}
              onClick={() => setSimulatorMode("create")}
            >
              Open App
            </button>
            <button
              className={`aci-chip ${simulatorMode === "action" ? "is-active" : ""}`}
              disabled={busy || interacting}
              onClick={() => setSimulatorMode("action")}
            >
              Action
            </button>
          </div>

          {simulatorMode === "create" ? (
            <>
              <label className="aci-field-label">Application</label>
              <select
                className="aci-input"
                disabled={busy || interacting}
                value={selectedCreateApp ?? ""}
                onChange={(event) => setSelectedCreateApp(event.target.value)}
              >
                {apps.length === 0 && <option value="">No app</option>}
                {apps.map((app) => (
                  <option key={app.name} value={app.name}>
                    {app.name} {app.isStarted ? "(started)" : ""}
                  </option>
                ))}
              </select>

              <label className="aci-field-label">Target (optional)</label>
              <input
                className="aci-input"
                disabled={busy || interacting}
                value={createTarget}
                onChange={(event) => setCreateTarget(event.target.value)}
                placeholder="e.g. docs"
              />

              <button className="aci-button aci-button-primary" disabled={busy || interacting || !selectedCreateApp} onClick={() => void simulateCreateToolCall()}>
                Simulate Open
              </button>
            </>
          ) : (
            <>
              <label className="aci-field-label">Window</label>
              <select
                className="aci-input"
                disabled={busy || interacting}
                value={selectedActionWindowId ?? ""}
                onChange={(event) => onSelectActionWindow(event.target.value)}
              >
                {windows.length === 0 && <option value="">No window</option>}
                {windows.map((window) => (
                  <option key={window.id} value={window.id}>
                    {window.id}
                  </option>
                ))}
              </select>

              <label className="aci-field-label">Action</label>
              <input
                className="aci-input"
                disabled={busy || interacting || !selectedWindow}
                value={manualActionId}
                onChange={(event) => setManualActionId(event.target.value)}
                placeholder="e.g. system.close"
              />

              {selectedWindow && (
                <div className="aci-hint">
                  Visible namespaces: {selectedWindow.namespaces.length > 0 ? selectedWindow.namespaces.join(", ") : "none"}
                </div>
              )}

              <label className="aci-field-label">Params JSON</label>
              <textarea
                className="aci-input aci-textarea aci-mono"
                disabled={busy || interacting}
                value={manualActionParams}
                onChange={(event) => setManualActionParams(event.target.value)}
                placeholder='e.g. {"summary":"done"}'
              />

              <div className="aci-inline-buttons">
                <button className="aci-button aci-button-primary" disabled={busy || interacting || !selectedWindow || !manualActionId.trim()} onClick={() => void simulateActionToolCall()}>
                  Simulate
                </button>
                <button className="aci-button aci-button-ghost" disabled={busy || interacting || !selectedWindow || !manualActionId.trim()} onClick={() => void invokeActionDirectly()}>
                  Direct
                </button>
              </div>
            </>
          )}
        </section>

        <section className="aci-debug-section aci-grow">
          <div className="aci-section-title">Inspector</div>
          <div className="aci-chip-row">
            <button className={`aci-chip ${inspectorTab === "context" ? "is-active" : ""}`} disabled={busy} onClick={() => setInspectorTab("context")}>
              Context
            </button>
            <button className={`aci-chip ${inspectorTab === "llm" ? "is-active" : ""}`} disabled={busy} onClick={() => setInspectorTab("llm")}>
              LLM
            </button>
            <button className={`aci-chip ${inspectorTab === "windows" ? "is-active" : ""}`} disabled={busy} onClick={() => setInspectorTab("windows")}>
              Windows
            </button>
          </div>

          {inspectorTab === "context" && <pre className="aci-block">{rawContext || "Empty context."}</pre>}
          {inspectorTab === "llm" && <pre className="aci-block">{rawLlmInput || "Empty llm input."}</pre>}
          {inspectorTab === "windows" && (
            <div className="aci-window-list">
              {windows.length === 0 && <div className="aci-empty">No windows.</div>}
              {windows.map((window) => (
                <details key={window.id}>
                  <summary>
                    {window.id} <small>{window.appName ?? "unknown"}</small>
                  </summary>
                  <pre className="aci-block">{window.content}</pre>
                </details>
              ))}
            </div>
          )}
        </section>
      </aside>
    </div>
  );
}
