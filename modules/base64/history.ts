import type { ModuleContext } from '../../core/module-sdk/context';
import type { Base64Format } from './core/types';

export async function recordTextHistory(
  history: ModuleContext['history'],
  payload: {
    action: 'encode' | 'decode';
    input: string;
    output: string;
    format: Base64Format;
    corrections: readonly string[];
  },
): Promise<void> {
  await history.append({
    kind: 'text',
    action: payload.action,
    input: payload.input,
    output: payload.output,
    format: payload.format,
    corrections: payload.corrections,
  });
}

export async function recordFileHistory(
  history: ModuleContext['history'],
  payload: {
    action: 'encode' | 'decode';
    name: string;
    size: number;
    mime: string;
  },
): Promise<void> {
  await history.append({
    kind: 'file',
    action: payload.action,
    name: payload.name,
    size: payload.size,
    mime: payload.mime,
  });
}