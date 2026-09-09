const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf8');

const forbidden = [
  "button('coiToggleMotion'",
  "button('coiFocusMode'",
  "textContent=enabled?'Movimiento activo'",
  "textContent=active?'Salir de modo foco'",
  "localStorage.getItem(MOTION_KEY)",
];
for (const token of forbidden) {
  if (html.includes(token)) throw new Error(`Dashboard visual control should be absent: ${token}`);
}

const required = [
  "function motionEnabled(){return true;}",
  "document.body.classList.remove('coi-motion-off')",
  "function syncDashboardFocus()",
  "new MutationObserver(syncDashboardFocus)",
  "syncDashboardFocus();applyMotion(true);return true;",
];
for (const token of required) {
  if (!html.includes(token)) throw new Error(`Dashboard fixed-state guard missing: ${token}`);
}

console.log('Dashboard focus/motion defaults: OK');
