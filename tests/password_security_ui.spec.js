const { test, expect } = require('@playwright/test');

test.describe('Seguridad de cuenta · regresión de interacción', () => {
  test.beforeEach(async ({ page }) => {
    await page.route(url => url.hostname !== '127.0.0.1', route => route.abort());
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  });

  async function prepareAdminSecurity(page) {
    await page.addStyleTag({
      content: [
        '#coiAuthGateH14{display:none!important}',
        '#coiV60ReadOnlyBanner{display:none!important}',
        '#footerOperativo{display:none!important}'
      ].join('')
    });
    await page.evaluate(() => {
      document.body.classList.remove('coi-h14-locked');
      const view = document.getElementById('vistaAdministracionSistema');
      if (view) {
        view.style.display = 'block';
        view.classList.add('active');
      }
      const tab = document.getElementById('adminTabUsuarios');
      if (tab) {
        tab.style.display = 'block';
        tab.classList.add('active');
      }
      if (typeof window.renderAdminUsuarios === 'function') window.renderAdminUsuarios();
    });
    await expect(page.locator('#coiPwdBtn')).toBeVisible();
  }

  test('la acción de contraseña queda en flujo normal y dentro de Seguridad y usuarios', async ({ page }) => {
    await prepareAdminSecurity(page);
    const button = page.locator('#coiPwdBtn');
    await expect(button).toHaveCSS('position', 'static');
    await expect(button).toBeVisible();
    await expect(page.locator('#adminTabUsuarios .coi-password-actions #coiPwdBtn')).toHaveCount(1);
  });

  test('no intercepta con pointer real el área operativa inferior derecha cuando el modal está cerrado', async ({ page }) => {
    await page.addStyleTag({
      content: '#coiAuthGateH14,#coiV60ReadOnlyBanner,#footerOperativo{display:none!important}'
    });
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

  test('abre y cierra el modal con clicks reales', async ({ page }) => {
    await prepareAdminSecurity(page);
    const modal = page.locator('#coiPwdModal');
    await expect(modal).toHaveCSS('display', 'none');
    await page.locator('#coiPwdBtn').click();
    await expect(modal).toHaveCSS('display', 'flex');
    await expect(page.locator('#coiPwdCurrent')).toBeFocused();
    await page.locator('#coiPwdCancel').click();
    await expect(modal).toHaveCSS('display', 'none');
  });

  test('actualiza con updateUser currentPassword sin crear una nueva sesión', async ({ page }) => {
    await prepareAdminSecurity(page);
    await page.evaluate(() => {
      window.__coiPwdUpdateArgs = null;
      window.__COI_SUPABASE_CLIENT__ = {
        auth: {
          getSession: async () => ({ data: { session: { user: { id: 'u-test' } } }, error: null }),
          updateUser: async args => {
            window.__coiPwdUpdateArgs = args;
            return { data: { user: { id: 'u-test' } }, error: null };
          }
        }
      };
    });
    await page.locator('#coiPwdBtn').click();
    await page.locator('#coiPwdCurrent').fill('Actual-123');
    await page.locator('#coiPwdNew').fill('Nueva-4567');
    await page.locator('#coiPwdConfirm').fill('Nueva-4567');
    await page.locator('#coiPwdSave').click();
    await expect.poll(() => page.evaluate(() => window.__coiPwdUpdateArgs)).toEqual({
      password: 'Nueva-4567',
      currentPassword: 'Actual-123'
    });
    await expect(page.locator('#coiPwdMsg')).toContainText('Contraseña actualizada correctamente');
  });

  test('una actualización pendiente no puede cerrarse desde cancelar ni desde el backdrop', async ({ page }) => {
    await prepareAdminSecurity(page);
    await page.evaluate(() => {
      window.__COI_SUPABASE_CLIENT__ = {
        auth: {
          getSession: async () => ({ data: { session: { user: { id: 'u-test' } } }, error: null }),
          updateUser: () => new Promise(resolve => {
            window.__coiResolvePasswordUpdate = () => resolve({ data: {}, error: null });
          })
        }
      };
    });
    await page.locator('#coiPwdBtn').click();
    await page.locator('#coiPwdCurrent').fill('Actual-123');
    await page.locator('#coiPwdNew').fill('Nueva-4567');
    await page.locator('#coiPwdConfirm').fill('Nueva-4567');
    await page.locator('#coiPwdSave').click();
    await expect(page.locator('#coiPwdCancel')).toBeDisabled();
    await page.locator('#coiPwdModal').click({ position: { x: 4, y: 4 } });
    await expect(page.locator('#coiPwdModal')).toHaveCSS('display', 'flex');
    await page.evaluate(() => window.__coiResolvePasswordUpdate());
    await expect(page.locator('#coiPwdMsg')).toContainText('Contraseña actualizada correctamente');
  });
});
