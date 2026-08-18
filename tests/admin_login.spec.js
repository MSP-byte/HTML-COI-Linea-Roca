const { test, expect } = require('@playwright/test');

async function openIsolated(page) {
  await page.route(/^https?:\/(?!\/127\.0\.0\.1)/, route => route.abort());
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('body')).toBeVisible();
  await page.waitForFunction(() => Boolean(
    document.getElementById('btnAdminMode') &&
    document.getElementById('btnSupabaseLogin') &&
    document.getElementById('supabaseAuthModal')
  ));
}

async function openAdministration(page) {
  await page.evaluate(() => {
    const direct = document.getElementById('btnAdministracionSistema');
    if (direct) direct.click();
    else if (typeof window.mostrarVista === 'function') window.mostrarVista('vistaAdministracionSistema');
  });
  await expect(page.locator('#vistaAdministracionSistema')).toHaveClass(/\bactive\b/);
  await expect(page.locator('#btnAdminMode')).toBeVisible();
}

test('Iniciar sesión como administrador abre el login real de Supabase', async ({ page }) => {
  await openIsolated(page);
  await openAdministration(page);

  const adminButton = page.locator('#btnAdminMode');
  await expect(adminButton).toHaveText(/Iniciar sesión como administrador/i);
  await expect(page.locator('#supabaseAuthModal')).toBeHidden();

  await adminButton.click();

  await expect(page.locator('#supabaseAuthModal')).toBeVisible();
  await expect(page.locator('#supabaseAuthTitle')).toHaveText('Acceso de Administrador');
  await expect(page.locator('#supabaseAuthModal .supabase-auth-head p')).toContainText('rol Administrador');
  await expect(page.locator('#supabaseEmail')).toBeFocused();
  await expect(page.locator('#supabasePassword')).toBeVisible();
});

test('una sesión administrativa usa el mismo control para cerrar Supabase', async ({ page }) => {
  await openIsolated(page);
  await openAdministration(page);

  const dispatched = await page.evaluate(() => {
    if (!window.APP_STATE) return { ok: false, reason: 'APP_STATE no disponible' };
    window.APP_STATE.sessionChecked = true;
    window.APP_STATE.user = { id: 'qa-admin', email: 'admin.qa@coiroca.test' };
    window.APP_STATE.role = 'administrador';
    window.esUsuarioSupabaseAdministradorR12 = () => true;
    if (typeof window.actualizarUIModoAcceso !== 'function') {
      return { ok: false, reason: 'actualizarUIModoAcceso no disponible' };
    }
    window.actualizarUIModoAcceso();
    const logout = document.getElementById('btnSupabaseLogout');
    const admin = document.getElementById('btnAdminMode');
    if (!logout || !admin) return { ok: false, reason: 'controles auth ausentes' };
    window.__COI_TEST_ADMIN_LOGOUT_DISPATCH__ = 0;
    logout.addEventListener('click', event => {
      window.__COI_TEST_ADMIN_LOGOUT_DISPATCH__ += 1;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);
    const textBefore = admin.textContent.trim();
    admin.click();
    return {
      ok: true,
      textBefore,
      dispatches: window.__COI_TEST_ADMIN_LOGOUT_DISPATCH__
    };
  });

  expect(dispatched.ok, dispatched.reason || '').toBe(true);
  expect(dispatched.textBefore).toMatch(/Cerrar sesión de administrador/i);
  expect(dispatched.dispatches).toBe(1);
});
