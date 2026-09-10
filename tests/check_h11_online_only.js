const fs = require('fs');
const html = fs.readFileSync('index.html','utf8');
const assert = (cond,msg)=>{ if(!cond){ console.error('H11 FAIL:',msg); process.exit(1); } };
assert(!html.includes('localStorage'), 'index.html must contain zero localStorage references');
assert(html.includes('storage: window.sessionStorage'), 'Supabase Auth must use sessionStorage explicitly');
assert(html.includes('__COI_SUPABASE_SOURCE_OF_TRUTH__'), 'Supabase source-of-truth guard must remain present');
assert(html.includes("const TIMELINE_SYNC_CHANNEL='coi_timeline_sync_v2';"), 'Timeline cross-tab sync must use BroadcastChannel');
assert(html.includes('timelineSyncChannel.postMessage'), 'Timeline mutations must broadcast a reload signal');
assert(html.includes("timelineSyncChannel.addEventListener('message'"), 'other tabs must receive the BroadcastChannel signal');

assert(html.includes("url: \"https://ooepgbzqlpjrtpaoqawc.supabase.co\""), 'production Supabase project must remain configured');
console.log('H11 online-only static contract: PASS');
