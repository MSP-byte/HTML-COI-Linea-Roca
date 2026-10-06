const { test, expect } = require('@playwright/test');

test.describe('H12 · avance manual de Obra', () => {
  test('expone parseo y formato de porcentaje 0-100 con coma decimal', async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForFunction(() => window.COI_OBRA_PROGRESS_MANUAL?.version === 'H12');
    const values = await page.evaluate(() => ({
      comma: window.COI_OBRA_PROGRESS_MANUAL.parsePercent('72,5'),
      hundred: window.COI_OBRA_PROGRESS_MANUAL.parsePercent('100'),
      empty: window.COI_OBRA_PROGRESS_MANUAL.parsePercent(''),
      invalid: Number.isNaN(window.COI_OBRA_PROGRESS_MANUAL.parsePercent('101')),
      formatted: window.COI_OBRA_PROGRESS_MANUAL.formatPercent(72.5)
    }));
    expect(values).toEqual({ comma: 72.5, hundred: 100, empty: null, invalid: true, formatted: '72,5%' });
  });

  test('el HTML separa Acta de Medición y porcentaje manual', async ({ page }) => {
    await page.goto('/index.html');
    const source = await page.locator('html').evaluate(() => document.documentElement.innerHTML);
    expect(source).toContain('data-coi-obra-latest-acta');
    expect(source).toContain('data-coi-obra-progress-manual');
    expect(source).toContain('coi_actualizar_avance_obra');
  });

  test('monta % manual aunque la ficha ya no tenga la tarjeta legacy Avance de obra', async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForFunction(() => window.COI_OBRA_PROGRESS_MANUAL?.version === 'H12');

    const result = await page.evaluate(async () => {
      const uuid='0dc6636e-0e46-4570-ac7a-431416cab744';
      const row={id:uuid,nro_oc:'4530009622',tipo:'Obra',avance_obra_pct:35};

      const query = {
        select(){ return this; },
        eq(){ return this; },
        order(){ return this; },
        limit(){ return Promise.resolve({data:[row],error:null}); }
      };
      const fakeClient={
        from(){ return Object.create(query); },
        rpc:async()=>({data:{},error:null})
      };

      window.getSupabaseClient=()=>fakeClient;
      window.APP_STATE=Object.assign({},window.APP_STATE||{},{role:'administrador'});
      Object.defineProperty(window,'COI_EXPEDIENTE_HYDRATION',{
        configurable:true,
        value:{resolveItem:()=>({supabaseId:uuid,numeroOC:'4530009622',tipo:'Obra'})}
      });

      let body=document.getElementById('fichaOCBody');
      if(!body){
        body=document.createElement('div');
        body.id='fichaOCBody';
        document.body.appendChild(body);
      }
      body.innerHTML='<div class="oc-kpis"><div class="oc-kpi"><b>OBRA</b><span>TIPO</span></div><div class="oc-kpi"><b>—</b><span>ÚLTIMA CERTIFICACIÓN</span></div></div>';

      await window.COI_OBRA_PROGRESS_MANUAL.enhance('4530009622');
      const card=body.querySelector('[data-coi-obra-progress-manual]');
      return {
        mounted:Boolean(card),
        value:card?.querySelector('[data-coi-manual-progress-value]')?.textContent||'',
        hasEdit:Boolean(card?.querySelector('[data-coi-manual-progress-edit]'))
      };
    });

    expect(result).toEqual({mounted:true,value:'35%',hasEdit:true});
  });
});
