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

  // Every script referenced by main is loaded as a classic script, so it must not
  // contain ES module syntax (import.meta / import / export), otherwise the browser
  // throws a SyntaxError and PPTB shows a blank screen.
  const vm = require('node:vm');
  const entryDir = path.dirname(entryPath);
  for (const match of entryHtml.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)) {
    const scriptPath = path.resolve(entryDir, match[1]);
    if (!fs.existsSync(scriptPath)) {
      errors.push(`main references a missing script: ${match[1]}`);
      continue;
    }
    const code = fs.readFileSync(scriptPath, 'utf8');
    if (/\bimport\.meta\b/.test(code)) {
      errors.push(`script must not contain import.meta (invalid in classic scripts): ${match[1]}`);
    }
    try {
      new vm.Script(code, { filename: match[1] });
    } catch (error) {
      errors.push(`script does not parse as a classic script (${error.message}): ${match[1]}`);
    }
  }
}

const iconPath = path.join(distDir, ...packageJson.icon.split('/'));
if (fs.existsSync(iconPath)) {
  const iconSvg = fs.readFileSync(iconPath, 'utf8');
  if (!/<svg[\s>]/i.test(iconSvg)) {
    errors.push(`icon is not a valid SVG document: ${packageJson.icon}`);
  }
  if (!/\bviewBox=/i.test(iconSvg)) {
    errors.push(`icon must declare a viewBox so PPTB can scale it: ${packageJson.icon}`);
  }
}

for (const requiredFile of ['README.md', 'LICENSE']) {
  if (!fs.existsSync(path.join(rootDir, requiredFile))) {
    errors.push(`npm package prerequisite is missing: ${requiredFile}`);
  }
}

const versionSurfaces = [
  {
    path: 'README.md',
    pattern: new RegExp(`\\| version \\| ${packageJson.version.replaceAll('.', '\\.')} \\|`),
    label: 'README manifest version',
  },
  {
    path: '.github/workflows/release.yml',
    pattern: new RegExp(`default: v${packageJson.version.replaceAll('.', '\\.')}`),
    label: 'release workflow default',
  },
  {
    path: 'docs/pp-md-feature-parity-plan.md',
    pattern: new RegExp(`Current Release Status \\(${packageJson.version.replaceAll('.', '\\.')}\\)`),
    label: 'release status documentation',
  },
];

for (const surface of versionSurfaces) {
  const surfacePath = path.join(rootDir, ...surface.path.split('/'));
  if (!fs.existsSync(surfacePath)) {
    errors.push(`${surface.label} file is missing: ${surface.path}`);
    continue;
  }

  if (!surface.pattern.test(fs.readFileSync(surfacePath, 'utf8'))) {
    errors.push(`${surface.label} must match package version ${packageJson.version}: ${surface.path}`);
  }
}

if (errors.length > 0) {
  errors.forEach((message) => console.error(`Package error: ${message}`));
  process.exitCode = 1;
} else {
  console.log(`PPTB distribution validated: ${packageJson.main}, ${packageJson.icon}, README.md, LICENSE`);
}
