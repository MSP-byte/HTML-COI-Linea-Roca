#!/usr/bin/env python3
"""Suite Chromium/Selenium con datos locales; nunca contacta Supabase productivo."""
import json
import subprocess
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

ROOT = Path(__file__).resolve().parents[1]
PORT = 8766


def wait_app(driver):
    WebDriverWait(driver, 20).until(lambda d: d.execute_script("return typeof renderEstadoFinancieroOC==='function' && typeof normalizarClavePOS==='function'"))


def mount(driver, reset=True):
    driver.execute_script("""
      const reset=arguments[0];
      window.usuarioTienePermisoEdicion=()=>true;
      window.usuarioTienePermisoAsync=async()=>true;
      window.finBuscarOC=()=>({item:{numeroOC:'4530008964'}});
      window.renderFichaOC=()=>window.__mountFinance();
      window.__mountFinance=()=>{
        let host=document.getElementById('fichaOCBody');
        if(!host){host=document.createElement('main');host.id='fichaOCBody';document.body.appendChild(host);}
        host.innerHTML=renderEstadoFinancieroOC({numeroOC:'4530008964',montoTotalOC:5000000});
      };
      document.getElementById('headerModoSistema').textContent='Administrador';
      if(reset){
        posicionesFinancieras=[
          {idPosicionFinanciera:'master-16010',tipoBloqueFinanciero:'POSICION_OC',ocNro:'4530008964',posicion:'160,10',descripcion:'MTO DE EQUIPOS',cantidad:5,precioUnitario:356126.40,precioTotal:1780632.00},
          {idPosicionFinanciera:'master-17010',tipoBloqueFinanciero:'POSICION_OC',ocNro:'4530008964',posicion:'170,10',descripcion:'SEGUNDA POS',cantidad:2,precioUnitario:523798.84,precioTotal:1047597.68},
          {idPosicionFinanciera:'master-other',tipoBloqueFinanciero:'POSICION_OC',ocNro:'4530009999',posicion:'160,10',descripcion:'OTRA OC',cantidad:99,precioUnitario:1,precioTotal:99}
        ]; guardarPosicionesFinancieras();
      }
      window.__mountFinance();
    """, reset)


def row(driver, key):
    return driver.find_element(By.CSS_SELECTOR, f'tr[data-pos-key="{key}"]')


def prepare(driver, key, qty):
    current = row(driver, key)
    current.find_element(By.CSS_SELECTOR, '.chk-fin-pos-oc').click()
    field = current.find_element(By.CSS_SELECTOR, '[data-fin-cantidad-imputar]')
    field.send_keys(str(qty))
    return current


def confirm_text(driver, accept=True):
    WebDriverWait(driver, 5).until(lambda d: d.switch_to.alert)
    alert = driver.switch_to.alert
    text = alert.text
    alert.accept() if accept else alert.dismiss()
    return text


def movements(driver):
    return driver.execute_script("return posicionesFinancieras.filter(p=>p.tipoMovimiento==='IMPUTACION_POSICION')")


def run():
    server = subprocess.Popen(["python3", "-m", "http.server", str(PORT), "--bind", "127.0.0.1"], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    options = webdriver.ChromeOptions()
    options.add_argument('--headless=new'); options.add_argument('--no-sandbox'); options.add_argument('--disable-dev-shm-usage')
    driver = webdriver.Chrome(options=options)
    results = {}
    try:
        driver.get(f'http://127.0.0.1:{PORT}/index.html'); wait_app(driver); mount(driver)
        assert driver.execute_script("return normalizarClavePOS('160,10')") == '160.10'
        assert driver.execute_script("return normalizarClavePOS('160.10')") == '160.10'
        assert driver.execute_script("return normalizarClavePOS('160,1')") == '160.1'
        results['normalizacion_pos_textual'] = 'pass'

        selected = prepare(driver, '160.10', 4)
        assert selected.get_attribute('data-position-id') == 'master-16010'
        assert selected.find_element(By.CSS_SELECTOR, '[data-fin-monto-imputar]').text.endswith('1.424.505,60')
        driver.find_element(By.CSS_SELECTOR, '[data-fin-consumir]').click()
        text = confirm_text(driver, False)
        assert all(token in text for token in ['OC: 4530008964','POS 160,10','Cantidad a imputar: 4','Cantidad remanente: 1','$ 1.424.505,60','$ 356.126,40','Renglones seleccionados: 1','Unidades a imputar: 4'])
        assert len(movements(driver)) == 0
        results['cancelar_confirmacion'] = 'pass'

        driver.find_element(By.CSS_SELECTOR, '[data-fin-consumir]').click(); confirm_text(driver, True); confirm_text(driver, True)
        move = movements(driver)[0]
        assert move['source_position_id'] == 'master-16010' and move['pos_key'] == '160.10'
        assert move['cantidad_imputada'] == 4 and move['monto_imputado'] == 1424505.60
        assert move['cantidad_remanente'] == 1 and move['monto_remanente'] == 356126.40 and move['estadoPosicion'] == 'PARCIAL'
        assert driver.execute_script("return posicionesFinancieras.some(p=>p.idPosicionFinanciera==='master-16010')")
        driver.save_screenshot(str(ROOT / 'TEST_IMPUTACION_POSICIONES_SCREENSHOT.png'))
        results['consumo_parcial'] = 'pass'

        # Recarga: los movimientos se recuperan de la clave local existente.
        driver.refresh(); wait_app(driver); mount(driver, False)
        assert len(movements(driver)) == 1
        assert row(driver, '160.10').find_element(By.CSS_SELECTOR, '[data-fin-disponible]').text == '1'
        results['recarga'] = 'pass'

        prepare(driver, '160.10', 1); driver.find_element(By.CSS_SELECTOR, '[data-fin-consumir]').click(); confirm_text(driver, True); confirm_text(driver, True)
        assert len(movements(driver)) == 2
        assert movements(driver)[1]['estadoPosicion'] == 'CONSUMIDA' and movements(driver)[1]['cantidad_remanente'] == 0
        assert row(driver, '160.10').find_element(By.CSS_SELECTOR, '.chk-fin-pos-oc').get_attribute('disabled')
        results['consumo_total'] = 'pass'

        mount(driver)
        prepare(driver, '160.10', 6); driver.find_element(By.CSS_SELECTOR, '[data-fin-consumir]').click()
        assert 'dispone de 5 unidades; no puede imputar 6' in confirm_text(driver, True)
        assert len(movements(driver)) == 0
        results['exceso'] = 'pass'

        mount(driver)
        prepare(driver, '160.10', 4); prepare(driver, '170.10', 1)
        driver.find_element(By.CSS_SELECTOR, '[data-fin-consumir]').click(); summary=confirm_text(driver, True); confirm_text(driver, True)
        assert 'Renglones seleccionados: 2' in summary and 'Unidades a imputar: 5' in summary
        created=movements(driver); assert len(created)==2 and {m['source_position_id'] for m in created}=={'master-16010','master-17010'}
        results['multiseleccion'] = 'pass'
        return results
    finally:
        driver.quit(); server.terminate(); server.wait(timeout=5)


if __name__ == '__main__':
    print(json.dumps(run(), indent=2, ensure_ascii=False))
