import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const origin='https://desk.test';
const setupToken='test-only-long-random-bootstrap-code-298472019';
const adminPassword='Admin-test-2026!';
const memberPassword='Member-test-2026!';
const workerModules = ['worker-entry','worker','room','market','kis','briefing','live-futures','impact','us-session','validation','market-deploy-snapshot','analysis','calendar','calendar-deploy-snapshot','instrument-search']
  .map(name=>({type:'ESModule',path:resolve(`src/${name}.js`)}))
  .concat(['fx-currencies','futures-config'].map(name=>({type:'ESModule',path:resolve(`public/${name}.js`)})));

test('private desk authentication, member management and real-time room',async t=>{
  const mf=new Miniflare(convertV4MiniflareOptions({
    modules: workerModules,
    compatibilityDate:'2026-11-01',
    durableObjects:{DESK:{className:'DeskRoom',useSQLite:true}},
    bindings:{BOOTSTRAP_TOKEN_SHA256:createHash('sha256').update(setupToken).digest('hex')},
    serviceBindings:{ASSETS:()=>new Response('static asset')},
    outboundService: async request => {
      const url = new URL(request.url);
      if (url.searchParams.get('contract') !== 'mark_SPX500_USDT') return new Response(null,{status:404});
      return Response.json([{t:Math.floor(Date.now()/1000),o:'7000',h:'7005',l:'6990',c:'7001'}]);
    },
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
    r=await request('/api/pin-register',{method:'POST',body:{nickname:'첫방문',pin:'0123',birth6:'950705',gender:'남'}});assert.equal(r.status,503);
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
    r=await request('/api/calendar');assert.equal(r.status,401);
    r=await request('/api/futures');assert.equal(r.status,401);
    r=await request('/api/futures?id=fut_es&period=5min&venue=gate',{cookie:adminCookie});
    assert.equal(r.status,200);
    const chart = await r.json();
    assert.equal(chart.status,'ready');
    assert.equal(chart.contract,'SPX500_USDT');
    r=await request('/api/futures?id=SPX&period=5min',{cookie:adminCookie});
    assert.equal(r.status,400);
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
  await t.test('member enrollment requires nickname, real YYMMDD, gender and PIN; legacy password accounts stay distinct',async()=>{
    const submit=(nickname,pin,headers)=>request('/api/pin-login',{method:'POST',body:{nickname,pin},headers});
    const register=(nickname,pin,birth6='950705',gender='남',headers)=>request('/api/pin-register',{
      method:'POST',body:{nickname,pin,birth6,gender},headers
    });
    assert.equal((await submit('새손님',1234)).status,400);
    assert.equal((await submit('새손님','12345')).status,400);
    assert.equal((await submit('새손님','0123')).status,401,'no automatic nickname registration');
    assert.equal((await submit('owner','0123')).status,401,'admin account cannot be overwritten with PIN');
    assert.equal((await register('가입검사','0123','990229','남')).status,400,'invalid leap day');
    assert.equal((await register('가입검사','0123','951332','남')).status,400,'invalid month/day');
    assert.equal((await register('가입검사','0123','950705','X')).status,400,'only selected two gender options');
    assert.equal((await request('/api/pin-register',{method:'POST',body:{nickname:'가입검사',pin:'0123',birth6:'950705'}})).status,400);
    assert.equal((await register('가입검사',1234)).status,400);
    assert.equal((await register('가입검사','0000', '000229','여')).status,200,'2000 leap date allowed');

    // Duplicate nickname is refused; registration cannot silently login as
    // another account with matching nickname, even if PIN happens to match.
    const responses=await Promise.all([
      register('한글 닉네임','0123','950705','남'),
      register('한글  닉네임','0123','950705','남'),
    ]);
    assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
    const created=responses.find(r=>r.status===200);
    const {user}=await created.clone().json();
    assert.equal(user.pinLogin,true);
    assert.equal(user.mustChangePassword,false);
    assert.equal(user.role,'member');
    assert.equal(user.birth6,'950705');
    assert.equal(user.gender,'남');
    const firstCookie=created.headers.get('Set-Cookie').split(';')[0];
    let r=await request('/api/me',{cookie:firstCookie});
    assert.equal(r.status,200);
    assert.equal((await r.json()).user.birth6,'950705');
    r=await request('/api/admin/users',{cookie:adminCookie});
    const adminList=await r.json();
    const entry=adminList.users.find(x=>x.id===user.id);
    assert.ok(entry);
    assert.equal(entry.birth6,undefined,'birthdate must not appear in admin/member lists');
    assert.equal(entry.gender,undefined,'gender must not appear in admin/member lists');
    assert.doesNotMatch(JSON.stringify(adminList),/950705/);
    assert.equal((await request('/api/chat/history',{cookie:firstCookie})).status,403);
    assert.equal((await request('/api/ws',{cookie:firstCookie,headers:{Upgrade:'websocket'}})).status,403);
    assert.equal((await request('/api/admin/users',{cookie:firstCookie})).status,403);
    assert.equal((await request('/api/login',{method:'POST',body:{username:'한글 닉네임',password:'0123'}})).status,401);
    assert.equal((await request('/api/profile',{method:'PATCH',cookie:adminCookie,body:{birth6:'900101',gender:'여',pin:'0123'}})).status,403);
    assert.equal((await request('/api/profile',{method:'PATCH',cookie:firstCookie,body:{birth6:'951332',gender:'여',pin:'0123'}})).status,400);
    assert.equal((await request('/api/profile',{method:'PATCH',cookie:firstCookie,body:{birth6:'960222',gender:'여',pin:'5678'}})).status,401);
    r=await request('/api/profile',{method:'PATCH',cookie:firstCookie,body:{birth6:'960222',gender:'여',pin:'0123'}});
    assert.equal(r.status,200,await r.clone().text());
    assert.equal((await r.json()).user.gender,'여');
    assert.equal((await request('/api/me',{cookie:firstCookie}).then(x=>x.json())).user.birth6,'960222');
    const changed=await request('/api/password',{method:'POST',cookie:firstCookie,body:{currentPassword:'0123',newPassword:'0042'}});
    assert.equal(changed.status,200);
    assert.equal((await submit('한글 닉네임','0123')).status,401);
    const loggedIn=await submit('한글  닉네임','0042');
    assert.equal(loggedIn.status,200);
    assert.equal((await loggedIn.json()).user.id,user.id);
    for(let i=0;i<5;i++)assert.equal((await submit('한글 닉네임','1111',{'CF-Connecting-IP':`198.51.${i}.20`})).status,401);
    assert.equal((await submit('한글 닉네임','1111',{'CF-Connecting-IP':'203.0.113.20'})).status,429);
    assert.equal((await request('/api/admin/users/'+user.id,{method:'PATCH',cookie:adminCookie,body:{disabled:true}})).status,200);
    assert.equal((await request('/api/me',{cookie:firstCookie})).status,401);
  });

  await t.test('single member entry keeps profile data private and admin sign-in requires admin role', async () => {
    const member = (body) => request('/api/pin-entry',{method:'POST',body,headers:{'CF-Connecting-IP':'192.0.2.15'}});
    const nickname = '간편회원';
    const pin = '0053';
    assert.equal((await member({nickname,pin,gender:'여',age:null})).status,400);
    assert.equal((await member({nickname,pin,gender:'여',age:121})).status,400);
    assert.equal((await member({nickname,pin,gender:'여',age:10.5})).status,400);
    const created = await member({nickname,pin,gender:'여',age:32});
    assert.equal(created.status,200,await created.clone().text());
    const {user} = await created.json();
    assert.equal(user.age,32);
    assert.equal(user.gender,'여');
    assert.equal(user.birth6,null);
    const relogin = await member({nickname,pin,gender:'남',age:58});
    assert.equal(relogin.status,200);
    const returning = (await relogin.json()).user;
    assert.equal(returning.id,user.id);
    assert.equal(returning.age,32);
    assert.equal(returning.gender,'여');
    assert.equal((await member({nickname,pin})).status,200);
    assert.equal((await member({nickname,pin:'0054',gender:'여',age:32})).status,401);
    assert.equal((await member({nickname:'owner',pin,gender:'여',age:32})).status,401);
    const cookie=created.headers.get('Set-Cookie').split(';')[0];
    const profile = await request('/api/profile',{method:'PATCH',cookie,body:{age:33,gender:'여',pin}});
    assert.equal((await profile.json()).user.age,33);
    const users = await request('/api/admin/users',{cookie:adminCookie});
    assert.equal((await users.json()).users.find(entry=>entry.id===user.id).age,undefined);
    const admin = (body)=>request('/api/admin-login',{method:'POST',body});
    assert.equal((await admin({username:'friend',password:'Changed-member-2026!'})).status,401);
    assert.equal((await admin({username:'owner',password:adminPassword})).status,200);
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

test('KIS token broker shares one OAuth issuance across concurrent callers', async t => {
  let issued = 0;
  const mf = new Miniflare(convertV4MiniflareOptions({
    modules: workerModules,
    compatibilityDate: '2026-11-01',
    durableObjects: {KIS_TOKEN_BROKER: {className:'KisTokenBroker',useSQLite:true}},
    bindings: {KIS_APP_KEY:'fixture-key',KIS_APP_SECRET:'fixture-secret'},
    outboundService: async request => {
      assert.equal(new URL(request.url).pathname,'/oauth2/tokenP');
      const number = ++issued;
      await new Promise(resolve=>setTimeout(resolve,20));
      return Response.json({access_token:`fixture-token-${number}`,expires_in:86400});
    },
  }));
  t.after(()=>mf.dispose());
  const broker = await mf.getDurableObjectNamespace('KIS_TOKEN_BROKER');
  const first = broker.getByName('market-data');
  const second = broker.getByName('market-data');
  const original = await Promise.all([first.getToken(),second.getToken()]);
  assert.deepEqual(original.map(item=>item.session.token),['fixture-token-1','fixture-token-1']);
  const renewed = await Promise.all([first.getToken('fixture-token-1'),second.getToken('fixture-token-1')]);
  assert.deepEqual(renewed.map(item=>item.session.token),['fixture-token-2','fixture-token-2']);
  assert.equal((await second.getToken()).session.token,'fixture-token-2');
  assert.equal(issued,2);
});

test('the shared market briefing publishes once within a four-hour window', async t => {
  const mf = new Miniflare(convertV4MiniflareOptions({
    modules:workerModules, compatibilityDate:'2026-11-01',
    durableObjects:{US_BRIEFING:{className:'MarketBriefing',useSQLite:true}},
  }));
  t.after(()=>mf.dispose());
  const namespace = await mf.getDurableObjectNamespace('US_BRIEFING');
  const first = namespace.getByName('us-markets');
  const another = namespace.getByName('us-markets');
  assert.equal(await first.needsRefresh(), true);
  const sample = {status:'daily', observedAt:new Date(Date.now()-86400000).toISOString().slice(0,10),
    value:3200, change:1, changeUnit:'%'};
  const release = await first.current([{...sample, id:'kospi'}, {...sample, id:'kosdaq'}]);
  assert.match(release.headline, /종가 · 코스피 \+1\.00% · 코스닥 \+1\.00%/);
  assert.equal(await another.needsRefresh(), false);
  const sameWindow = await another.current([{...sample, id:'kospi', change:2}]);
  assert.equal(sameWindow.generatedAt, release.generatedAt);
  assert.equal(sameWindow.headline, release.headline);
});
