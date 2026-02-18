import type { AppInfo, SimulatorMode, WindowInfo } from "../types";

export type DebugInspectorTab = "context" | "llm" | "windows";

interface DebugConsoleProps {
  busy: boolean;
  interacting: boolean;
  baseUrl: string;
  includeObsolete: boolean;
  onBaseUrlChange: (value: string) => void;
  onIncludeObsoleteChange: (value: boolean) => void;
  simulatorMode: SimulatorMode;
  onSimulatorModeChange: (mode: SimulatorMode) => void;
  apps: AppInfo[];
  selectedCreateApp: string | null;
  createTarget: string;
  onSelectedCreateAppChange: (value: string) => void;
  onCreateTargetChange: (value: string) => void;
  onSimulateCreate: () => void;
  windows: WindowInfo[];
  selectedWindow: WindowInfo | null;
  selectedActionWindowId: string | null;
  manualActionId: string;
  manualActionParams: string;
  onSelectActionWindow: (windowId: string) => void;
  onManualActionIdChange: (value: string) => void;
  onManualActionParamsChange: (value: string) => void;
  onSimulateAction: () => void;
  onDirectInvoke: () => void;
  inspectorTab: DebugInspectorTab;
  onInspectorTabChange: (tab: DebugInspectorTab) => void;
  rawContext: string;
  rawLlmInput: string;
}

/**
 * 右侧调试面板。
 */
export function DebugConsole(props: DebugConsoleProps): JSX.Element {
  const {
    busy,
    interacting,
    baseUrl,
    includeObsolete,
    onBaseUrlChange,
    onIncludeObsoleteChange,
    simulatorMode,
    onSimulatorModeChange,
    apps,
    selectedCreateApp,
    createTarget,
    onSelectedCreateAppChange,
    onCreateTargetChange,
    onSimulateCreate,
    windows,
    selectedWindow,
    selectedActionWindowId,
    manualActionId,
    manualActionParams,
    onSelectActionWindow,
    onManualActionIdChange,
    onManualActionParamsChange,
    onSimulateAction,
    onDirectInvoke,
    inspectorTab,
    onInspectorTabChange,
    rawContext,
    rawLlmInput
  } = props;

  return (
    <aside className="aci-debug">
      <header className="aci-debug-header">Debug Console</header>

      <section className="aci-debug-section">
        <div className="aci-section-title">Connection</div>
        <label className="aci-field-label">Server URL</label>
        <input className="aci-input" disabled={busy || interacting} value={baseUrl} onChange={(event) => onBaseUrlChange(event.target.value)} />
        <label className="aci-checkbox">
          <input type="checkbox" checked={includeObsolete} disabled={busy || interacting} onChange={(event) => onIncludeObsoleteChange(event.target.checked)} />
          Include obsolete context
        </label>
      </section>

      <section className="aci-debug-section">
        <div className="aci-section-title">Simulator</div>
        <div className="aci-chip-row">
          <button className={`aci-chip ${simulatorMode === "create" ? "is-active" : ""}`} disabled={busy || interacting} onClick={() => onSimulatorModeChange("create")}>
            Open App
          </button>
          <button className={`aci-chip ${simulatorMode === "action" ? "is-active" : ""}`} disabled={busy || interacting} onClick={() => onSimulatorModeChange("action")}>
            Action
          </button>
        </div>

        {simulatorMode === "create" ? (
          <>
            <label className="aci-field-label">Application</label>
            <select className="aci-input" disabled={busy || interacting} value={selectedCreateApp ?? ""} onChange={(event) => onSelectedCreateAppChange(event.target.value)}>
              {apps.length === 0 && <option value="">No app</option>}
              {apps.map((app) => (
                <option key={app.name} value={app.name}>
                  {app.name} {app.isStarted ? "(started)" : ""}
                </option>
              ))}
            </select>

            <label className="aci-field-label">Target (optional)</label>
            <input className="aci-input" disabled={busy || interacting} value={createTarget} onChange={(event) => onCreateTargetChange(event.target.value)} placeholder="e.g. docs" />

            <button className="aci-button aci-button-primary" disabled={busy || interacting || !selectedCreateApp} onClick={onSimulateCreate}>
              Simulate Open
            </button>
          </>
        ) : (
          <>
            <label className="aci-field-label">Window</label>
            <select className="aci-input" disabled={busy || interacting} value={selectedActionWindowId ?? ""} onChange={(event) => onSelectActionWindow(event.target.value)}>
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
              onChange={(event) => onManualActionIdChange(event.target.value)}
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
              onChange={(event) => onManualActionParamsChange(event.target.value)}
              placeholder='e.g. {"summary":"done"}'
            />

            <div className="aci-inline-buttons">
              <button className="aci-button aci-button-primary" disabled={busy || interacting || !selectedWindow || !manualActionId.trim()} onClick={onSimulateAction}>
                Simulate
              </button>
              <button className="aci-button aci-button-ghost" disabled={busy || interacting || !selectedWindow || !manualActionId.trim()} onClick={onDirectInvoke}>
                Direct
              </button>
            </div>
          </>
        )}
      </section>

      <section className="aci-debug-section aci-grow">
        <div className="aci-section-title">Inspector</div>
        <div className="aci-chip-row">
          <button className={`aci-chip ${inspectorTab === "context" ? "is-active" : ""}`} disabled={busy} onClick={() => onInspectorTabChange("context")}>
            Context
          </button>
          <button className={`aci-chip ${inspectorTab === "llm" ? "is-active" : ""}`} disabled={busy} onClick={() => onInspectorTabChange("llm")}>
            LLM
          </button>
          <button className={`aci-chip ${inspectorTab === "windows" ? "is-active" : ""}`} disabled={busy} onClick={() => onInspectorTabChange("windows")}>
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
  );
}
