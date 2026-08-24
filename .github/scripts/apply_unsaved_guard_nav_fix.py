from pathlib import Path

p = Path('index.html')
s = p.read_text(encoding='utf-8')
start = s.index('  function goBackToOrders(event) {', s.index('id="coi-final-navigation-top-scrollbars"'))
end_marker = "  document.addEventListener('click', goBackToOrders, true);"
end = s.index(end_marker, start)

replacement = r'''  function navigateToOrders() {
    try {
      if (typeof window.mostrarVista === 'function') {
        window.mostrarVista('vistaOrdenes');
      } else {
        fallbackShowOrders();
      }
    } catch (error) {
      console.error('[COI] No se pudo volver a Ordenes desde la Ficha OC', error);
      fallbackShowOrders();
    }

    if (window.APP_STATE && typeof window.APP_STATE === 'object') {
      window.APP_STATE.activeView = 'vistaOrdenes';
    }

    markOrdersNavigationActive();

    if (typeof window.renderOrdenes === 'function') {
      try {
        window.renderOrdenes();
      } catch (error) {
        console.error('[COI] No se pudo refrescar Ordenes al volver desde la Ficha OC', error);
      }
    }

    scheduleReconcile();
  }

  function goBackToOrders(event) {
    const target = event.target instanceof Element ? event.target.closest(BACK_SELECTOR) : null;
    if (!target || !target.closest('#vistaFichaOC')) return;

    // Si existe una edición integral activa, no interceptar el primer click:
    // dejamos que el guard histórico de cambios sin guardar muestre su confirmación.
    // Si ese guard autoriza la salida y limpia editingOC, completamos luego el regreso
    // canónico a Órdenes. Si el usuario cancela, editingOC sigue true y no navegamos.
    if (window.APP_STATE && window.APP_STATE.editingOC) {
      setTimeout(() => {
        if (!(window.APP_STATE && window.APP_STATE.editingOC)) {
          navigateToOrders();
        }
      }, 0);
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
