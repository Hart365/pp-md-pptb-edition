/* Validates the PPTB manifest without network reachability checks for local builds. */
const fs = require('node:fs');
const path = require('node:path');
const { validatePackageJson } = require('@pptb/validate');

async function validateOffline() {
  const packagePath = path.resolve('package.json');
  const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  const result = await validatePackageJson(packageJson, { skipUrlChecks: true });

  result.errors.forEach((message) => console.error(`Manifest error: ${message}`));
  result.warnings.forEach((message) => console.warn(`Manifest warning: ${message}`));
  if (!result.valid) process.exitCode = 1;
}

validateOffline().catch((error) => {
  console.error(`Manifest validation failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});