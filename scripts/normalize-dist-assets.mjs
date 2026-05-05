import { promises as fs } from 'node:fs';
import path from 'node:path';

const distDir = path.resolve('dist');
const assetsDir = path.join(distDir, 'assets');
const indexHtmlPath = path.join(distDir, 'index.html');

async function safeRename(oldPath, newPath) {
  if (oldPath === newPath) return;
  try {
    await fs.unlink(newPath);
  } catch {
    // Target does not exist yet.
  }
  await fs.rename(oldPath, newPath);
}

async function run() {
  const [assetEntries, indexHtml] = await Promise.all([
    fs.readdir(assetsDir, { withFileTypes: true }),
    fs.readFile(indexHtmlPath, 'utf8'),
  ]);

  let nextIndexHtml = indexHtml;

  const jsAsset = assetEntries.find((entry) => entry.isFile() && /^index-.*\.js$/i.test(entry.name));
  const cssAsset = assetEntries.find((entry) => entry.isFile() && /^style-.*\.css$/i.test(entry.name));
  const appIconAsset = assetEntries.find((entry) => entry.isFile() && /^app-icon-.*\.svg$/i.test(entry.name));

  if (jsAsset) {
    const newName = 'pp-md-app.js';
    await safeRename(path.join(assetsDir, jsAsset.name), path.join(assetsDir, newName));
    nextIndexHtml = nextIndexHtml.replace(jsAsset.name, newName);
  }

  if (cssAsset) {
    const newName = 'pp-md-styles.css';
    await safeRename(path.join(assetsDir, cssAsset.name), path.join(assetsDir, newName));
    nextIndexHtml = nextIndexHtml.replace(cssAsset.name, newName);
  }

  if (appIconAsset) {
    const newName = 'pp-md-app-icon.svg';
    await safeRename(path.join(assetsDir, appIconAsset.name), path.join(assetsDir, newName));
    nextIndexHtml = nextIndexHtml.replace(appIconAsset.name, newName);
  }

  if (nextIndexHtml !== indexHtml) {
    await fs.writeFile(indexHtmlPath, nextIndexHtml, 'utf8');
  }
}

run().catch((error) => {
  console.error('Failed to normalize dist asset names:', error);
  process.exitCode = 1;
});
