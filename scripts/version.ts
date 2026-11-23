/**
 * Version alignment between the release tag and `package.json`. The GitHub
 * release pipeline calls `version:sync <tag>` before building so every shipped
 * artifact carries the same version, then the working tree is restored when
 * the pipeline container is discarded (the edit is never committed).
 *
 * `package.json#version` is the single source of truth: WXT reads it by
 * default and injects it into the extension manifest.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import semver from 'semver';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/;

/** Strips a leading `v` and confirms the result is a plain X.Y.Z version. */
export function normalizeVersion(value: string, label = 'version'): string {
  const version = value.replace(/^v/, '');
  if (!SEMVER_PATTERN.test(version)) {
    throw new Error(`${label} "${value}" is not a plain X.Y.Z version`);
  }
  return version;
}

function defaultPackagePath(): string {
  return path.join(ROOT, 'package.json');
}

function readPackage(packagePath: string): { version: string } {
  const raw = fs.readFileSync(packagePath, 'utf8');
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  if (typeof parsed.version !== 'string' || parsed.version.length === 0) {
    throw new Error('package.json is missing a non-empty string "version" field');
  }
  return parsed as { version: string };
}

function writePackageVersion(packagePath: string, version: string): void {
  const parsed = JSON.parse(fs.readFileSync(packagePath, 'utf8')) as Record<string, unknown>;
  parsed.version = version;
  // Preserve 2-space indent plus trailing newline to keep the diff minimal.
  fs.writeFileSync(packagePath, `${JSON.stringify(parsed, null, 2)}\n`);
}

/**
 * Writes `package.json#version`. Intended for CI: the pipeline passes the
 * release tag (e.g. `v0.2.0`) and the build picks it up.
 */
export function setVersion(value: string, packagePath = defaultPackagePath()): void {
  writePackageVersion(packagePath, normalizeVersion(value, 'target version'));
}

/**
 * Reads the current `package.json` version.
 */
export function getVersion(packagePath = defaultPackagePath()): string {
  return readPackage(packagePath).version;
}

function highestReleaseVersion(tags: readonly string[]): string | undefined {
  return tags
    .filter((tag) => tag.startsWith('v') && SEMVER_PATTERN.test(tag.slice(1)) && semver.valid(tag) !== null)
    .map((tag) => tag.slice(1))
    .sort(semver.rcompare)[0];
}

/** Pick a stable tag from the repository's own tags, reusing it on retries. */
export function selectReleaseTag(
  packageVersion: string,
  tags: readonly string[],
  tagsAtCommit: readonly string[],
): string {
  const baseline = normalizeVersion(packageVersion);
  const existing = highestReleaseVersion(tagsAtCommit);
  const latest = highestReleaseVersion(tags);
  const version = existing ?? (latest && !semver.gt(baseline, latest) ? semver.inc(latest, 'patch') : baseline);
  if (version === null || semver.valid(version) !== version || version === '0.0.0' ||
      version.split('.').some((part) => Number(part) > 65535)) {
    throw new Error(`Release version ${version} must be valid for the browser Manifest (each component ≤ 65535)`);
  }
  return `v${version}`;
}

function readGitTags(args: readonly string[]): string[] {
  return execFileSync('git', ['tag', ...args], { cwd: ROOT, encoding: 'utf8' }).trim().split(/\r?\n/);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()
) {
  const [command, value] = process.argv.slice(2);
  switch (command) {
    case 'sync':
      if (!value) {
        throw new Error('usage: scripts/version.ts sync <X.Y.Z|vX.Y.Z>');
      }
      setVersion(value);
      console.log(`package.json version -> ${getVersion()}`);
      break;
    case 'get':
      console.log(getVersion());
      break;
    case 'tag':
      console.log(selectReleaseTag(getVersion(), readGitTags(['--list', 'v*']), readGitTags(['--points-at', 'HEAD'])));
      break;
    default:
      throw new Error(`unknown command "${command}" (expected "sync", "get", or "tag")`);
  }
}
