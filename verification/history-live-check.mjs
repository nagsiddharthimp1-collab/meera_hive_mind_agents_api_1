import {createRequire} from 'node:module';
import fs from 'node:fs';
const require=createRequire('C:/Users/siddh/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json');
const {chromium}=require('playwright');
const session=JSON.parse(fs.readFileSync('.vercel/history-smoke-session.json','utf8').replace(/^\uFEFF/,''));
if(session.user.id!=='d125a2c0-94b1-47c6-a154-98392ef60c6f')throw Error('Wrong account');
const env=fs.readFileSync('.vercel/.env.production.local','utf8');
const supabaseUrl=env.match(/^NEXT_PUBLIC_SUPABASE_URL\s*=\s*["']?([^\s"'\r\n]+)/m)[1];
const storageKey='sb-'+new URL(supabaseUrl).hostname.split('.')[0]+'-auth-token';
const anon=env.match(/^NEXT_PUBLIC_SUPABASE_ANON_KEY\s*=\s*["']?([^\s"'\r\n]+)/m)[1];
const history=await fetch('https://xilapyewazpzlvqbbtgl.supabase.co/rest/v1/messages?select=message_id,timestamp,session_id&user_id=eq.'+session.user.id+'&order=timestamp.desc&limit=20',{headers:{'Accept-Profile':'public',apikey:anon,Authorization:'Bearer '+session.access_token}});
const historyRows=await history.json();
if(!history.ok||!Array.isArray(historyRows))throw Error('Owner history request failed');
console.log('DIRECT_HISTORY',history.status,'rows',historyRows.length,'missing timestamps',historyRows.filter(r=>!r.timestamp).length);
const browser=await chromium.launch({headless:true,channel:'msedge'});
const context=await browser.newContext({viewport:{width:1440,height:950}});
if(fs.existsSync('.vercel/history-cookies.txt')){
 const cookies=fs.readFileSync('.vercel/history-cookies.txt','utf8').split('\n').filter(l=>l.trim()&&(!l.startsWith('#')||l.startsWith('#HttpOnly_'))).map(l=>{
  const [domain,,path,secure,expires,name,value]=l.replace(/^#HttpOnly_/,'').trim().split('\t');
  return {domain,path,secure:secure==='TRUE',expires:Number(expires)||-1,name,value,httpOnly:l.startsWith('#HttpOnly_')};
 });
 await context.addCookies(cookies);
}
const page=await context.newPage();
const base=process.env.TEST_BASE_URL||'https://www.himeera.com';
if(fs.existsSync('.vercel/history-protection.json')){
 const p=JSON.parse(fs.readFileSync('.vercel/history-protection.json','utf8').replace(/^\uFEFF/,''));
 const bypass=Object.keys(p).find(k=>p[k]?.scope==='automation-bypass')||Object.keys(p)[0];
 await page.route('**/*',route=>new URL(route.request().url()).origin===new URL(base).origin
  ?route.continue({headers:{...route.request().headers(),'x-vercel-protection-bypass':bypass}})
  :route.fallback());
}
const errors=[],historyStatuses=[];
page.on('console',m=>{if(m.type()==='error'&&m.text().includes('Error fetching chat history'))errors.push(m.text());});
page.on('pageerror',e=>errors.push(e.message));
page.on('response',r=>{if(r.url().includes('/rest/v1/messages'))historyStatuses.push(r.status());});
page.on('response',r=>{if(r.status()>=400||r.url().includes('/user/balance')||r.url().includes('/auth/v1/'))console.log('REQUEST_STATUS',r.status(),new URL(r.url()).origin+new URL(r.url()).pathname);});
let injected=false;
if(process.env.TEST_NULL_TIMESTAMP==='1')await page.route('**/rest/v1/messages?**',async route=>{
 if(route.request().method()!=='GET')return route.continue();
 const response=await route.fetch();
 const rows=await response.json();
 if(Array.isArray(rows)&&rows.length&&rows.every(r=>r.user_id===session.user.id)){
  rows[0].timestamp=null;injected=true;
  return route.fulfill({response,json:rows});
 }
 return route.fulfill({response});
});
await page.route('**/api/log-*',r=>r.fulfill({json:{success:true}}));
await context.addInitScript(({session,storageKey})=>localStorage.setItem(storageKey,JSON.stringify(session)),{session,storageKey});
await page.goto(base,{waitUntil:'domcontentloaded',timeout:120000});
try{
 await page.locator('.meera-chat-shell').waitFor({timeout:60000});
 await page.waitForTimeout(4000);
 if(await page.getByText('Failed to load messages. Please check your connection and try again.',{exact:true}).count())throw Error('History error screen is still present');
 if(!historyStatuses.length||historyStatuses.some(s=>s!==200))throw Error('Browser history request failed: '+historyStatuses.join(','));
 if(errors.length)throw Error(errors.join('\n'));
 if(!(await page.locator('main').innerText()).trim())throw Error('History pane is empty');
 if(process.env.TEST_NULL_TIMESTAMP==='1'&&!injected)throw Error('Null timestamp response was not injected');
 await page.reload({waitUntil:'domcontentloaded'});
 await page.locator('.meera-chat-shell').waitFor({timeout:60000});
 await page.waitForTimeout(3000);
 if(await page.getByText('Failed to load messages. Please check your connection and try again.',{exact:true}).count())throw Error('History fails after refresh');
 await page.screenshot({path:process.env.TEST_NULL_TIMESTAMP==='1'?'verification/history-null-timestamp-pass.png':'verification/history-production-pass.png'});
 console.log('PASS authenticated history renders and survives refresh; null-response test:',injected);
}catch(error){
 console.log('FAILED_PAGE',page.url(),(await page.locator('body').innerText()).slice(0,700),historyStatuses,errors);
 console.log('SESSION_STORAGE',await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.includes('auth-token')).map(k=>({key:k,user:JSON.parse(localStorage.getItem(k)||'{}').user?.id,expires:JSON.parse(localStorage.getItem(k)||'{}').expires_at}))));
 await page.screenshot({path:'verification/history-production-diagnostic.png'});
 throw error;
}finally{await browser.close();}
