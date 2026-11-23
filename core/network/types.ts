
export interface NetworkRequestIntent {
  readonly moduleId: string;
  readonly origin: string;
  readonly dataCategory: string;
  readonly byteCount: number;
  readonly method: string;
  readonly timeoutMs: number;
  readonly redactedPreview: string;
  readonly permission: string;
  /** Optional UTF-8 request body; the broker verifies byteCount before send. */
  readonly body?: string;
}

export interface NetworkBrokerResult {
  readonly ok: true;
  readonly status: number;
  readonly body: string;
}

export type ConfirmationChoice = 'once' | 'always' | 'deny';
