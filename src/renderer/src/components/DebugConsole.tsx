import type { WindowInfo } from "../types";

interface DebugConsoleProps {
  busy: boolean;
  interacting: boolean;
  baseUrl: string;
  onBaseUrlChange: (value: string) => void;
  windows: WindowInfo[];
  selectedToolWindowId: string | null;
  onUseAsToolTarget: (windowId: string, actionId?: string) => void;
}

/**
 * Right panel with connection settings and window inspector list.
 */
export function DebugConsole(props: DebugConsoleProps): JSX.Element {
  const { busy, interacting, baseUrl, onBaseUrlChange, windows, selectedToolWindowId, onUseAsToolTarget } = props;

  return (
    <aside className="aci-debug">
      <header className="aci-debug-header">Inspector</header>

      <section className="aci-debug-section">
        <div className="aci-section-title">Connection</div>
        <label className="aci-field-label">Server URL</label>
        <input className="aci-input" disabled={busy || interacting} value={baseUrl} onChange={(event) => onBaseUrlChange(event.target.value)} />
      </section>

      <section className="aci-debug-section aci-grow">
        <div className="aci-section-title">Windows</div>
        <div className="aci-window-list">
          {windows.length === 0 && <div className="aci-empty">No windows.</div>}
          {windows.map((window) => (
            <details key={window.id} open={selectedToolWindowId === window.id}>
              <summary>
                <div className="aci-window-summary">
                  <span className="aci-window-id">{window.id}</span>
                  <span className="aci-window-tag">{window.appName ?? "native"}</span>
                </div>
              </summary>
              <div className="aci-window-inspector">
                <div className="aci-label">Actions</div>
                <div className="aci-action-buttons">
                  {window.actions.length === 0 && <div className="aci-empty">No actions.</div>}
                  {window.actions.map((action) => (
                    <button
                      key={action.id}
                      className="aci-action-chip"
                      disabled={busy || interacting}
                      onClick={() => onUseAsToolTarget(window.id, action.id)}
                      title={action.label}
                    >
                      {action.id}
                    </button>
                  ))}
                </div>

                <div className="aci-label-row">
                  <div className="aci-label">Content</div>
                  <button className="aci-text-button" disabled={busy || interacting} onClick={() => onUseAsToolTarget(window.id)}>
                    Use Window
                  </button>
                </div>
                <pre className="aci-block aci-small">{window.content}</pre>
              </div>
            </details>
          ))}
        </div>
      </section>
    </aside>
  );
}
