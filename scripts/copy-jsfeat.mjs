import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
const source = resolve('node_modules/jsfeat/build/jsfeat-min.js');
const target = resolve('public/vendor/jsfeat.min.js');
if (!existsSync(source)) {
  console.error('Missing jsfeat. Please run npm install first.');
  process.exitCode = 1;
} else {
  mkdirSync(resolve('public/vendor'), { recursive: true });
  copyFileSync(source, target);
  console.log('KORA: using locally hosted JSFeat; no OpenCV runtime required.');
}
