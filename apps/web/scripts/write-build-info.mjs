import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

let sha = process.env.CF_PAGES_COMMIT_SHA || process.env.GITHUB_SHA || process.env.COMMIT_SHA || '';
if (!/^[a-f0-9]{7,40}$/i.test(sha)) {
  try { sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); }
  catch { sha = ''; }
}
const id = /^[a-f0-9]{7,40}$/i.test(sha) ? sha.slice(0, 8) : 'unknown';
writeFileSync(new URL('../src/app/build-info.ts', import.meta.url),
  '// Generated during build; do not edit.\nexport const BUILD_ID = ' + JSON.stringify(id) + ';\n');
console.log('Application build:', id);
