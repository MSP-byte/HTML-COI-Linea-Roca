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

  test('abre y cierra el modal con clicks reales y foco correcto', async ({ page }) => {
    await prepareAuthenticatedV2(page);
    const modal = page.locator('#coiPwdModal');
    await expect(modal).toHaveCSS('display', 'none');
    await page.locator('#coiPwdBtn').click();
    await expect(modal).toHaveCSS('display', 'flex');
    await expect(page.locator('#coiPwdNew')).toBeFocused();
    await page.locator('#coiPwdCancel').click();
    await expect(modal).toHaveCSS('display', 'none');
  });

  test('reauthenticate envía código y updateUser usa nonce sin reemplazar la sesión', async ({ page }) => {
    await prepareAuthenticatedV2(page);
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


  test('un timer de éxito anterior no puede cerrar ni limpiar un modal reabierto', async ({ page }) => {
    await prepareAuthenticatedV2(page);
    await page.evaluate(() => {
      window.__COI_SUPABASE_CLIENT__ = {
        auth: {
          getSession: async () => ({ data: { session: { user: { id: 'u-test', email: 'usuario@test.local' } } }, error: null }),
          reauthenticate: async () => ({ error: null }),
          updateUser: async () => ({ data: { user: { id: 'u-test' } }, error: null })
        }
      };
    });

    await page.locator('#coiPwdBtn').click();
    await page.locator('#coiPwdNew').fill('Nueva-4567');
    await page.locator('#coiPwdConfirm').fill('Nueva-4567');
    await page.locator('#coiPwdSave').click();
    await page.locator('#coiPwdNonce').fill('123456');
    await page.locator('#coiPwdSave').click();
    await expect(page.locator('#coiPwdMsg')).toContainText('Contraseña actualizada correctamente');

    await page.locator('#coiPwdCancel').click();
    await page.locator('#coiPwdBtn').click();
    await page.locator('#coiPwdNew').fill('Otra-8901');
    await page.locator('#coiPwdConfirm').fill('Otra-8901');

    await page.waitForTimeout(2100);
    await expect(page.locator('#coiPwdModal')).toHaveCSS('display', 'flex');
    await expect(page.locator('#coiPwdNew')).toHaveValue('Otra-8901');
    await expect(page.locator('#coiPwdConfirm')).toHaveValue('Otra-8901');
  });

  test('un cambio de UID cierra el modal y descarta contraseña y nonce del usuario anterior', async ({ page }) => {
    await prepareAuthenticatedV2(page);
    await page.locator('#coiPwdBtn').click();
    await page.locator('#coiPwdNew').fill('Temporal-123');
    await page.locator('#coiPwdConfirm').fill('Temporal-123');
    await page.evaluate(() => {
      window.COI_PASSWORD_SECURITY.syncAuth({ user: { id: 'u-otro', email: 'otro@test.local' } });
    });

    await expect(page.locator('#coiPwdModal')).toHaveCSS('display', 'none');
    await expect(page.locator('#coiPwdNew')).toHaveValue('');
    await expect(page.locator('#coiPwdConfirm')).toHaveValue('');
    await expect(page.locator('#coiPwdNonceWrap')).toBeHidden();
  });

  test('un cambio de UID invalida una reautenticación todavía pendiente', async ({ page }) => {
    await prepareAuthenticatedV2(page);
    await page.evaluate(() => {
      window.__coiResolveReauth = null;
      window.__coiReauthCalls = 0;
      window.__COI_SUPABASE_CLIENT__ = {
        auth: {
          getSession: async () => ({ data: { session: { user: { id: 'u-test', email: 'usuario@test.local' } } }, error: null }),
          reauthenticate: () => {
            window.__coiReauthCalls += 1;
            return new Promise(resolve => { window.__coiResolveReauth = resolve; });
          },
          updateUser: async () => ({ data: {}, error: null })
        }
      };
    });

    await page.locator('#coiPwdBtn').click();
    await page.locator('#coiPwdNew').fill('Nueva-4567');
    await page.locator('#coiPwdConfirm').fill('Nueva-4567');
    await page.locator('#coiPwdSave').click();

    await expect.poll(() => page.evaluate(() => typeof window.__coiResolveReauth)).toBe('function');
    await page.evaluate(() => {
      window.COI_PASSWORD_SECURITY.syncAuth({ user: { id: 'u-otro', email: 'otro@test.local' } });
      window.__coiResolveReauth({ error: null });
    });

    await expect(page.locator('#coiPwdModal')).toHaveCSS('display', 'none');
    await expect(page.locator('#coiPwdNonceWrap')).toBeHidden();

    await page.evaluate(() => {
      window.__COI_SUPABASE_CLIENT__.auth.getSession = async () => ({
        data: { session: { user: { id: 'u-otro', email: 'otro@test.local' } } },
        error: null
      });
      window.__COI_SUPABASE_CLIENT__.auth.reauthenticate = async () => {
        window.__coiReauthCalls += 1;
        return { error: null };
      };
    });

    await page.locator('#coiPwdBtn').click();
    await page.locator('#coiPwdNew').fill('Otra-4567');
    await page.locator('#coiPwdConfirm').fill('Otra-4567');
    await page.locator('#coiPwdSave').click();
    await expect.poll(() => page.evaluate(() => window.__coiReauthCalls)).toBe(2);
    await expect(page.locator('#coiPwdNonceWrap')).toBeVisible();
  });

  test('el flag de protección permanece activo durante updateUser aunque la reautenticación haya ocurrido recién', async ({ page }) => {
    await prepareAuthenticatedV2(page);
    await page.evaluate(() => {
      window.__coiPwdResolve = null;
      window.__COI_SUPABASE_CLIENT__ = {
        auth: {
          getSession: async () => ({ data: { session: { user: { id: 'u-test', email: 'usuario@test.local' } } }, error: null }),
          reauthenticate: async () => ({ error: null }),
          updateUser: () => new Promise(resolve => { window.__coiPwdResolve = resolve; })
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
    await page.waitForTimeout(2400);
    expect(await page.evaluate(() => window.__COI_PASSWORD_UPDATE_IN_FLIGHT__)).toBe(true);
    await page.locator('#coiPwdModal').click({ position: { x: 4, y: 4 } });
    await expect(page.locator('#coiPwdModal')).toHaveCSS('display', 'flex');

    await page.evaluate(() => window.__coiPwdResolve({ data: {}, error: null }));
    await expect(page.locator('#coiPwdMsg')).toContainText('Contraseña actualizada correctamente');
    await expect.poll(() => page.evaluate(() => window.__COI_PASSWORD_UPDATE_IN_FLIGHT__)).toBe(false);
  });
});
