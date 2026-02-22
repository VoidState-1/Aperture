import type { MutableRefObject } from "react";
import type { CenterViewMode, ComposerMode, SessionInfo, ToolFormField, TranscriptEntry, WindowAction, WindowInfo } from "../types";

interface ConversationPanelProps {
  activeSession: SessionInfo | null;
  selectedAgentId: string | null;
  baseUrl: string;
  error: string | null;
  entries: TranscriptEntry[];
  transcriptRef: MutableRefObject<HTMLDivElement | null>;
  busy: boolean;
  interacting: boolean;
  viewMode: CenterViewMode;
  rawLlmInput: string;
  composerMode: ComposerMode;
  composerInput: string;
  manualOutputInput: string;
  toolWindowOptions: string[];
  selectedToolWindow: WindowInfo | null;
  selectedToolWindowId: string | null;
  selectedToolActions: WindowAction[];
  selectedToolActionId: string;
  selectedToolAction: WindowAction | null;
  toolFormFields: ToolFormField[];
  toolFormValues: Record<string, string>;
  fallbackToolParamsJson: string;
  appOptions: string[];
  onSetViewMode: (mode: CenterViewMode) => void;
  onSetComposerMode: (mode: ComposerMode) => void;
  onComposerInputChange: (value: string) => void;
  onManualOutputInputChange: (value: string) => void;
  onSelectToolWindow: (windowId: string) => void;
  onSelectToolAction: (actionId: string) => void;
  onToolFieldValueChange: (path: string, value: string) => void;
  onFallbackToolParamsJsonChange: (value: string) => void;
  onSend: () => void;
  onRefresh: () => void;
  formatEntryTime: (value: Date) => string;
  sessionShortId: (sessionId: string) => string;
}

function kindDisplay(kind: ToolFormField["kind"]): string {
  return kind;
}

/**
 * Main center panel with rendered and raw-LLM views.
 */
export function ConversationPanel(props: ConversationPanelProps): JSX.Element {
  const {
    activeSession,
    selectedAgentId,
    baseUrl,
    error,
    entries,
    transcriptRef,
    busy,
    interacting,
    viewMode,
    rawLlmInput,
    composerMode,
    composerInput,
    manualOutputInput,
    toolWindowOptions,
    selectedToolWindow,
    selectedToolWindowId,
    selectedToolActions,
    selectedToolActionId,
    selectedToolAction,
    toolFormFields,
    toolFormValues,
    fallbackToolParamsJson,
    appOptions,
    onSetViewMode,
    onSetComposerMode,
    onComposerInputChange,
    onManualOutputInputChange,
    onSelectToolWindow,
    onSelectToolAction,
    onToolFieldValueChange,
    onFallbackToolParamsJsonChange,
    onSend,
    onRefresh,
    formatEntryTime,
    sessionShortId,
  } = props;

  const canSendByMode =
    composerMode === "llm"
      ? composerInput.trim().length > 0
      : composerMode === "simulatedAssistant"
        ? manualOutputInput.trim().length > 0
        : !!selectedToolWindowId && selectedToolActionId.trim().length > 0;

  return (
    <section className="aci-center">
      <header className="aci-center-header">
        <div className="aci-breadcrumb">
          <span>{activeSession ? `Session #${sessionShortId(activeSession.sessionId)}` : "No Session"}</span>
          <span>/</span>
          <span>{selectedAgentId ?? "No Agent"}</span>
        </div>
        <div className="aci-compact-actions">
          <div className="aci-chip-row">
            <button className={`aci-chip ${viewMode === "rendered" ? "is-active" : ""}`} disabled={busy} onClick={() => onSetViewMode("rendered")}>
              Rendered
            </button>
            <button className={`aci-chip ${viewMode === "llmRaw" ? "is-active" : ""}`} disabled={busy} onClick={() => onSetViewMode("llmRaw")}>
              LLM Raw
            </button>
          </div>
          <button className="aci-icon-button" disabled={busy || interacting} onClick={onRefresh}>
            R
          </button>
        </div>
      </header>

      <div className="aci-system-banner">
        System initialized. Active endpoint: <strong>{baseUrl}</strong>
      </div>

      {error && <div className="aci-error-banner">Request failed: {error}</div>}

      {viewMode === "rendered" ? (
        <div className="aci-transcript" ref={transcriptRef}>
          {entries.length === 0 && <div className="aci-empty">Start by sending a message.</div>}
          {entries.map((entry, index) => (
            <article key={`${entry.time.toISOString()}-${index}`} className={`aci-entry role-${entry.role}`}>
              <header>
                <span>{entry.role.toUpperCase()}</span>
                <span>{formatEntryTime(entry.time)}</span>
              </header>
              <pre>{entry.content}</pre>
            </article>
          ))}
        </div>
      ) : (
        <div className="aci-raw-view">
          <pre className="aci-block aci-block-fill aci-mono">{rawLlmInput || "Empty llm input."}</pre>
        </div>
      )}

      <footer className="aci-composer">
        <div className="aci-chip-row">
          <button
            className={`aci-chip ${composerMode === "llm" ? "is-active" : ""}`}
            disabled={busy || interacting}
            onClick={() => onSetComposerMode("llm")}
          >
            User
          </button>
          <button
            className={`aci-chip ${composerMode === "simulatedAssistant" ? "is-active" : ""}`}
            disabled={busy || interacting}
            onClick={() => onSetComposerMode("simulatedAssistant")}
          >
            Sim Assistant
          </button>
          <button
            className={`aci-chip ${composerMode === "toolCall" ? "is-active" : ""}`}
            disabled={busy || interacting}
            onClick={() => onSetComposerMode("toolCall")}
          >
            Tool Call
          </button>
        </div>

        {composerMode === "llm" && (
          <textarea
            className="aci-input aci-textarea"
            disabled={busy || interacting}
            value={composerInput}
            onChange={(event) => onComposerInputChange(event.target.value)}
            placeholder="Type a message..."
          />
        )}

        {composerMode === "simulatedAssistant" && (
          <textarea
            className="aci-input aci-textarea aci-mono"
            disabled={busy || interacting}
            value={manualOutputInput}
            onChange={(event) => onManualOutputInputChange(event.target.value)}
            placeholder="<action_call>...</action_call>"
          />
        )}

        {composerMode === "toolCall" && (
          <div className="aci-tool-simulator">
            <div className="aci-tool-grid">
              <div>
                <label className="aci-field-label">Window</label>
                <select
                  className="aci-input"
                  disabled={busy || interacting}
                  value={selectedToolWindowId ?? ""}
                  onChange={(event) => onSelectToolWindow(event.target.value)}
                >
                  {toolWindowOptions.length === 0 && <option value="">No window</option>}
                  {toolWindowOptions.map((windowId) => (
                    <option key={windowId} value={windowId}>
                      {windowId}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="aci-field-label">Action</label>
                <select
                  className="aci-input"
                  disabled={busy || interacting || !selectedToolWindowId}
                  value={selectedToolActionId}
                  onChange={(event) => onSelectToolAction(event.target.value)}
                >
                  {selectedToolActions.length === 0 && <option value="">No action</option>}
                  {selectedToolActions.map((action) => (
                    <option key={action.id} value={action.id}>
                      {action.label || action.id}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {selectedToolWindow && (
              <div className="aci-hint">
                Visible namespaces: {selectedToolWindow.namespaces.length > 0 ? selectedToolWindow.namespaces.join(", ") : "none"}
              </div>
            )}

            {selectedToolAction?.paramSchema && (
              <div className="aci-hint">Params schema is detected. Fill fields below, and the request payload will be generated automatically.</div>
            )}

            {selectedToolAction?.paramSchema == null && (
              <div className="aci-hint">No schema provided for this action. Use raw JSON params as fallback.</div>
            )}

            {selectedToolAction?.paramSchema && toolFormFields.length > 0 && (
              <div className="aci-param-form">
                {toolFormFields.map((field) => {
                  const value = toolFormValues[field.path] ?? "";
                  const isLauncherAppField = selectedToolAction.id === "launcher.open" && field.path === "app";
                  const labelClass = field.required ? "aci-param-required" : "aci-param-optional";

                  return (
                    <div key={`${selectedToolAction.id}:${field.path}`} className="aci-param-item">
                      <div className="aci-param-meta">
                        <div className="aci-param-title">
                          <span>{field.label}</span>
                          <div className="aci-chip-row">
                            <span className={labelClass}>{field.required ? "required" : "optional"}</span>
                            <span className="aci-param-kind">{kindDisplay(field.kind)}</span>
                          </div>
                        </div>
                        {field.description && <div className="aci-param-desc">{field.description}</div>}
                      </div>

                      <div className="aci-param-input-wrapper">
                        {field.kind === "boolean" && (
                          <select
                            className="aci-input"
                            disabled={busy || interacting}
                            value={value}
                            onChange={(event) => onToolFieldValueChange(field.path, event.target.value)}
                          >
                            {!field.required && <option value="">(omit)</option>}
                            <option value="true">true</option>
                            <option value="false">false</option>
                          </select>
                        )}

                        {field.kind === "null" && <div className="aci-param-null">null literal</div>}

                        {(field.kind === "number" || field.kind === "integer") && (
                          <input
                            className="aci-input aci-mono"
                            type="number"
                            step={field.kind === "integer" ? "1" : "any"}
                            disabled={busy || interacting}
                            value={value}
                            onChange={(event) => onToolFieldValueChange(field.path, event.target.value)}
                            placeholder={field.required ? "required" : "optional"}
                          />
                        )}

                        {field.kind === "string" && isLauncherAppField && appOptions.length > 0 && (
                          <select
                            className="aci-input"
                            disabled={busy || interacting}
                            value={value}
                            onChange={(event) => onToolFieldValueChange(field.path, event.target.value)}
                          >
                            {!field.required && <option value="">(omit)</option>}
                            {appOptions.map((name) => (
                              <option key={name} value={name}>
                                {name}
                              </option>
                            ))}
                          </select>
                        )}

                        {field.kind === "string" && (!isLauncherAppField || appOptions.length === 0) && (
                          <input
                            className="aci-input aci-mono"
                            disabled={busy || interacting}
                            value={value}
                            onChange={(event) => onToolFieldValueChange(field.path, event.target.value)}
                            placeholder={field.required ? "required" : "optional"}
                          />
                        )}

                        {(field.kind === "array" || field.kind === "object" || field.kind === "unknown") && (
                          <textarea
                            className="aci-input aci-textarea aci-mono"
                            style={{ minHeight: "60px" }}
                            disabled={busy || interacting}
                            value={value}
                            onChange={(event) => onToolFieldValueChange(field.path, event.target.value)}
                            placeholder={field.required ? "required JSON" : "optional JSON"}
                          />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {selectedToolAction?.paramSchema == null && (
              <textarea
                className="aci-input aci-textarea aci-mono"
                disabled={busy || interacting}
                value={fallbackToolParamsJson}
                onChange={(event) => onFallbackToolParamsJsonChange(event.target.value)}
                placeholder='{"key":"value"}'
              />
            )}
          </div>
        )}

        <button className="aci-button aci-button-primary" disabled={busy || interacting || !canSendByMode} onClick={onSend}>
          {interacting ? "Running Loop..." : "Send"}
        </button>
      </footer>
    </section>
  );
}
