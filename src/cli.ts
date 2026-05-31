#!/usr/bin/env node
import { resolve } from 'path';
import { scan, FsNode } from './main/scanner';

const SIZE_WIDTH = 9;

function formatSize(bytes: number): string {
  if (bytes >= 1e12) return `${(bytes / 1e12).toFixed(1)} TB`;
  if (bytes >= 1e9)  return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6)  return `${(bytes / 1e6).toFixed(1)} MB`;
  if (bytes >= 1e3)  return `${(bytes / 1e3).toFixed(1)} KB`;
  return `${bytes} B`;
}

function parseMinSize(s: string): number {
  const m = s.match(/^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb|tb)?$/i);
  if (!m) throw new Error(`Invalid size: "${s}". Use a number with optional unit (e.g. 10mb, 1gb).`);
  const n = parseFloat(m[1]);
  const unit = (m[2] ?? 'b').toLowerCase();
  const multiplier: Record<string, number> = { b: 1, kb: 1e3, mb: 1e6, gb: 1e9, tb: 1e12 };
  return n * (multiplier[unit] ?? 1);
}

function countFiles(node: FsNode): number {
  if (node.type === 'file') return 1;
  return (node.children ?? []).reduce((s, c) => s + countFiles(c), 0);
}

interface Options {
  depth: number;
  top: number;
  minSize: number;
  json: boolean;
}

function printNode(node: FsNode, prefix: string, isLast: boolean, depth: number, opts: Options): void {
  const connector = isLast ? '└── ' : '├── ';
  const label = node.name + (node.type === 'dir' ? '/' : '');
  const sizeStr = formatSize(node.size).padStart(SIZE_WIDTH);
  console.log(`${sizeStr}  ${prefix}${connector}${label}`);

  if (node.type !== 'dir' || depth >= opts.depth || !node.children) return;

  const children = node.children
    .filter(c => c.size >= opts.minSize)
    .sort((a, b) => b.size - a.size)
    .slice(0, opts.top);

  const childPrefix = prefix + (isLast ? '    ' : '│   ');
  children.forEach((child, i) => {
    printNode(child, childPrefix, i === children.length - 1, depth + 1, opts);
  });
}

function showHelp(): void {
  console.log(`
Disk Analyzer CLI

Usage:
  disk-analyzer [path] [options]

Arguments:
  path              Directory to scan (default: current directory)

Options:
  -d, --depth N     Levels deep to display (default: 3)
  -n, --top N       Max entries per level, sorted by size (default: 10)
  -s, --min-size N  Omit entries smaller than N (e.g. 10mb, 1gb) (default: 0)
      --json        Output full JSON tree instead of formatted display
  -h, --help        Show this help

Examples:
  disk-analyzer
  disk-analyzer /home/user --depth 4 --top 5
  disk-analyzer C:\\Users --min-size 100mb
  disk-analyzer /var --json > scan.json
`.trim());
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    showHelp();
    process.exit(0);
  }

  const opts: Options = { depth: 3, top: 10, minSize: 0, json: false };
  let targetPath = process.cwd();

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if ((a === '--depth' || a === '-d') && args[i + 1]) {
      opts.depth = parseInt(args[++i], 10);
    } else if ((a === '--top' || a === '-n') && args[i + 1]) {
      opts.top = parseInt(args[++i], 10);
    } else if ((a === '--min-size' || a === '-s') && args[i + 1]) {
      opts.minSize = parseMinSize(args[++i]);
    } else if (a === '--json') {
      opts.json = true;
    } else if (!a.startsWith('-')) {
      targetPath = resolve(a);
    } else {
      console.error(`Unknown option: ${a}\nRun with --help for usage.`);
      process.exit(1);
    }
  }

  if (!opts.json) {
    process.stderr.write(`Scanning ${targetPath}...\n`);
  }

  const start = Date.now();
  let lastProgressLen = 0;

  const tree = await scan(targetPath, (p) => {
    if (opts.json) return;
    const msg = `  ${p.files.toLocaleString()} files  ${formatSize(p.bytes)}  ${p.currentPath.slice(-60)}`;
    process.stderr.write('\r' + msg.padEnd(lastProgressLen));
    lastProgressLen = msg.length;
  });

  if (!opts.json && lastProgressLen > 0) {
    process.stderr.write('\r' + ' '.repeat(lastProgressLen) + '\r');
  }

  if (opts.json) {
    console.log(JSON.stringify(tree, null, 2));
    return;
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  const totalFiles = countFiles(tree);
  process.stderr.write(
    `Done — ${totalFiles.toLocaleString()} files, ${formatSize(tree.size)} in ${elapsed}s\n\n`
  );

  // Root line
  console.log(`${formatSize(tree.size).padStart(SIZE_WIDTH)}  ${tree.path}/`);

  const topChildren = (tree.children ?? [])
    .filter(c => c.size >= opts.minSize)
    .sort((a, b) => b.size - a.size)
    .slice(0, opts.top);

  topChildren.forEach((child, i) => {
    printNode(child, '', i === topChildren.length - 1, 1, opts);
  });
}

main().catch(e => {
  console.error(`Error: ${(e as Error).message}`);
  process.exit(1);
});
