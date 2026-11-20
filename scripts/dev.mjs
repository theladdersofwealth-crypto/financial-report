import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
const args=process.argv.slice(2);
let host='0.0.0.0',port=process.env.PORT || '8787';
for(let i=0;i<args.length;i++){
  if(['--host','--hostname','--ip'].includes(args[i]))host=args[++i] || host;
  else if(args[i]==='--port')port=args[++i] || port;
  else if(args[i].startsWith('--port='))port=args[i].split('=')[1];
}
const child=spawn(process.execPath,[resolve('node_modules/wrangler/bin/wrangler.js'),'dev','--ip',host,'--port',port,'--local','--persist-to','.wrangler/state'],{
  stdio:'inherit',env:{...process.env,WRANGLER_SEND_METRICS:'false',...(process.env.SITES_MANAGED_LINUX_CONTAINER==='1'?{XDG_CONFIG_HOME:'/tmp/market-desk-config'}:{})}
});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
child.on('exit',code=>process.exit(code ?? 1));
