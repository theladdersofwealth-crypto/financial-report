import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
const output=resolve(process.argv[2] || '../market-desk-delivery');
await mkdir(output,{recursive:true});
const [html,css,js]=await Promise.all(['public/index.html','public/styles.css','public/app.js'].map(x=>readFile(x,'utf8')));
const standalone=html
  .replace('<link rel="stylesheet" href="/styles.css" />',`<style>${css.replaceAll('</style','<\\/style')}</style>`)
  .replace('<script type="module" src="/app.js"></script>',`<script type="module">${js.replaceAll('</script','<\\/script')}</script>`);
await writeFile(resolve(output,'market-desk-preview.html'),standalone);
console.log('Standalone demo preview exported; no account records or private setup code included.');
