import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const rceditModule = await import('rcedit');
const rcedit = rceditModule.rcedit || rceditModule.default || rceditModule;

const appExePath = resolve(process.cwd(), 'release', 'win-unpacked', 'PP-MD-PPTB-Edition.exe');
const iconPath = resolve(process.cwd(), 'build', 'icon.ico');
if (!existsSync(appExePath)) {
  console.error('release/win-unpacked/PP-MD-PPTB-Edition.exe not found. Run desktop build first.');
  process.exit(1);
}

if (!existsSync(iconPath)) {
  console.error('build/icon.ico not found.');
  process.exit(1);
}

const version = '1.0.0.0';

await rcedit(appExePath, {
  icon: iconPath,
  'file-version': version,
  'product-version': version,
  'version-string': {
    CompanyName: 'Hart of the Midlands',
    FileDescription: 'Power Platform solution documentation generator for Windows desktop.',
    ProductName: 'PP-MD - PPTB Edition',
    LegalCopyright: 'Copyright (c) Mike Hartley, Hart of the Midlands',
    OriginalFilename: 'PP-MD-PPTB-Edition.exe',
    InternalName: 'PP-MD-PPTB-Edition',
  },
});

console.log(`Stamped executable metadata: ${appExePath}`);
