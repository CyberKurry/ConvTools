import fs from 'node:fs';
import path from 'node:path';
import { compareCodePoints } from '../../core/config/ordering';
import { ModuleContractError, ModuleErrorCode } from '../../core/module-sdk/errors';
import { validateLocalePair, validateManifest } from '../../core/module-sdk/validate-manifest';
import { emitManifest, emitRegistry } from './module-emitter';
import type { ScannedModule } from './types';

export type { ScannedModule } from './types';

/**
 * Inspects only direct child directories of `root`. JSON is read as UTF-8 and
 * never executed. Results are sorted alphabetically by module id.
 */
export function scanModules(root: string): ScannedModule[] {
  if (!fs.existsSync(root)) {
    return [];
  }

  const directories = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort(compareCodePoints);

  const scanned: ScannedModule[] = [];
  const seenIds = new Map<string, string>();

  for (const directory of directories) {
    const moduleDir = path.join(root, directory);
    const manifestPath = path.join(moduleDir, 'module.json');
    if (!fs.existsSync(manifestPath)) {
      throw new ModuleContractError(
        ModuleErrorCode.MISSING_FILE,
        manifestPath,
        `missing module.json in ${directory}`,
      );
    }

    const raw = parseJson(manifestPath);
    const manifest = validateManifest(raw);

    const previous = seenIds.get(manifest.id);
    if (previous !== undefined) {
      throw new ModuleContractError(
        ModuleErrorCode.DUPLICATE_ID,
        '/id',
        `duplicate module id "${manifest.id}" in ${previous} and ${directory}`,
      );
    }
    seenIds.set(manifest.id, directory);

    const iconPath = path.join(moduleDir, manifest.icon);
    if (!fs.existsSync(iconPath)) {
      throw new ModuleContractError(ModuleErrorCode.MISSING_FILE, iconPath, `missing icon ${manifest.icon}`);
    }
    const iconSvg = fs.readFileSync(iconPath, 'utf8');
    assertStaticIconSvg(iconSvg, iconPath);

    const enPath = path.join(moduleDir, 'locales', 'en.json');
    const zhPath = path.join(moduleDir, 'locales', 'zh_CN.json');
    if (!fs.existsSync(enPath)) {
      throw new ModuleContractError(ModuleErrorCode.MISSING_FILE, enPath, 'missing en.json');
    }
    if (!fs.existsSync(zhPath)) {
      throw new ModuleContractError(ModuleErrorCode.MISSING_FILE, zhPath, 'missing zh_CN.json');
    }

    const enLocale = parseJson(enPath) as Record<string, unknown>;
    const zhLocale = parseJson(zhPath) as Record<string, unknown>;
    validateLocalePair(enLocale, zhLocale);
    const actionLabels: Record<string, { en: string; zh_CN: string }> = {};
    for (const actionId of manifest.surfaces.selectionActions) {
      const en = enLocale[actionId];
      const zh = zhLocale[actionId];
      if (typeof en !== 'string' || typeof zh !== 'string') {
        throw new ModuleContractError(
          ModuleErrorCode.INVALID_MANIFEST,
          enPath,
          `selection action "${actionId}" needs string labels in en.json and zh_CN.json`,
        );
      }
      actionLabels[actionId] = { en, zh_CN: zh };
    }
    scanned.push({
      directory,
      manifest,
      enName: typeof enLocale.name === 'string' ? enLocale.name : manifest.id,
      zhName: typeof zhLocale.name === 'string' ? zhLocale.name : manifest.id,
      selectionActionLabels: actionLabels,
      iconSvg,
      enLocale,
      zhLocale,
    });
  }

  for (const module of scanned) {
    if (module.manifest.id !== module.directory) {
      throw new ModuleContractError(
        ModuleErrorCode.DIRECTORY_ID_MISMATCH,
        '/id',
        `directory "${module.directory}" does not match module id "${module.manifest.id}"`,
      );
    }
  }

  return scanned.sort((a, b) => compareCodePoints(a.manifest.id, b.manifest.id));
}

export function generateModuleArtifacts(root: string): { registry: string; manifest: string } {
  const modules = scanModules(root);
  return {
    registry: emitRegistry(modules),
    manifest: emitManifest(modules),
  };
}

/**
 * Icons are embedded verbatim into extension pages through
 * dangerouslySetInnerHTML, so the file must be pure static vector content:
 * script hooks, foreignObject, external references, and URL-bearing
 * attributes are rejected at scan time (the trust boundary for shipped SVG).
 */
export function assertStaticIconSvg(svg: string, file: string): void {
  const violations: string[] = [];
  if (/<script/i.test(svg)) {
    violations.push('<script>');
  }
  if (/<foreignObject/i.test(svg)) {
    violations.push('<foreignObject>');
  }
  if (/\son[a-z-]+\s*=/i.test(svg)) {
    violations.push('event handler attribute');
  }
  if (/\s(?:href|xlink:href)\s*=\s*["']?\s*(?:https?:|\/\/|javascript:|data:)/i.test(svg)) {
    violations.push('external or URL-bearing href');
  }
  if (/<(?:use|image|iframe|object|embed)\b/i.test(svg)) {
    violations.push('embedding element');
  }
  if (violations.length > 0) {
    throw new ModuleContractError(
      ModuleErrorCode.INVALID_MANIFEST,
      file,
      `icon SVG must be static vector content; rejected: ${violations.join(', ')}`,
    );
  }
}

function parseJson(file: string): unknown {
  const text = fs.readFileSync(file, 'utf8');
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ModuleContractError(ModuleErrorCode.INVALID_MANIFEST, file, `invalid JSON in ${file}`);
  }
}
