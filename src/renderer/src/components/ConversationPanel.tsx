import type { MutableRefObject } from "react";
import type { ComposerMode, SessionInfo, TranscriptEntry } from "../types";

interface ConversationPanelProps {
  activeSession: SessionInfo | null;
  selectedAgentId: string | null;
  baseUrl: string;
  error: string | null;
  entries: TranscriptEntry[];
  transcriptRef: MutableRefObject<HTMLDivElement | null>;
  busy: boolean;
  interacting: boolean;
  composerMode: ComposerMode;
  composerInput: string;
  manualOutputInput: string;
  onSetComposerMode: (mode: ComposerMode) => void;
  onComposerInputChange: (value: string) => void;
  onManualOutputInputChange: (value: string) => void;
  onSend: () => void;
  onRefresh: () => void;
  formatEntryTime: (value: Date) => string;
  sessionShortId: (sessionId: string) => string;
}

/**
 * 中间主对话区。
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
    composerMode,
    composerInput,
    manualOutputInput,
    onSetComposerMode,
    onComposerInputChange,
    onManualOutputInputChange,
    onSend,
    onRefresh,
    formatEntryTime,
    sessionShortId
  } = props;

  return (
    <section className="aci-center">
      <header className="aci-center-header">
        <div className="aci-breadcrumb">
          <span>{activeSession ? `Session #${sessionShortId(activeSession.sessionId)}` : "No Session"}</span>
          <span>/</span>
          <span>{selectedAgentId ?? "No Agent"}</span>
        </div>
        <div className="aci-compact-actions">
          <button className="aci-icon-button" disabled={busy || interacting} onClick={onRefresh}>
            R
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
              <span>{formatEntryTime(entry.time)}</span>
            </header>
            <pre>{entry.content}</pre>
          </article>
        ))}
      </div>

      <footer className="aci-composer">
        <div className="aci-chip-row">
          <button className={`aci-chip ${composerMode === "llm" ? "is-active" : ""}`} disabled={busy || interacting} onClick={() => onSetComposerMode("llm")}>
            LLM
          </button>
          <button
            className={`aci-chip ${composerMode === "simulatedAssistant" ? "is-active" : ""}`}
            disabled={busy || interacting}
            onClick={() => onSetComposerMode("simulatedAssistant")}
          >
            Simulated
          </button>
        </div>

        {composerMode === "llm" ? (
          <textarea
            className="aci-input aci-textarea"
            disabled={busy || interacting}
            value={composerInput}
            onChange={(event) => onComposerInputChange(event.target.value)}
            placeholder="Type a message..."
          />
        ) : (
          <textarea
            className="aci-input aci-textarea aci-mono"
            disabled={busy || interacting}
            value={manualOutputInput}
            onChange={(event) => onManualOutputInputChange(event.target.value)}
            placeholder="<action_call>...</action_call>"
          />
        )}

        <button
          className="aci-button aci-button-primary"
          disabled={busy || interacting || (composerMode === "llm" ? !composerInput.trim() : !manualOutputInput.trim())}
          onClick={onSend}
        >
          {interacting ? "Running Loop..." : "Send"}
        </button>
      </footer>
    </section>
  );
}

