#!/usr/bin/env node
/**
 * Ensures the platform-specific sharp binary is installed before the build uses it.
 *
 * Why: package-lock.json was generated on macOS and does not list the Linux
 * @img/sharp-linux-x64 binary. On CI (e.g. Render) `npm ci` therefore skips it
 * and `scripts/compress-images.mjs` crashes with:
 *   Error: Could not load the "sharp" module using the linux-x64 runtime
 *
 * `npm install sharp` does not fix it: npm sees the tree as in sync with the
 * lockfile and does nothing. So we resolve the exact native packages
 * (@img/sharp-<platform>-<arch> + its @img/sharp-libvips-* dependency), download
 * their tarballs with `npm pack` in a temp dir, and unpack them into node_modules.
 * package.json / package-lock.json are never modified.
 *
 * This script is a no-op when sharp already loads (local dev, or once the
 * lockfile has been regenerated for all platforms).
 *
 * Usage: node scripts/ensure-sharp.mjs
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);

async function sharpWorks() {
  try {
    const sharp = (await import('sharp')).default;
    await sharp({ create: { width: 1, height: 1, channels: 3, background: '#000' } })
      .webp()
      .toBuffer();
    return true;
  } catch {
    return false;
  }
}

function installedSharpVersion() {
  try {
    return require('sharp/package.json').version;
  } catch {
    return null;
  }
}

/** Map Node's platform/arch onto the @img sharp package suffix. */
function nativePackageSuffix() {
  const { platform, arch } = process;
  if (platform === 'linux') {
    const glibc = typeof process.report?.getReport === 'function'
      ? process.report.getReport()?.header?.glibcVersionRuntime
      : undefined;
    return `${glibc ? 'linux' : 'linuxmusl'}-${arch}`;
  }
  return `${platform}-${arch}`; // darwin-arm64, win32-x64, ...
}

/**
 * Resolve the exact version npm would install for a package at the top level.
 * Uses `npm view <spec> version --json` so the native package matches the
 * installed sharp version exactly.
 */
function resolveVersion(spec) {
  const out = execFileSync('npm', ['view', spec, 'version', '--json'], {
    encoding: 'utf8',
    env: process.env,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const parsed = JSON.parse(out);
  const version = Array.isArray(parsed) ? parsed[parsed.length - 1] : parsed;
  if (!version) throw new Error(`could not resolve version for ${spec}`);
  return version;
}

/**
 * Read the runtime dependencies of a published package.
 * Note: @img/sharp-* declares libvips in `optionalDependencies`, not `dependencies`.
 */
function dependencyOf(spec) {
  const out = execFileSync('npm', ['view', spec, 'dependencies', 'optionalDependencies', '--json'], {
    encoding: 'utf8',
    env: process.env,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  try {
    const parsed = JSON.parse(out);
    // `npm view a b --json` returns { a: ..., b: ... }, or just one value when only one field exists.
    const deps = parsed && typeof parsed === 'object' && !Array.isArray(parsed) && 'optionalDependencies' in parsed
      ? { ...(parsed.dependencies || {}), ...(parsed.optionalDependencies || {}) }
      : parsed || {};
    return deps;
  } catch {
    return {};
  }
}

function pack(spec, dir) {
  const out = execFileSync('npm', ['pack', spec, '--silent'], {
    cwd: dir,
    encoding: 'utf8',
    env: process.env,
  });
  return path.join(dir, out.trim().split('\n').pop());
}

const sharpVersion = installedSharpVersion();
if (!sharpVersion) {
  console.warn('sharp: package not found — skipping native install (image compression will be skipped)');
  process.exit(0);
}

if (await sharpWorks()) {
  console.log(`sharp ${sharpVersion}: ok`);
  process.exit(0);
}

const suffix = nativePackageSuffix();
const nativeName = `@img/sharp-${suffix}`;

console.log(`sharp: native binding missing for ${process.platform}-${process.arch}`);
const nativeVersion = resolveVersion(`${nativeName}@${sharpVersion}`);
const deps = dependencyOf(`${nativeName}@${nativeVersion}`);
const libvipsName = Object.keys(deps).find((d) => d.startsWith('@img/sharp-libvips-'));
const libvipsSpec = libvipsName
  ? `${libvipsName}@${resolveVersion(`${libvipsName}@${deps[libvipsName]}`)}`
  : null;

const targets = [`${nativeName}@${nativeVersion}`].concat(libvipsSpec ? [libvipsSpec] : []);
console.log(`sharp: installing ${targets.join(', ')}`);

const stage = mkdtempSync(path.join(tmpdir(), 'sharp-native-'));
try {
  const nodeModules = path.join(process.cwd(), 'node_modules');
  for (const spec of targets) {
    const name = spec.replace(/(?<=^@[^/]+\/[^@]+)@.*$/, '');
    const tarball = pack(spec, stage);
    const unpackDir = path.join(stage, 'unpacked');
    rmSync(unpackDir, { recursive: true, force: true });
    execFileSync('mkdir', ['-p', unpackDir]);
    execFileSync('tar', ['-xzf', tarball, '-C', unpackDir]);
    const target = path.join(nodeModules, name);
    rmSync(target, { recursive: true, force: true });
    execFileSync('mkdir', ['-p', path.dirname(target)]);
    execFileSync('mv', [path.join(unpackDir, 'package'), target]);
    console.log(`sharp: installed ${name}`);
  }
} finally {
  rmSync(stage, { recursive: true, force: true });
}

if (!(await sharpWorks())) {
  console.warn('sharp: still not loadable after install (image compression will be skipped)');
  process.exit(0);
}
console.log('sharp: native binding ready');
