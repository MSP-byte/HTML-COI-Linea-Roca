'use strict';
const fs=require('fs');
const p='index.html';
let s=fs.readFileSync(p,'utf8');
const old=`  if(window.MutationObserver){
    new MutationObserver(()=>{schedulePanel(currentRef());updateActionBar();}).observe(document.body,{childList:true,subtree:true});
  }`;
const neu=`  if(window.MutationObserver){
    const ordersBody=document.getElementById('ordenesTbody');
    if(ordersBody)new MutationObserver(()=>setTimeout(updateActionBar,0)).observe(ordersBody,{childList:true,subtree:true});
  }`;
if(!s.includes(old))throw new Error('observer anchor not found');
s=s.replace(old,neu);
fs.writeFileSync(p,s);
console.log('observer scoped');
