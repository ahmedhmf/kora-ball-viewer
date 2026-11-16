/**
 * Copy the pinned OpenCV.js browser build to Angular's public assets.
 * Source is installed by npm; users never fetch OpenCV from third-party URLs at runtime.
 */
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const source = resolve(root, 'node_modules/@techstark/opencv-js/dist/opencv.js');
const destination = resolve(root, 'public/vendor/opencv.js');

if (!existsSync(source)) {
  console.error('[KORA] Missing OpenCV package. Run npm install first.');
  process.exitCode = 1;
} else {
  mkdirSync(resolve(root, 'public/vendor'), { recursive: true });
  if (!existsSync(destination) || statSync(source).size !== statSync(destination).size) {
    copyFileSync(source, destination);
  }
  console.log('[KORA] OpenCV browser asset is available at /vendor/opencv.js');
}
