import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { generateCommittedArtifacts } from './generate-modules';
import { resolveModulePath } from './lib/module-path';

const THIS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE_ROOT = path.join(THIS_ROOT, 'scripts', 'templates', 'module');

export interface CliOptions {
  readonly root?: string;
  readonly force?: boolean;
  readonly yes?: boolean;
  readonly confirm?: (id: string) => boolean | Promise<boolean>;
}

export function addModule(id: string, options: CliOptions = {}): void {
  const root = options.root ?? THIS_ROOT;
  const modulesRoot = path.join(root, 'modules');
  const target = resolveModulePath(modulesRoot, id);
  if (fs.existsSync(target)) {
    throw new Error(`module "${id}" already exists`);
  }

  fs.mkdirSync(target, { recursive: true });
  try {
    copyTemplate(TEMPLATE_ROOT, target, id);
    generateCommittedArtifacts({ root });
  } catch (error) {
    fs.rmSync(target, { recursive: true, force: true });
    throw error;
  }
}

export async function removeModule(id: string, options: CliOptions = {}): Promise<void> {
  const root = options.root ?? THIS_ROOT;
  const modulesRoot = path.join(root, 'modules');
  const target = resolveModulePath(modulesRoot, id);
  if (!fs.existsSync(target)) {
    throw new Error(`module "${id}" does not exist`);
  }

  if (!options.force) {
    const dirty = gitPorcelain(root, path.join('modules', id));
    if (dirty.length > 0) {
      throw new Error(`module "${id}" has uncommitted changes; pass --force to remove`);
    }
  }

  const confirmed = options.confirm
    ? await options.confirm(id)
    : options.yes === true;
  if (confirmed !== true) {
    throw new Error(`removal of "${id}" was not confirmed`);
  }

  const backup = fs.mkdtempSync(path.join(os.tmpdir(), `convtools-${id}-backup-`));
  fs.cpSync(target, backup, { recursive: true });
  fs.rmSync(target, { recursive: true, force: true });
  try {
    generateCommittedArtifacts({ root });
    fs.rmSync(backup, { recursive: true, force: true });
  } catch (error) {
    fs.cpSync(backup, target, { recursive: true });
    fs.rmSync(backup, { recursive: true, force: true });
    throw new Error(
      `failed to regenerate after removing "${id}"; module directory restored: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function copyTemplate(from: string, to: string, id: string): void {
  const entries = fs.readdirSync(from, { withFileTypes: true });
  for (const entry of entries) {
    const source = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(dest, { recursive: true });
      copyTemplate(source, dest, id);
      continue;
    }
    const rendered = fs.readFileSync(source, 'utf8').replaceAll('{{id}}', id);
    fs.writeFileSync(dest, rendered);
  }
}

function gitPorcelain(root: string, relativePath: string): string {
  try {
    return execFileSync('git', ['status', '--porcelain', '--', relativePath], {
      cwd: root,
      encoding: 'utf8',
    }).trim();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`git status failed: ${detail}`);
  }
}

async function confirmExactId(id: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) => {
    rl.question(`Type the module id "${id}" to confirm removal: `, resolve);
  });
  rl.close();
  return answer.trim() === id;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()
) {
  const [, , command, id, ...flags] = process.argv;
  const force = flags.includes('--force');
  const yes = flags.includes('--yes');
  if (!command || !id) {
    console.error('usage: module-cli add|remove <id> [--force] [--yes]');
    process.exit(1);
  }
  void (async () => {
    try {
      if (command === 'add') {
        addModule(id);
        return;
      }
      if (command === 'remove') {
        await removeModule(id, {
          force,
          confirm: yes ? () => true : confirmExactId,
        });
        return;
      }
      throw new Error(`unknown command ${command}`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  })();
}
