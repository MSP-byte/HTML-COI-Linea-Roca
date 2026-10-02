const { test, expect } = require('@playwright/test');

test.describe('Seguridad de cuenta · regresión de interacción', () => {
  test.beforeEach(async ({ page }) => {
    await page.route(url => url.hostname !== '127.0.0.1', route => route.abort());
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  });

  async function prepareAuthenticatedV2(page) {
    await page.addStyleTag({
      content: [
        '#coiAuthGateH14{display:none!important}',
        '#coiV60ReadOnlyBanner{display:none!important}',
        '#footerOperativo{display:none!important}'
      ].join('')
    });
    await page.evaluate(() => {
      document.body.classList.remove('coi-h14-locked');
      document.body.classList.add('coi-v2-ready');

      if (!document.getElementById('coiV2Sidebar')) {
        const sidebar = document.createElement('aside');
        sidebar.id = 'coiV2Sidebar';
        sidebar.className = 'coi-v2-sidebar';
        sidebar.innerHTML = '<div class="coi-v2-sidebar-footer"></div>';
        document.body.prepend(sidebar);
      }
      if (!document.getElementById('coiV2Topbar')) {
        const topbar = document.createElement('header');
        topbar.id = 'coiV2Topbar';
        topbar.className = 'coi-v2-topbar';
        topbar.innerHTML = '<div></div><div></div><div class="coi-v2-top-actions"></div>';
        document.body.prepend(topbar);
      }

      window.COI_PASSWORD_SECURITY?.syncAuth?.({ user: { id: 'u-test', email: 'usuario@test.local' } });
      window.COI_PASSWORD_SECURITY?.mount?.();
    });
    await expect(page.locator('#coiPwdBtn')).toBeVisible();
  }

  test('la acción queda visible para cualquier autenticado en la superficie V2 visible', async ({ page }) => {
    await prepareAuthenticatedV2(page);
    const button = page.locator('#coiPwdBtn');
    await expect(button).toHaveCSS('position', 'static');
    const width = page.viewportSize().width;
    if (width <= 760) {
      await expect(page.locator('#coiV2Topbar .coi-v2-top-actions #coiPwdBtn')).toHaveCount(1);
    } else {
      await expect(page.locator('#coiV2Sidebar .coi-v2-sidebar-footer #coiPwdBtn')).toHaveCount(1);
    }
    await button.click();
    await expect(page.locator('#coiPwdModal')).toHaveCSS('display', 'flex');
  });

  test('en Inicio/foco el botón del sidebar queda en modo icono y clickeable', async ({ page }) => {
    await prepareAuthenticatedV2(page);
    if (page.viewportSize().width <= 760) {
      await expect(page.locator('#coiV2Topbar .coi-v2-top-actions #coiPwdBtn')).toBeVisible();
      return;
    }
    await page.evaluate(() => document.body.classList.add('dashboard-focus-mode'));
    await expect(page.locator('#coiV2Sidebar #coiPwdBtn')).toBeVisible();
    const box = await page.locator('#coiV2Sidebar #coiPwdBtn').boundingBox();
    expect(box.width).toBeLessThanOrEqual(50);
    await page.locator('#coiV2Sidebar #coiPwdBtn').click();
    await expect(page.locator('#coiPwdModal')).toHaveCSS('display', 'flex');
  });

  test('no intercepta con pointer real el área operativa inferior derecha cuando el modal está cerrado', async ({ page }) => {
    await prepareAuthenticatedV2(page);
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

  test('abre y cierra el modal con clicks reales y foco en contraseña actual', async ({ page }) => {
    await prepareAuthenticatedV2(page);
    const modal = page.locator('#coiPwdModal');
    await expect(modal).toHaveCSS('display', 'none');
    await page.locator('#coiPwdBtn').click();
    await expect(modal).toHaveCSS('display', 'flex');
    await expect(page.locator('#coiPwdCurrent')).toBeFocused();
    await expect(page.locator('#coiPwdNonce')).toHaveCount(0);
    await page.locator('#coiPwdCancel').click();
    await expect(modal).toHaveCSS('display', 'none');
  });

  test('updateUser usa currentPassword y no reauthenticate ni signInWithPassword', async ({ page }) => {
    await prepareAuthenticatedV2(page);
    await page.evaluate(() => {
      window.__coiPwdUpdateArgs = null;
      window.__coiReauthCalls = 0;
      window.__coiSignInCalls = 0;
      window.__COI_SUPABASE_CLIENT__ = {
        auth: {
          getSession: async () => ({ data: { session: { user: { id: 'u-test', email: 'usuario@test.local' } } }, error: null }),
          signInWithPassword: async () => {
            window.__coiSignInCalls += 1;
            throw new Error('No debe reemplazar la sesión canónica');
          },
          reauthenticate: async () => {
            window.__coiReauthCalls += 1;
            throw new Error('No debe enviar códigos por email');
          },
          updateUser: async args => {
            window.__coiPwdUpdateArgs = args;
            return { data: { user: { id: 'u-test' } }, error: null };
          }
        }
      };
    });

    await page.locator('#coiPwdBtn').click();
    await page.locator('#coiPwdCurrent').fill('Actual-1234');
    await page.locator('#coiPwdNew').fill('Nueva-4567');
    await page.locator('#coiPwdConfirm').fill('Nueva-4567');
    await page.locator('#coiPwdSave').click();

    await expect.poll(() => page.evaluate(() => window.__coiPwdUpdateArgs)).toEqual({
      password: 'Nueva-4567',
      currentPassword: 'Actual-1234'
    });
    expect(await page.evaluate(() => window.__coiReauthCalls)).toBe(0);
    expect(await page.evaluate(() => window.__coiSignInCalls)).toBe(0);
    await expect(page.locator('#coiPwdMsg')).toContainText('Contraseña actualizada correctamente');
  });

  test('una contraseña actual incorrecta se informa sin iniciar flujo de email', async ({ page }) => {
    await prepareAuthenticatedV2(page);
    await page.evaluate(() => {
      window.__coiReauthCalls = 0;
      window.__COI_SUPABASE_CLIENT__ = {
        auth: {
          getSession: async () => ({ data: { session: { user: { id: 'u-test', email: 'usuario@test.local' } } }, error: null }),
          reauthenticate: async () => { window.__coiReauthCalls += 1; return { error: null }; },
          updateUser: async () => ({ data: null, error: { message: 'Current password is incorrect', code: 'invalid_credentials' } })
        }
      };
    });

    await page.locator('#coiPwdBtn').click();
    await page.locator('#coiPwdCurrent').fill('Incorrecta-1');
    await page.locator('#coiPwdNew').fill('Nueva-4567');
    await page.locator('#coiPwdConfirm').fill('Nueva-4567');
    await page.locator('#coiPwdSave').click();

    await expect(page.locator('#coiPwdMsg')).toContainText('La contraseña actual no es correcta');
    expect(await page.evaluate(() => window.__coiReauthCalls)).toBe(0);
  });

  test('un timer de éxito anterior no puede cerrar ni limpiar un modal reabierto', async ({ page }) => {
    await prepareAuthenticatedV2(page);
    await page.evaluate(() => {
      window.__COI_SUPABASE_CLIENT__ = {
        auth: {
          getSession: async () => ({ data: { session: { user: { id: 'u-test', email: 'usuario@test.local' } } }, error: null }),
          updateUser: async () => ({ data: { user: { id: 'u-test' } }, error: null })
        }
      };
    });

    await page.locator('#coiPwdBtn').click();
    await page.locator('#coiPwdCurrent').fill('Actual-1234');
    await page.locator('#coiPwdNew').fill('Nueva-4567');
    await page.locator('#coiPwdConfirm').fill('Nueva-4567');
    await page.locator('#coiPwdSave').click();
    await expect(page.locator('#coiPwdMsg')).toContainText('Contraseña actualizada correctamente');

    await page.locator('#coiPwdCancel').click();
    await page.locator('#coiPwdBtn').click();
    await page.locator('#coiPwdCurrent').fill('Nueva-4567');
    await page.locator('#coiPwdNew').fill('Otra-8901');
    await page.locator('#coiPwdConfirm').fill('Otra-8901');

    await page.waitForTimeout(2100);
    await expect(page.locator('#coiPwdModal')).toHaveCSS('display', 'flex');
    await expect(page.locator('#coiPwdCurrent')).toHaveValue('Nueva-4567');
    await expect(page.locator('#coiPwdNew')).toHaveValue('Otra-8901');
    await expect(page.locator('#coiPwdConfirm')).toHaveValue('Otra-8901');
  });

  test('un cambio de UID cierra el modal y descarta todas las contraseñas del usuario anterior', async ({ page }) => {
    await prepareAuthenticatedV2(page);
    await page.locator('#coiPwdBtn').click();
    await page.locator('#coiPwdCurrent').fill('Actual-1234');
    await page.locator('#coiPwdNew').fill('Temporal-123');
    await page.locator('#coiPwdConfirm').fill('Temporal-123');
    await page.evaluate(() => {
      window.COI_PASSWORD_SECURITY.syncAuth({ user: { id: 'u-otro', email: 'otro@test.local' } });
    });

    await expect(page.locator('#coiPwdModal')).toHaveCSS('display', 'none');
    await expect(page.locator('#coiPwdCurrent')).toHaveValue('');
    await expect(page.locator('#coiPwdNew')).toHaveValue('');
    await expect(page.locator('#coiPwdConfirm')).toHaveValue('');
  });

  test('un cambio de UID invalida un updateUser todavía pendiente', async ({ page }) => {
    await prepareAuthenticatedV2(page);
    await page.evaluate(() => {
      window.__coiPwdResolve = null;
      window.__COI_SUPABASE_CLIENT__ = {
        auth: {
          getSession: async () => ({ data: { session: { user: { id: 'u-test', email: 'usuario@test.local' } } }, error: null }),
          updateUser: () => new Promise(resolve => { window.__coiPwdResolve = resolve; })
        }
      };
    });

    await page.locator('#coiPwdBtn').click();
    await page.locator('#coiPwdCurrent').fill('Actual-1234');
    await page.locator('#coiPwdNew').fill('Nueva-4567');
    await page.locator('#coiPwdConfirm').fill('Nueva-4567');
    await page.locator('#coiPwdSave').click();

    await expect.poll(() => page.evaluate(() => typeof window.__coiPwdResolve)).toBe('function');
    await page.evaluate(() => {
      window.COI_PASSWORD_SECURITY.syncAuth({ user: { id: 'u-otro', email: 'otro@test.local' } });
      window.__coiPwdResolve({ data: {}, error: null });
    });

    await expect(page.locator('#coiPwdModal')).toHaveCSS('display', 'none');
    await expect(page.locator('#coiPwdCurrent')).toHaveValue('');
    await expect(page.locator('#coiPwdNew')).toHaveValue('');
  });

  test('el flag de protección permanece activo durante updateUser', async ({ page }) => {
    await prepareAuthenticatedV2(page);
    await page.evaluate(() => {
      window.__coiPwdResolve = null;
      window.__COI_SUPABASE_CLIENT__ = {
        auth: {
          getSession: async () => ({ data: { session: { user: { id: 'u-test', email: 'usuario@test.local' } } }, error: null }),
          updateUser: () => new Promise(resolve => { window.__coiPwdResolve = resolve; })
        }
      };
    });

    await page.locator('#coiPwdBtn').click();
    await page.locator('#coiPwdCurrent').fill('Actual-1234');
    await page.locator('#coiPwdNew').fill('Nueva-4567');
    await page.locator('#coiPwdConfirm').fill('Nueva-4567');
    await page.locator('#coiPwdSave').click();

    await expect(page.locator('#coiPwdCancel')).toBeDisabled();
    await page.waitForTimeout(2400);
    expect(await page.evaluate(() => window.__COI_PASSWORD_UPDATE_IN_FLIGHT__)).toBe(true);
    await page.locator('#coiPwdModal').click({ position: { x: 4, y: 4 } });
    await expect(page.locator('#coiPwdModal')).toHaveCSS('display', 'flex');

    await page.evaluate(() => window.__coiPwdResolve({ data: {}, error: null }));
    await expect(page.locator('#coiPwdMsg')).toContainText('Contraseña actualizada correctamente');
    await expect.poll(() => page.evaluate(() => window.__COI_PASSWORD_UPDATE_IN_FLIGHT__)).toBe(false);
  });
});
