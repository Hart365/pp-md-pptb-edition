const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const errors = [];

function requireDistFile(relativePath, label) {
  if (typeof relativePath !== 'string' || !relativePath) {
    errors.push(`${label} must be a non-empty relative path.`);
    return;
  }

  if (path.isAbsolute(relativePath) || relativePath.includes('\\') || relativePath.split('/').includes('..')) {
    errors.push(`${label} must be a safe POSIX path relative to dist: ${relativePath}`);
    return;
  }

  const resolvedPath = path.join(distDir, ...relativePath.split('/'));
  if (!fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isFile()) {
    errors.push(`${label} does not exist in dist: ${relativePath}`);
  }
}

requireDistFile(packageJson.main, 'main');
requireDistFile(packageJson.icon, 'icon');

if (typeof packageJson.icon === 'string' && path.extname(packageJson.icon).toLowerCase() !== '.svg') {
  errors.push(`icon must reference an SVG file: ${packageJson.icon}`);
}

const entryPath = path.join(distDir, ...packageJson.main.split('/'));
if (fs.existsSync(entryPath)) {
  const entryHtml = fs.readFileSync(entryPath, 'utf8');
  if (/\btype=["']module["']/i.test(entryHtml)) {
    errors.push('main must use a classic script because PPTB loads tool HTML in a sandboxed iframe.');
  }
  if (/\bcrossorigin(?:=|\s|>)/i.test(entryHtml)) {
    errors.push('main must not use crossorigin attributes for PPTB-local assets.');
  }
  if (/(?:src|href)=["']\/(?!\/)/i.test(entryHtml)) {
    errors.push('main asset paths must be relative so npm-installed tools resolve assets from dist.');
  }

  const scriptIndex = entryHtml.search(/<script[^>]+src=/i);
  const bodyIndex = entryHtml.search(/<\/body>/i);
  if (scriptIndex === -1 || bodyIndex === -1 || scriptIndex > bodyIndex) {
    errors.push('main must include its built script before the closing body tag.');
  }
}

const iconPath = path.join(distDir, ...packageJson.icon.split('/'));
if (fs.existsSync(iconPath)) {
  const iconSvg = fs.readFileSync(iconPath, 'utf8');
  if (!/\b(?:fill|stroke)=["']currentColor["']/i.test(iconSvg)) {
    errors.push('icon must use currentColor so PPTB can render it in light and dark themes.');
  }
}

for (const requiredFile of ['README.md', 'LICENSE']) {
  if (!fs.existsSync(path.join(rootDir, requiredFile))) {
    errors.push(`npm package prerequisite is missing: ${requiredFile}`);
  }
}

if (errors.length > 0) {
  errors.forEach((message) => console.error(`Package error: ${message}`));
  process.exitCode = 1;
} else {
  console.log(`PPTB distribution validated: ${packageJson.main}, ${packageJson.icon}, README.md, LICENSE`);
}
