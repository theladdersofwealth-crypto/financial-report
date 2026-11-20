import { readdir, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
for (const dir of ['src', 'public']) {
  for (const name of await readdir(dir)) {
    if (name.endsWith('.js')) execFileSync(process.execPath,['--check',`${dir}/${name}`],{stdio:'inherit'});
  }
}
const html=await readFile('public/index.html','utf8');
if (!html.includes('lang="ko"')) throw new Error('한국어 lang 지정 필요');
for (const file of ['public/app.js','public/styles.css','src/worker.js','src/room.js','src/market.js']) {
  if (!(await readFile(file,'utf8')).trim()) throw new Error(`Empty ${file}`);
}
console.log('JavaScript syntax and application files checked.');
