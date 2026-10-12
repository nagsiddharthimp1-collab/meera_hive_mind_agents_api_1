import { createRequire } from 'node:module';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { matchesSegment } from '../src/lib/analyticsDashboardMetrics.ts';
const require = createRequire('C:/Users/siddh/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json');
const { chromium } = require('playwright');
const base = process.env.TEST_BASE_URL || 'http://localhost:3095';
const fixture = JSON.parse(fs.readFileSync('verification/analytics-real-fixtures.json','utf8'));
const env = fs.readFileSync('.vercel/.env.production.local','utf8');
const supabaseUrl = env.match(/^NEXT_PUBLIC_SUPABASE_URL\s*=\s*["']?([^\s"'\r\n]+)/m)?.[1];
const storageKey = `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`;
const browser = await chromium.launch({ headless:true, channel:'msedge' });
const context = await browser.newContext({ viewport:{ width:1440,height:1000 }, reducedMotion:'reduce' });
if(process.env.VERCEL_TEST_COOKIE_FILE){
 const cookies=fs.readFileSync(process.env.VERCEL_TEST_COOKIE_FILE,'utf8').split('\n').filter(line=>line.trim()&&(!line.startsWith('#')||line.startsWith('#HttpOnly_'))).map(line=>{const [domain,_sub,path,secure,expires,name,value]=line.replace(/^#HttpOnly_/,'').trim().split('\t');return {domain,path,secure:secure==='TRUE',expires:Number(expires)||-1,name,value,httpOnly:line.startsWith('#HttpOnly_')};});
 await context.addCookies(cookies);
}
await context.addInitScript(({storageKey})=>{
 const enc=o=>btoa(JSON.stringify(o));const user={id:'00000000-0000-4000-8000-000000000001',aud:'authenticated',role:'authenticated',email:'analytics-fixture@himeera.com',app_metadata:{provider:'email'},user_metadata:{},created_at:'2026-01-01T00:00:00Z'};
 localStorage.setItem(storageKey,JSON.stringify({access_token:enc({alg:'HS256',typ:'JWT'})+'.'+enc({exp:4102444800,sub:user.id,role:'authenticated'})+'.test',refresh_token:'test-only',expires_at:4102444800,expires_in:3600,token_type:'bearer',user}));
},{storageKey});
let failProduct=false,failAi=false,calls=[],oldSummaryCalls=0;
await context.route('**/*',async route=>{
 const url=new URL(route.request().url());
 if(url.pathname==='/api/analytics/me')return route.fulfill({json:{email:'analytics-fixture@himeera.com',role:'analyst',permissions:['analytics.view','users.list','users.view_pii','growth_links.view']}});
 if(url.pathname==='/api/analytics/dashboard'){
  calls.push(url.searchParams.toString());
  if(failProduct)return route.fulfill({status:503,json:{error:'Product analytics temporarily unavailable.'}});
  if(url.searchParams.has('segment')){
   const seg=url.searchParams.get('segment'),q=url.searchParams.get('q')||'',source=url.searchParams.get('source'),page=Number(url.searchParams.get('page')||0);
   const users=fixture.users.users.filter(u=>matchesSegment(u,seg)&&(!source||u.source===source)&&(!q||[u.name,u.email,u.id,u.source].some(s=>s?.toLowerCase().includes(q))));
   return route.fulfill({json:{users:users.slice(page*25,page*25+25),total:users.length,page}});
  }
  return route.fulfill({json:{...fixture.dashboard,...Object.fromEntries(['from','to'].map(k=>[k,url.searchParams.get(k)]))}});
 }
 if(url.pathname==='/api/analytics/dashboard-ai')return route.fulfill({status:failAi?503:200,json:failAi?{error:'AI telemetry temporarily unavailable.'}:fixture.ai});
 if(url.pathname==='/api/analytics/executive'||url.pathname==='/api/analytics/funnel'){oldSummaryCalls++;return route.fulfill({status:500,json:{error:'Legacy call must not occur'}});}
 if(url.pathname==='/api/analytics/range')return route.fulfill({json:{from:'2025-11-15'}});
 if(url.pathname==='/api/auth/session')return route.fulfill({json:{}});
 if(url.origin!==new URL(base).origin)return route.fulfill({json:[]});
 return route.continue();
});
const page=await context.newPage();page.setDefaultTimeout(45000);page.setDefaultNavigationTimeout(120000);
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const check=(value,label)=>{assert.ok(value,label);console.log('PASS',label);};
await page.goto(base+'/analytics',{waitUntil:'domcontentloaded'});
await page.getByRole('heading',{name:'The business, at a glance'}).waitFor();
await page.getByText('40',{exact:true}).first().waitFor();
check(await page.getByRole('heading',{name:'Who is using Meera?'}).isVisible(),'home includes user breakdown');
check(await page.locator('#snapshot').innerText().then(t=>t.includes('₹499')),'real-data revenue renders');
const cards=page.locator('#snapshot article');
check(await cards.count()===8,'eight headline cards remain');
check((await cards.allTextContents()).map(t=>t.match(/Registered users|New signups|Active users|Returning users|Avg\. messages \/ new user|Payment opened|Paying customers|Revenue collected/)?.[0]).join('|')==='Registered users|New signups|Active users|Returning users|Avg. messages / new user|Payment opened|Paying customers|Revenue collected','headline cards follow acquisition, engagement, monetization');
check(await cards.filter({hasText:'Avg. messages / new user'}).innerText().then(t=>t.includes('3.4')),'new-user message average renders');
await cards.filter({hasText:'Payment opened'}).getByRole('button').click();
await page.locator('[aria-label="Filtered users"] tbody tr').first().waitFor();
check(calls.some(s=>s.includes('segment=opened')),'payment opened card drills into distinct openers');
await page.getByRole('button',{name:'Close breakdown'}).click();
check((await page.locator('svg[role="img"]').count())>=5,'growth, engagement, revenue, cost and request graphs render');
check(await page.locator('#retention tbody tr').count()>0,'retention cohorts render');
check(await page.locator('#ai-activity').innerText().then(t=>t.includes('1,563')),'recorded AI requests render');
check(oldSummaryCalls===0,'home avoids failed legacy summary and funnel calls');
await page.screenshot({path:'verification/analytics-dashboard-desktop.png',fullPage:true});
await page.screenshot({path:'verification/analytics-dashboard-desktop-hero.png'});
await page.getByRole('combobox',{name:'Growth chart metric'}).selectOption('active');
await page.getByRole('heading',{name:'Active-user trend'}).waitFor();check(true,'growth metric switch works');
await page.locator('#growth').getByText('View chart data',{exact:true}).click();
check(await page.locator('#growth details table tbody tr').count()===30,'accessible chart table includes every day');
await page.getByRole('button',{name:/New signups.*40/}).click();
await page.getByRole('heading',{name:'New users',exact:true}).waitFor();
check(await page.getByLabel('Filtered users').locator('tbody tr').count()>0,'inline segment drilldown loads');
await page.getByLabel('Search filtered users').fill('no-match-zzz');
await page.getByText('No users match these filters.').waitFor();check(true,'user search handles no matches');
await page.getByRole('button',{name:'Close breakdown'}).click();
await page.getByLabel('Analytics period').selectOption('7');
await page.getByText('40',{exact:true}).first().waitFor();
check(calls.some(q=>q.includes('from=2026-10-06')&&q.includes('to=2026-10-12')),'shared preset sends correct inclusive seven-day window');
await page.getByLabel('Analytics start date').fill('2026-10-12');await page.getByLabel('Analytics end date').fill('2026-10-01');
await page.getByRole('button',{name:'Apply',exact:true}).click();await page.getByRole('alert').filter({hasText:'Choose an ordered date range'}).waitFor();check(true,'invalid range is blocked');
await page.getByLabel('Analytics period').selectOption('30');await page.getByText('40',{exact:true}).first().waitFor();
const download=page.waitForEvent('download');await page.getByRole('button',{name:'↓ Export trends'}).click();const downloaded=await download;check(downloaded.suggestedFilename().endsWith('.csv'),'trend export downloads CSV');
failAi=true;await page.getByRole('button',{name:'↻ Refresh'}).click();await page.getByRole('alert').filter({hasText:'AI telemetry temporarily unavailable.'}).waitFor();check(await page.locator('#snapshot').innerText().then(t=>t.includes('₹499')),'AI failure preserves product metrics');
failAi=false;failProduct=true;await page.getByRole('button',{name:'↻ Refresh'}).click();await page.getByRole('alert').filter({hasText:'Product analytics temporarily unavailable.'}).waitFor();check(!(await page.locator('#snapshot').innerText()).includes('₹0'),'product failure does not invent zero revenue');
failProduct=false;await page.getByRole('button',{name:'↻ Refresh'}).click();await page.getByText('40',{exact:true}).first().waitFor();check(true,'refresh recovers both sources');
await page.getByText('Explore recent activity', {exact:false}).click();await page.getByLabel('Filter activity by status').selectOption('failure');
check((await page.getByLabel('Filter activity by status').locator('..').locator('..').locator('tbody').innerText()).includes('Success')===false,'request status filter works');
await page.getByText('Explore recent activity', {exact:false}).click();
await page.locator('#growth').getByText('View chart data',{exact:true}).click();
for(const width of [1440,1024,768,550,390,320]){
 await page.setViewportSize({width,height:900});await page.evaluate(()=>scrollTo(0,0));
 check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${width}px viewport has no horizontal page overflow`);
 if(width===390)await page.screenshot({path:'verification/analytics-dashboard-mobile-hero.png'});
 if(width===390||width===320)await page.screenshot({path:`verification/analytics-dashboard-mobile-${width}.png`,fullPage:true});
}
check(errors.length===0,'no browser runtime errors');
console.log(JSON.stringify({errors,oldSummaryCalls,requests:calls.length}));await browser.close();
