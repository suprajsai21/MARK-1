import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../..');
const extDir = path.join(rootDir, 'apps/extension');
const outputDir = path.join(extDir, '.output');
const distPackagesDir = path.join(outputDir, 'browser-packages');

console.log('Building and packaging extension for supported browsers (Chrome, Edge, Brave)...');

// 1. Build and zip using WXT
execSync('corepack pnpm exec wxt zip', { cwd: extDir, stdio: 'inherit' });

if (!fs.existsSync(distPackagesDir)) {
  fs.mkdirSync(distPackagesDir, { recursive: true });
}

// 2. Identify the built zip
const files = fs.readdirSync(outputDir);
const baseZip = files.find((f) => f.endsWith('-chrome.zip'));

if (!baseZip) {
  console.error('Expected chrome zip not found in .output');
  process.exit(1);
}

const baseZipPath = path.join(outputDir, baseZip);
const browsers = ['chrome', 'edge', 'brave'];
const pkgJson = JSON.parse(fs.readFileSync(path.join(extDir, 'package.json'), 'utf-8'));
const version = pkgJson.version ?? '1.0.0';

for (const browser of browsers) {
  const destName = `mark-1-extension-v${version}-${browser}.zip`;
  const destPath = path.join(distPackagesDir, destName);
  fs.copyFileSync(baseZipPath, destPath);
  console.log(`Created release artifact: ${destName} (${(fs.statSync(destPath).size / 1024).toFixed(2)} KB)`);
}

console.log('Browser packaging complete. Artifacts saved in apps/extension/.output/browser-packages/');
