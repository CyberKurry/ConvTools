import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateModuleArtifacts } from './lib/module-scanner';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function generateCommittedArtifacts(
  options: { check?: boolean; root?: string } = {},
): string[] {
  const workspace = options.root ?? ROOT;
  const artifacts = generateModuleArtifacts(path.join(workspace, 'modules'));
  const files: Array<{ path: string; content: string }> = [
    { path: path.join(workspace, 'generated', 'module-registry.ts'), content: artifacts.registry },
    { path: path.join(workspace, 'generated', 'module-manifest.ts'), content: artifacts.manifest },
  ];

  if (options.check) {
    const drifted: string[] = [];
    for (const file of files) {
      const existing = fs.existsSync(file.path) ? fs.readFileSync(file.path, 'utf8') : null;
      if (existing !== file.content) {
        drifted.push(path.relative(workspace, file.path));
      }
    }
    if (drifted.length > 0) {
      throw new Error(`generated drift: ${drifted.join(', ')}`);
    }
    return drifted;
  }

  fs.mkdirSync(path.join(workspace, 'generated'), { recursive: true });
  for (const file of files) {
    fs.writeFileSync(file.path, file.content);
  }
  return files.map((file) => path.relative(workspace, file.path));
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()
) {
  const check = process.argv.includes('--check');
  try {
    const result = generateCommittedArtifacts({ check });
    if (check) {
      console.log('generated files are up to date');
    } else {
      for (const file of result) {
        console.log(`wrote ${file}`);
      }
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}