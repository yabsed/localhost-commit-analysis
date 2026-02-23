import { copyFile, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(__dirname, '..');
const repoRoot = path.resolve(appDir, '..');
const publicDir = path.join(appDir, 'public');
const outputDir = path.join(publicDir, 'data');
const commitOutputDir = path.join(outputDir, 'commit-logs');
const identityOutputDir = path.join(outputDir, 'identity-rules');

const commitSourceDir = path.join(repoRoot, 'commit_crawler', 'json');
const identitySourceDir = appDir;

function toPosixRelative(fromPath, toPath) {
  return path.relative(fromPath, toPath).split(path.sep).join('/');
}

async function collectFiles(sourceDir, extension) {
  let entries = [];
  try {
    entries = await readdir(sourceDir, { withFileTypes: true });
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }

  const files = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(extension)) {
      continue;
    }
    const sourcePath = path.join(sourceDir, entry.name);
    const sourceStat = await stat(sourcePath);
    files.push({
      name: entry.name,
      sourcePath,
      sizeBytes: sourceStat.size,
      modifiedAtMs: sourceStat.mtimeMs,
    });
  }

  files.sort((a, b) => b.modifiedAtMs - a.modifiedAtMs || a.name.localeCompare(b.name));
  return files;
}

async function resetDirectory(directoryPath) {
  await rm(directoryPath, { recursive: true, force: true });
  await mkdir(directoryPath, { recursive: true });
}

async function copyFiles(files, targetDir, rootDir) {
  const output = [];
  for (const file of files) {
    const targetPath = path.join(targetDir, file.name);
    await copyFile(file.sourcePath, targetPath);
    output.push({
      name: file.name,
      sizeBytes: file.sizeBytes,
      modifiedAtMs: file.modifiedAtMs,
      path: toPosixRelative(rootDir, targetPath),
    });
  }
  return output;
}

async function main() {
  await mkdir(outputDir, { recursive: true });
  await resetDirectory(commitOutputDir);
  await resetDirectory(identityOutputDir);

  const commitFiles = await collectFiles(commitSourceDir, '.json');
  const identityRuleFiles = await collectFiles(identitySourceDir, '.txt');

  const commitLogs = await copyFiles(commitFiles, commitOutputDir, publicDir);
  const identityRules = await copyFiles(identityRuleFiles, identityOutputDir, publicDir);

  const manifest = {
    generatedAt: new Date().toISOString(),
    commitLogs,
    identityRuleFiles: identityRules,
  };

  const manifestPath = path.join(outputDir, 'manifest.json');
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');

  console.log(
    [
      `[prepare:data] commit logs: ${commitLogs.length}`,
      `[prepare:data] identity rules: ${identityRules.length}`,
      `[prepare:data] manifest: ${manifestPath}`,
    ].join('\n')
  );
}

main().catch((error) => {
  console.error('[prepare:data] failed:', error);
  process.exitCode = 1;
});
