'use strict';
const { test, expect } = require('@playwright/test');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const PREFIX = '/HTML-COI-Linea-Roca/';
let server;
function serveFile(res,file){const body=fs.readFileSync(file);res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});res.end(body);}
test.beforeAll(async()=>{server=http.createServer((req,res)=>{if(req.url===PREFIX+'index.html'||req.url===PREFIX) return serveFile(res,path.join(ROOT,'index.html'));if(req.url===PREFIX+'stable.html')return serveFile(res,path.join(ROOT,'index_PRE_IMPUTACION_POSICIONES_R383.html'));res.writeHead(404);res.end('not found');});await new Promise(resolve=>server.listen(4173,'127.0.0.1',resolve));});
test.afterAll(async()=>{await new Promise(resolve=>server.close(resolve));});
async function instrument(page){
  await page.addInitScript(()=>{
    window.__e2e={errors:[],rejections:[],longTasks:[],listeners:0,observers:0,timers:0};
    const add=EventTarget.prototype.addEventListener;EventTarget.prototype.addEventListener=function(...args){window.__e2e.listeners++;return add.apply(this,args);};
    const MO=window.MutationObserver;window.MutationObserver=class extends MO{constructor(cb){window.__e2e.observers++;super(cb);}};
    const si=window.setInterval,st=window.setTimeout;window.setInterval=(...a)=>{window.__e2e.timers++;return si(...a)};window.setTimeout=(...a)=>{window.__e2e.timers++;return st(...a)};
    add.call(window,'error',e=>window.__e2e.errors.push(String(e.error||e.message)));add.call(window,'unhandledrejection',e=>window.__e2e.rejections.push(String(e.reason)));
    try{new PerformanceObserver(list=>list.getEntries().forEach(e=>window.__e2e.longTasks.push(e.duration))).observe({type:'longtask',buffered:true});}catch(e){}
    const empty=()=>Promise.resolve({data:null,error:null});
    const chain=new Proxy({}, {get:(_,key)=>key==='then'?undefined:()=>chain});
    window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:null},error:null}),getUser:async()=>({data:{user:null},error:null}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),signInWithPassword:empty,signOut:empty},from:()=>chain,storage:{from:()=>chain}})};
  });
}
const modules=[['btnDashboard','vistaDashboard'],['btnRed','vistaRed'],['btnCalendarioCOI','vistaCalendarioCOI'],['btnOrdenes','vistaOrdenes'],['btnCarga','vistaCarga'],['btnAdministracionSistema','vistaAdministracionSistema'],['btnAcercaSistema','vistaAcercaSistema'],['btnCentroAlertas','vistaCentroAlertas'],['btnAccesoBusquedaOrdenes','vistaBuscador']];
async function measure(page,url,holdMs){
  await instrument(page);const started=Date.now();await page.goto(url,{waitUntil:'domcontentloaded',timeout:8000});await expect(page.locator('#moduleNav')).toBeAttached({timeout:8000});
  await page.evaluate(()=>document.body.classList.remove('auth-locked'));
  const readyMs=Date.now()-started;expect(readyMs).toBeLessThan(8000);
  for(const [button,view] of modules){const b=page.locator('#'+button);await expect(b).toBeAttached();await b.click({force:true});await expect(page.locator('#'+view)).toHaveClass(/\bactive\b/);}
  const deadline=Date.now()+holdMs;while(Date.now()<deadline){await page.locator('#btnDashboard').click({force:true});await expect(page.locator('#vistaDashboard')).toHaveClass(/\bactive\b/);await page.waitForTimeout(Math.min(5000,deadline-Date.now()));}
  return page.evaluate(ready=>({readyMs:ready,metrics:window.__e2e,memory:performance.memory?performance.memory.usedJSHeapSize:null,activeView:document.querySelector('.view.active')?.id||null}),readyMs);
}
test('A/B estable y rollback permanecen interactivos',async({browser})=>{
  test.setTimeout(750000);const aPage=await browser.newPage(),bPage=await browser.newPage();
  const stable=await measure(aPage,'http://127.0.0.1:4173'+PREFIX+'stable.html',30000);
  const rollback=await measure(bPage,'http://127.0.0.1:4173'+PREFIX+'index.html',Number(process.env.R3831_HOLD_MS||600000));
  expect(Math.max(0,...rollback.metrics.longTasks)).toBeLessThan(2000);expect(rollback.metrics.errors).toEqual([]);expect(rollback.metrics.rejections).toEqual([]);expect(rollback.readyMs).toBeLessThan(stable.readyMs*1.5+500);
  fs.writeFileSync(path.join(ROOT,'playwright-r3831-results.json'),JSON.stringify({stable,rollback},null,2));await aPage.close();await bPage.close();
});
