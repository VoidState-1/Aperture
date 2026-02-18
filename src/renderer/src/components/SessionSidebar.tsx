import type { SessionInfo } from "../types";

interface SessionSidebarProps {
  sessions: SessionInfo[];
  selectedSessionId: string | null;
  selectedAgentId: string | null;
  busy: boolean;
  interacting: boolean;
  onCreateSession: () => void;
  onRefresh: () => void;
  onDeleteSession: () => void;
  onSelectSessionAgent: (sessionId: string, agentId: string) => void;
  formatSessionTitle: (session: SessionInfo | null) => string;
}

/**
 * 左侧会话与 Agent 导航区。
 */
export function SessionSidebar(props: SessionSidebarProps): JSX.Element {
  const {
    sessions,
    selectedSessionId,
    selectedAgentId,
    busy,
    interacting,
    onCreateSession,
    onRefresh,
    onDeleteSession,
    onSelectSessionAgent,
    formatSessionTitle
  } = props;

  return (
    <aside className="aci-sidebar">
      <div className="aci-brand">
        <div className="aci-brand-dot" />
        <div>
          <div className="aci-brand-title">Aperture</div>
          <div className="aci-brand-sub">ACI Workbench</div>
        </div>
      </div>

      <button className="aci-button aci-button-primary aci-full" disabled={busy || interacting} onClick={onCreateSession}>
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
                  onSelectSessionAgent(session.sessionId, fallbackAgentId);
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
                  onClick={() => onSelectSessionAgent(session.sessionId, agent.agentId)}
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
        <button className="aci-button aci-button-ghost aci-full" disabled={busy || interacting} onClick={onRefresh}>
          Refresh
        </button>
        <button className="aci-button aci-button-danger aci-full" disabled={busy || interacting || !selectedSessionId} onClick={onDeleteSession}>
          Close Session
        </button>
      </div>
    </aside>
  );
}
