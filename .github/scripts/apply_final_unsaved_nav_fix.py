from pathlib import Path

p = Path('index.html')
s = p.read_text(encoding='utf-8')
marker = 'id="coi-final-navigation-top-scrollbars"'
base = s.index(marker)
start = s.index('  function goBackToOrders(event) {', base)
end_marker = "  document.addEventListener('click', goBackToOrders, true);"
end = s.index(end_marker, start)

replacement = r'''  function clearEditingStateForOrdersNavigation() {
    if (!window.APP_STATE || !window.APP_STATE.editingOC) return;
    window.APP_STATE.editingOC = false;
    window.APP_STATE.editingOCKey = null;
    window.APP_STATE.editingOCSnapshot = null;
    document.getElementById('coiEditIntegralOC')?.remove();
  }

  function goBackToOrders(event) {
    const target = event.target instanceof Element ? event.target.closest(BACK_SELECTOR) : null;
    if (!target || !target.closest('#vistaFichaOC')) return;

    if (window.APP_STATE && window.APP_STATE.editingOC) {
      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();

      const shouldLeave = typeof window.confirm !== 'function'
        || window.confirm('Hay cambios de edición sin guardar. ¿Salir igual?');
      if (!shouldLeave) return;

      clearEditingStateForOrdersNavigation();
      navigateToOrders();
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
    navigateToOrders();
  }

'''

s = s[:start] + replacement + s[end:]
p.write_text(s, encoding='utf-8', newline='')
