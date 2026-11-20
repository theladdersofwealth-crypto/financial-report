import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const origin='https://desk.test';
const setupToken='test-only-long-random-bootstrap-code-298472019';
const adminPassword='Admin-test-2026!';
const memberPassword='Member-test-2026!';

test('private desk authentication, member management and real-time room',async t=>{
  const mf=new Miniflare(convertV4MiniflareOptions({
    modules:['worker','room','market','analysis'].map(name=>({type:'ESModule',path:resolve(`src/${name}.js`)})),
    compatibilityDate:'2026-11-01',
    durableObjects:{DESK:{className:'DeskRoom',useSQLite:true}},
    bindings:{BOOTSTRAP_TOKEN_SHA256:createHash('sha256').update(setupToken).digest('hex')},
    serviceBindings:{ASSETS:()=>new Response('static asset')},
  }));
  t.after(()=>mf.dispose());
  async function request(path,{method='GET',body,cookie,requestOrigin=origin,headers={}}={}){
    const h={Origin:requestOrigin,...headers};
    if(cookie)h.Cookie=cookie;
    if(body!==undefined)h['Content-Type']='application/json';
    return mf.dispatchFetch(origin+path,{method,headers:h,body:body===undefined?undefined:JSON.stringify(body)});
  }
  let adminCookie,memberCookie,memberId;
  await t.test('setup requires private code and is single-use',async()=>{
    let r=await request('/api/status');
    assert.equal(r.status,200);
    const status=await r.json();assert.equal(status.initialized,false);assert.equal(status.setupAvailable,true);
    r=await request('/api/me');assert.equal(r.status,401);
    r=await request('/api/setup',{method:'POST',body:{token:'wrong',username:'owner',name:'관리자',password:adminPassword}});
    assert.ok([401,403].includes(r.status));
    r=await request('/api/setup',{method:'POST',body:{token:setupToken,username:'owner',name:'관리자',password:adminPassword}});
    assert.ok([200,201].includes(r.status),await r.clone().text());
    adminCookie=r.headers.get('Set-Cookie')?.split(';')[0];assert.ok(adminCookie);
    assert.match(r.headers.get('Set-Cookie'),/HttpOnly/i);assert.match(r.headers.get('Set-Cookie'),/Secure/i);
    assert.equal((await r.json()).user.role,'admin');
    r=await request('/api/setup',{method:'POST',body:{token:setupToken,username:'another',name:'다른 관리자',password:adminPassword}});
    assert.ok([403,409].includes(r.status));
  });
  await t.test('cross-origin writes and unauthenticated data are blocked',async()=>{
    let r=await request('/api/admin/users',{method:'POST',cookie:adminCookie,requestOrigin:'https://evil.test',body:{username:'bad',name:'bad',password:memberPassword,role:'admin'}});
    assert.equal(r.status,403);
    r=await request('/api/admin/users');assert.equal(r.status,401);
    r=await request('/api/chat/history');assert.equal(r.status,401);
    r=await request('/api/market');assert.equal(r.status,401);
  });
  await t.test('admin creates real-name account and temporary password must change',async()=>{
    let r=await request('/api/admin/users',{method:'POST',cookie:adminCookie,body:{username:'friend',name:'김투자',password:memberPassword,role:'member'}});
    assert.ok([200,201].includes(r.status),await r.clone().text());
    r=await request('/api/admin/users',{cookie:adminCookie});
    const list=await r.json();const member=list.users.find(x=>x.username==='friend');assert.ok(member);memberId=member.id;
    assert.ok(!JSON.stringify(list).includes('passwordHash'));assert.ok(!JSON.stringify(list).includes('password_hash'));
    r=await request('/api/login',{method:'POST',body:{username:'friend',password:memberPassword}});
    assert.equal(r.status,200);memberCookie=r.headers.get('Set-Cookie').split(';')[0];
    assert.equal((await r.json()).user.mustChangePassword,true);
    r=await request('/api/admin/users',{cookie:memberCookie});assert.equal(r.status,403);
    r=await request('/api/password',{method:'POST',cookie:memberCookie,body:{currentPassword:memberPassword,newPassword:'Changed-member-2026!'}});
    assert.equal(r.status,200,await r.clone().text());
    const changedCookie=r.headers.get('Set-Cookie')?.split(';')[0];if(changedCookie)memberCookie=changedCookie;
    r=await request('/api/me',{cookie:memberCookie});assert.equal((await r.json()).user.mustChangePassword,false);
  });
  const sockets=[];
  t.after(()=>sockets.forEach(s=>{try{s.ws.close()}catch{}}));
  async function connect(cookie){
    const res=await request('/api/ws',{cookie,headers:{Upgrade:'websocket'}});
    assert.equal(res.status,101);
    const ws=res.webSocket;assert.ok(ws);const messages=[];
    ws.addEventListener('message',e=>{try{messages.push(JSON.parse(e.data))}catch{}});
    ws.accept();const connection={ws,messages};sockets.push(connection);return connection;
  }
  async function until(predicate){
    const end=Date.now()+5000;
    while(Date.now()<end){const v=predicate();if(v)return v;await new Promise(r=>setTimeout(r,25));}
    assert.fail('Timed out waiting for WebSocket state');
  }
  await t.test('presence deduplicates tabs and chat requires threshold',async()=>{
    const a=await connect(adminCookie);await until(()=>a.messages.some(m=>m.type==='state'&&m.count===1));
    const a2=await connect(adminCookie);await until(()=>a2.messages.some(m=>m.type==='state'&&m.count===1));
    a.ws.send(JSON.stringify({type:'chat',text:'one user should not send'}));
    await until(()=>a.messages.some(m=>m.type==='error'));
    const b=await connect(memberCookie);await until(()=>b.messages.some(m=>m.type==='state'&&m.count===2));
    a.ws.send(JSON.stringify({type:'chat',text:'함께 보는 시황 데스크'}));
    const received=await until(()=>b.messages.find(m=>m.type==='message'&&m.message?.text==='함께 보는 시황 데스크'));
    assert.equal(received.message.name,'관리자');
    const r=await request('/api/chat/history',{cookie:memberCookie});
    assert.ok((await r.json()).messages.some(m=>m.text==='함께 보는 시황 데스크'));
  });
  await t.test('administrator audit and account revocation',async()=>{
    let r=await request('/api/admin/activity',{cookie:adminCookie});assert.equal(r.status,200);const activity=await r.json();assert.ok(Array.isArray(activity.sessions));
    r=await request('/api/admin/users/'+memberId,{method:'PATCH',cookie:adminCookie,body:{disabled:true}});assert.equal(r.status,200);
    r=await request('/api/me',{cookie:memberCookie});assert.equal(r.status,401);
    r=await request('/api/logout',{method:'POST',cookie:adminCookie});assert.equal(r.status,200);
    r=await request('/api/me',{cookie:adminCookie});assert.equal(r.status,401);
  });
});
