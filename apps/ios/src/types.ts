// Shared types for the Ano chat app.

export type ChatRole = 'user' | 'assistant';

export type ChatMessage = {
  /** Stable local id. For streamed replies this is the gateway runId. */
  id: string;
  role: ChatRole;
  /** Plain text (assistant text may contain light markdown). */
  text: string;
  /** True while the assistant reply is still streaming in. */
  streaming?: boolean;
  /** True when this bubble represents an error, not real assistant text. */
  error?: boolean;
  /** Epoch milliseconds, when known. */
  timestamp?: number;
};

export type ConnectionState =
  | 'idle'
  | 'connecting'
  | 'ready'
  | 'reconnecting'
  | 'needs-pairing'
  | 'auth-failed'
  | 'error';
