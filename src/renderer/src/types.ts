export type ComposerMode = "llm" | "simulatedAssistant";
export type SimulatorMode = "create" | "action";
export type TranscriptRole = "user" | "assistant" | "system" | "simulator";

export interface SessionInfo {
  sessionId: string;
  createdAt: Date | null;
}

export interface AppInfo {
  name: string;
  description: string | null;
  tags: string[];
  isStarted: boolean;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ActionInfo {
  type: string | null;
  appName: string | null;
  windowId: string | null;
  actionId: string | null;
}

export interface ActionResultInfo {
  success: boolean;
  message: string | null;
  summary: string | null;
}

export interface InteractionStepInfo {
  callId: string;
  windowId: string;
  actionId: string;
  resolvedMode: string;
  success: boolean;
  message: string | null;
  summary: string | null;
  taskId: string | null;
  turn: number;
  index: number;
}

export interface InteractionResponse {
  success: boolean;
  error: string | null;
  response: string | null;
  action: ActionInfo | null;
  actionResult: ActionResultInfo | null;
  steps: InteractionStepInfo[] | null;
  usage: TokenUsage | null;
}

export interface ActionParameterDef {
  name: string;
  type: string;
  required: boolean;
  defaultValue: unknown;
}

export interface WindowAction {
  id: string;
  label: string;
  mode: string | null;
  parameters: ActionParameterDef[];
}

export interface WindowInfo {
  id: string;
  description: string | null;
  content: string;
  appName: string | null;
  createdAt: number;
  updatedAt: number;
  actions: WindowAction[];
}

export interface ActionInvokeResponse {
  success: boolean;
  message: string | null;
  summary: string | null;
}

export interface ContextTimelineItem {
  id: string;
  type: string;
  seq: number;
  isObsolete: boolean;
  rawContent: string;
  estimatedTokens: number;
}

export interface TranscriptEntry {
  role: TranscriptRole;
  content: string;
  time: Date;
}
