const fs=require('fs');const Module=require('module');const ts=require('typescript');
const env=require('dotenv').parse(fs.readFileSync('.vercel/.env.production.local'));Object.assign(process.env,env);
const original=Module._load;
Module._load=function(request,parent,isMain){if(request==='server-only')return {};return original.apply(this,arguments)};
require.extensions['.ts']=function(module,path){module._compile(ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,path)};
const {loadDashboard,loadAi}=require('../src/lib/analyticsDashboardServer.ts');
const {createClient}=require('@supabase/supabase-js');
const s=createClient(env.SUPABASE_URL||env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
(async()=>{
 const start=Date.now();const from='2026-09-13',to='2026-10-12';
 const [full,ai]=await Promise.all([loadDashboard(s,from,to),loadAi(s,from,to)]);
 const {details,...dashboard}=full;
 if(!dashboard.metrics.activeUsers.value||!ai.current.requests)throw Error('Expected observed real activity');
 if(dashboard.daily.reduce((s,p)=>s+p.messages,0)!==dashboard.metrics.messages.value)throw Error('Message totals mismatch');
 if(dashboard.daily.reduce((s,p)=>s+p.revenue,0)!==dashboard.metrics.revenue.value)throw Error('Revenue totals mismatch');
 if(ai.daily.reduce((s,p)=>s+p.tokens,0)!==ai.current.tokens)throw Error('AI daily tokens mismatch');
 const publicUsers=details.map((u,i)=>({...u,id:'fixture-'+i,name:'Fixture user '+i,email:'fixture-'+i+'@example.test'}));
 fs.writeFileSync('verification/analytics-real-fixtures.json',JSON.stringify({dashboard,ai,users:{users:publicUsers,total:details.length}},null,2));
 console.log(JSON.stringify({passed:true,durationMs:Date.now()-start,metrics:dashboard.metrics,ai:ai.current,cohorts:dashboard.retention.length,channels:dashboard.channels.length}));
 for(const range of [['2026-10-12','today'],['2026-10-06','7 days'],['2026-07-15','90 days'],['2025-11-15','lifetime']]){const started=Date.now();const [p,a]=await Promise.all([loadDashboard(s,range[0],to),loadAi(s,range[0],to)]);if(p.daily.reduce((s,d)=>s+d.messages,0)!==p.metrics.messages.value||a.daily.reduce((s,d)=>s+d.requests,0)!==a.current.requests)throw Error('Range totals mismatch');console.log(JSON.stringify({range:range[1],durationMs:Date.now()-started,users:p.metrics.totalUsers.value,active:p.metrics.activeUsers.value,requests:a.current.requests}));}
})().catch(e=>{console.error(e.message);process.exitCode=1});
