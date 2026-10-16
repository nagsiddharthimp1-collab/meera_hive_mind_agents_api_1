const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');
const React = require('react');
const {renderToStaticMarkup} = require('react-dom/server');
const source = fs.readFileSync('src/components/Conversation/index.tsx', 'utf8');
const header = source.slice(source.search(/<header\s/), source.indexOf('</header>') + '</header>'.length);
function compile(source, deps={}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText,{exports,require:name=>deps[name]||require(name),process,Date});
  return exports;
}
const {isPaidPlanActive} = compile(fs.readFileSync('src/lib/subscriptionUtils.ts','utf8'));
// Render the exact header JSX with the shared paid-access predicate.
const raw = ts.transpileModule(`import React from 'react'; export default ({showSubscribe})=>(${header});`,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText;
const headerExports = {};
vm.runInNewContext(raw,{exports:headerExports,require,process,headerRef:null,isImagesView:false,isConnectorsView:false,isSidebarVisible:false,handleSelectSidebarView:()=>{},handleOpenMobileSidebar:()=>{},handleToggleDesktopSidebar:()=>{},handleOpenUpgrade:()=>{},FiMenu:()=>null,FiArrowLeft:()=>null});
for(const [label,subscription,visible] of [
  ['unpaid',{plan_type:'free_trial',subscription_end_date:null},true],
  ['lifetime',{plan_type:'paid',subscription_end_date:null},false],
  ['active monthly',{plan_type:'paid',subscription_end_date:'2099-01-01'},false],
  ['expired',{plan_type:'paid',subscription_end_date:'2020-01-01'},true],
]) {
  const markup=renderToStaticMarkup(React.createElement(headerExports.default,{showSubscribe:!isPaidPlanActive(subscription)}));
  assert.equal(markup.includes('>Subscribe</button>'),visible,label);
}
assert.match(source,/onClick=\{handleOpenUpgrade\}/);
assert.match(source,/openModal\('upgrade_button', true\)/);
console.log('PASS exact header rendering: unpaid and expired see Subscribe; lifetime and active paid do not; action opens checkout');
