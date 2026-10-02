const { test, expect } = require('@playwright/test');

test.describe('Seguridad de cuenta · regresión de interacción', () => {
  test.beforeEach(async ({ page }) => {
    await page.route(url => url.hostname !== '127.0.0.1', route => route.abort());
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  });

  async function prepareAuthenticatedShell(page) {
    await page.addStyleTag({
      content: [
        '#coiAuthGateH14{display:none!important}',
        '#coiV60ReadOnlyBanner{display:none!important}',
        '#footerOperativo{display:none!important}'
      ].join('')
    });
    await page.evaluate(() => {
      document.body.classList.remove('coi-h14-locked');
      let host = document.getElementById('supabaseStatusCluster');
      if (!host) {
        host = document.createElement('div');
        host.id = 'supabaseStatusCluster';
        host.className = 'supabase-status-cluster';
        (document.querySelector('.header-actions') || document.body).appendChild(host);
      }
      let logout = document.getElementById('btnSupabaseLogout');
      if (!logout) {
        logout = document.createElement('button');
        logout.id = 'btnSupabaseLogout';
        logout.type = 'button';
        logout.textContent = 'Logout';
        host.appendChild(logout);
      }
      window.dispatchEvent(new CustomEvent('coi:supabase-auth', {
        detail: { event: 'SIGNED_IN', session: { user: { id: 'u-test', email: 'usuario@test.local' } } }
      }));
    });
    await expect(page.locator('#coiPwdBtn')).toBeVisible();
  }

  test('la acción queda disponible para cualquier usuario autenticado fuera de Administración', async ({ page }) => {
    await prepareAuthenticatedShell(page);
    const button = page.locator('#coiPwdBtn');
    await expect(button).toHaveCSS('position', 'static');
    await expect(page.locator('#supabaseStatusCluster #coiPwdBtn')).toHaveCount(1);
    await expect(page.locator('#vistaAdministracionSistema #coiPwdBtn')).toHaveCount(0);
  });

  test('no intercepta con pointer real el área operativa inferior derecha cuando el modal está cerrado', async ({ page }) => {
    await prepareAuthenticatedShell(page);
    await page.evaluate(() => {
      const probe = document.createElement('button');
      probe.id = 'coiPwdHitProbe';
      probe.type = 'button';
      probe.textContent = 'probe';
      Object.assign(probe.style, {
        position: 'fixed',
        right: '22px',
        bottom: '22px',
        width: '190px',
        height: '48px',
        zIndex: '1'
      });
      probe.addEventListener('click', () => probe.dataset.clicked = 'yes');
      document.body.appendChild(probe);
    });
    const probe = page.locator('#coiPwdHitProbe');
    await probe.click();
    await expect(probe).toHaveAttribute('data-clicked', 'yes');
  });

  test('abre y cierra el modal con clicks reales y foco correcto', async ({ page }) => {
    await prepareAuthenticatedShell(page);
    const modal = page.locator('#coiPwdModal');
    await expect(modal).toHaveCSS('display', 'none');
    await page.locator('#coiPwdBtn').click();
    await expect(modal).toHaveCSS('display', 'flex');
    await expect(page.locator('#coiPwdNew')).toBeFocused();
    await page.locator('#coiPwdCancel').click();
    await expect(modal).toHaveCSS('display', 'none');
  });

  test('reauthenticate envía código y updateUser usa nonce sin reemplazar la sesión', async ({ page }) => {
    await prepareAuthenticatedShell(page);
    await page.evaluate(() => {
      window.__coiReauthCalls = 0;
      window.__coiPwdUpdateArgs = null;
      window.__coiCanonicalSignInCalled = false;
      window.__COI_SUPABASE_CLIENT__ = {
        auth: {
          getSession: async () => ({ data: { session: { user: { id: 'u-test', email: 'usuario@test.local' } } }, error: null }),
          signInWithPassword: async () => {
            window.__coiCanonicalSignInCalled = true;
            throw new Error('No debe reemplazar la sesión canónica');
          },
          reauthenticate: async () => {
            window.__coiReauthCalls += 1;
            return { error: null };
          },
          updateUser: async args => {
            window.__coiPwdUpdateArgs = args;
            return { data: { user: { id: 'u-test' } }, error: null };
          }
        }
      };
    });

    await page.locator('#coiPwdBtn').click();
    await page.locator('#coiPwdNew').fill('Nueva-4567');
    await page.locator('#coiPwdConfirm').fill('Nueva-4567');
    await page.locator('#coiPwdSave').click();

    await expect(page.locator('#coiPwdNonceWrap')).toBeVisible();
    expect(await page.evaluate(() => window.__coiReauthCalls)).toBe(1);
    expect(await page.evaluate(() => window.__coiCanonicalSignInCalled)).toBe(false);

    await page.locator('#coiPwdNonce').fill('123456');
    await page.locator('#coiPwdSave').click();

    await expect.poll(() => page.evaluate(() => window.__coiPwdUpdateArgs)).toEqual({
      password: 'Nueva-4567',
      nonce: '123456'
    });
    await expect(page.locator('#coiPwdMsg')).toContainText('Contraseña actualizada correctamente');
  });

  test('una actualización pendiente no puede cerrarse desde cancelar ni desde el backdrop', async ({ page }) => {
    await prepareAuthenticatedShell(page);
    await page.evaluate(() => {
      window.__COI_SUPABASE_CLIENT__ = {
        auth: {
          getSession: async () => ({ data: { session: { user: { id: 'u-test', email: 'usuario@test.local' } } }, error: null }),
          reauthenticate: async () => ({ error: null }),
          updateUser: () => new Promise(resolve => {
            window.__coiResolvePasswordUpdate = () => resolve({ data: {}, error: null });
          })
        }
      };
    });

    await page.locator('#coiPwdBtn').click();
    await page.locator('#coiPwdNew').fill('Nueva-4567');
    await page.locator('#coiPwdConfirm').fill('Nueva-4567');
    await page.locator('#coiPwdSave').click();
    await page.locator('#coiPwdNonce').fill('123456');
    await page.locator('#coiPwdSave').click();

    await expect(page.locator('#coiPwdCancel')).toBeDisabled();
    await page.locator('#coiPwdModal').click({ position: { x: 4, y: 4 } });
    await expect(page.locator('#coiPwdModal')).toHaveCSS('display', 'flex');

    await page.evaluate(() => window.__coiResolvePasswordUpdate());
    await expect(page.locator('#coiPwdMsg')).toContainText('Contraseña actualizada correctamente');
  });
});
