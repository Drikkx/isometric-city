#!/usr/bin/env node
/**
 * Ensures the platform-specific sharp binary is installed before the build uses it.
 *
 * Why: package-lock.json was generated on macOS and does not list the Linux
 * @img/sharp-linux-x64 binary. On CI (e.g. Render) `npm ci` therefore skips it
 * and `scripts/compress-images.mjs` crashes with:
 *   Error: Could not load the "sharp" module using the linux-x64 runtime
 *
 * This script is a no-op when sharp already loads (local dev, or once the
 * lockfile has been regenerated for all platforms).
 *
 * Usage: node scripts/ensure-sharp.mjs
 */

import { execFileSync } from 'node:child_process';

async function canLoadSharp() {
  try {
    const sharp = (await import('sharp')).default;
    // Touch the native binding, not just the JS wrapper
    sharp({ create: { width: 1, height: 1, channels: 3, background: '#000' } })
      .webp()
      .toBuffer();
    return true;
  } catch {
    return false;
  }
}

if (await canLoadSharp()) {
  console.log('sharp: ok');
  process.exit(0);
}

console.log('sharp: native binary missing for this platform — installing @img/sharp-<platform>');
try {
  execFileSync(
    'npm',
    ['install', '--no-save', '--include=optional', '--no-fund', '--no-audit', 'sharp'],
    { stdio: 'inherit', env: process.env }
  );
} catch (error) {
  console.error('sharp: installation failed (continuing, image compression will be skipped)');
  process.exit(0);
}

if (!(await canLoadSharp())) {
  console.warn('sharp: still not loadable after install (image compression will be skipped)');
  process.exit(0);
}
console.log('sharp: installed');
