/**
 * Post-build script for Lambda deployment
 * Copies package.json and installs production dependencies
 */

import { copyFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const distDir = join(rootDir, 'dist');

// Copy package.json to dist
console.log('Copying package.json to dist...');
copyFileSync(join(rootDir, 'package.json'), join(distDir, 'package.json'));

// Create a minimal package.json for Lambda
const minimalPackage = {
  name: '@music-service/api',
  version: '1.0.0',
  type: 'module',
  main: 'index.js',
  dependencies: {
    '@aws-sdk/client-secrets-manager': '^3.700.0',
    pino: '^10.1.0',
  },
};

writeFileSync(join(distDir, 'package.json'), JSON.stringify(minimalPackage, null, 2));

// Install production dependencies in dist
console.log('Installing production dependencies...');
execSync('npm install --omit=dev --package-lock=false', {
  cwd: distDir,
  stdio: 'inherit',
});

console.log('Build completed successfully!');
