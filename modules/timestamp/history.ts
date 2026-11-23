import type { ModuleContext } from '../../core/module-sdk/context';

export async function recordTimestampHistory(
  history: ModuleContext['history'],
  payload: {
    action: string;
    input: string;
    result: string;
    timeZone: string;
  },
): Promise<void> {
  await history.append({
    kind: 'text',
    action: payload.action,
    input: payload.input,
    output: payload.result,
    timeZone: payload.timeZone,
  });
}