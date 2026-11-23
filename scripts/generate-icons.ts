import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'assets', 'extension-icon.svg');
const OUT_DIR = path.join(ROOT, 'public', 'icon');

const SIZES = [16, 32, 48, 128] as const;

interface Options {
  check?: boolean;
  log?: (message: string) => void;
}

/**
 * Renders the source SVG into the four required PNG sizes deterministically.
 * With `--check` it refuses to modify files and fails on any drift instead.
 */
export async function generateIcons(options: Options = {}): Promise<string[]> {
  const log = options.log ?? ((message: string) => console.log(message));
  const sourceBuffer = fs.readFileSync(SOURCE);
  const produced: string[] = [];

  for (const size of SIZES) {
    const target = path.join(OUT_DIR, `${size}.png`);
    const png = await sharp(sourceBuffer, { density: 384 }).resize(size, size).png().toBuffer();
    if (options.check) {
      const existing = fs.existsSync(target) ? fs.readFileSync(target) : null;
      if (!existing || !existing.equals(png)) {
        throw new Error(`icon drift: ${target}`);
      }
    } else {
      fs.mkdirSync(OUT_DIR, { recursive: true });
      fs.writeFileSync(target, png);
      log(`wrote ${path.relative(ROOT, target)}`);
    }
    produced.push(target);
  }
  return produced;
}

// CLI entrypoint (invoked via `pnpm icons:generate` / `pnpm icons:check`).
if (
  process.argv[1] &&
  path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()
) {
  const check = process.argv.includes('--check');
  generateIcons({ check })
    .then(() => process.exit(0))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    });
}