import type { ToolModuleManifest } from '../../core/module-sdk/manifest';

export interface SelectionActionLabel {
  readonly en: string;
  readonly zh_CN: string;
}

export interface ScannedModule {
  readonly directory: string;
  readonly manifest: ToolModuleManifest;
  readonly enName: string;
  readonly zhName: string;
  readonly selectionActionLabels: Readonly<Record<string, SelectionActionLabel>>;
  readonly iconSvg: string;
  readonly enLocale: Record<string, unknown>;
  readonly zhLocale: Record<string, unknown>;
}