// Pack Chrome extension into a downloadable distribution zip.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const rootDir = path.resolve(__dirname, '..');
const outputDir = path.join(rootDir, 'output');
fs.mkdirSync(outputDir, { recursive: true });

// Ensure shared mobile-core.js is fresh and built
execFileSync(process.execPath, [path.join(__dirname, 'build-extension-core.cjs')], { stdio: 'inherit' });

const version = process.env.EXTENSION_VERSION || 'v0.2.0';
const zipName = `LowP-Chrome-Extension-${version}.zip`;
const zipPath = path.join(outputDir, zipName);

if (fs.existsSync(zipPath)) {
  fs.unlinkSync(zipPath);
}

const filesToPack = ['manifest.json', 'assets', 'src'];
try {
  execFileSync('tar.exe', ['-a', '-c', '-f', zipPath, ...filesToPack], { cwd: rootDir, stdio: 'inherit' });
} catch {
  try {
    execFileSync('tar', ['-a', '-c', '-f', zipPath, ...filesToPack], { cwd: rootDir, stdio: 'inherit' });
  } catch {
    const psScript = `Compress-Archive -Path ${filesToPack.join(',')} -DestinationPath "${zipPath}" -Force`;
    execFileSync('powershell.exe', ['-NoProfile', '-Command', psScript], { cwd: rootDir, stdio: 'inherit' });
  }
}

const stats = fs.statSync(zipPath);
console.log(`Created Chrome extension package: ${zipName} (${stats.size} bytes) at ${zipPath}`);
