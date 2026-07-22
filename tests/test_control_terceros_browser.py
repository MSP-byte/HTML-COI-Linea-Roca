#!/usr/bin/env python3
"""Prueba Chromium/Selenium del Control de Terceros sin tocar Supabase real."""
import json
import os
import subprocess
import time
from pathlib import Path

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait


ROOT = Path(__file__).resolve().parents[1]
PORT = 8765
URL = f"http://127.0.0.1:{PORT}/index.html"


def fixture(driver, nro="4500000001", editable=True):
    driver.execute_script(
        """
        const [nro, editable] = arguments;
        const stored = JSON.parse(localStorage.getItem('ct-test-oc') || 'null');
        window.__ctTestOC = stored?.nro_oc === nro ? stored : {
          id:'fixture-uuid-'+nro,nro_oc:nro,control_terceros_hasta:'2026-08-31',
          control_terceros_estado:'Vigente'
        };
        window.__ctWrites=[];
        window.usuarioTienePermisoEdicion=()=>editable;
        window.resolverOrdenActual=ref=>String(ref).replace(/^OC[-_ ]*/i,'')===nro?window.__ctTestOC:null;
        window.guardarBaseLocal=()=>localStorage.setItem('ct-test-oc',JSON.stringify(window.__ctTestOC));
        window.guardarOrdenesSupabaseCache=()=>{};
        window.getSupabaseClient=()=>({from:table=>({update:payload=>({eq:(column,value)=>{
          window.__ctWrites.push({table,payload,column,value}); return Promise.resolve({error:null});
        }})})});
        window.__coiFichaOCActiva=nro;
        document.body.classList.toggle('modo-admin',editable);
        document.body.insertAdjacentHTML('beforeend',`<main id="fichaOCBody"><div class="oc-kpis">
          <div class="oc-kpi"><b>Activo</b><span>Estado documental</span></div></div>
          <section id="panelFichaContractual"></section></main>`);
        window.coiR28InjectControlTerceros(nro);
        """,
        nro,
        editable,
    )


def click(driver, selector):
    driver.find_element(By.CSS_SELECTOR, selector).click()


def run():
    server = subprocess.Popen(
        ["python3", "-m", "http.server", str(PORT), "--bind", "127.0.0.1"], cwd=ROOT,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    options = webdriver.ChromeOptions()
    options.add_argument("--headless=new")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    driver = webdriver.Chrome(options=options)
    results = {}
    try:
        driver.get(URL)
        WebDriverWait(driver, 20).until(lambda d: d.execute_script("return typeof window.coiR28InjectControlTerceros==='function'"))
        fixture(driver)
        card = "[data-r28-ct-card]"
        assert driver.find_element(By.CSS_SELECTOR, f"{card} [data-r28-ct-input]").get_attribute("disabled")

        # Editar: habilita sin escribir.
        click(driver, f"{card} [data-r28-ct-edit]")
        field = driver.find_element(By.CSS_SELECTOR, f"{card} [data-r28-ct-input]")
        assert not field.get_attribute("disabled")
        assert driver.execute_script("return window.__ctWrites.length") == 0
        results["editar"] = "pass"

        # Cancelar: restaura valor y no persiste.
        driver.execute_script("arguments[0].value='2026-10-15'", field)
        click(driver, f"{card} [data-r28-ct-cancel]")
        assert field.get_attribute("value") == "2026-08-31"
        assert driver.execute_script("return window.__ctWrites.length") == 0
        results["cancelar"] = "pass"

        # Guardar: exactamente un UPDATE filtrado por la OC abierta.
        click(driver, f"{card} [data-r28-ct-edit]")
        field = driver.find_element(By.CSS_SELECTOR, f"{card} [data-r28-ct-input]")
        driver.execute_script("arguments[0].value='2026-10-15'", field)
        click(driver, f"{card} [data-r28-ct-save]")
        WebDriverWait(driver, 5).until(lambda d: d.execute_script("return window.__ctWrites.length===1"))
        write = driver.execute_script("return window.__ctWrites[0]")
        assert write["table"] == "coi_ordenes" and write["column"] == "nro_oc" and write["value"] == "4500000001"
        assert write["payload"]["control_terceros_hasta"] == "2026-10-15"
        assert driver.find_element(By.CSS_SELECTOR, f"{card} .ct-date").text == "2026-10-15"
        results["guardar_unico"] = "pass"

        # Re-render: la delegación sigue activa y no duplica escrituras.
        driver.execute_script("window.coiR28InjectControlTerceros('4500000001')")
        click(driver, f"{card} [data-r28-ct-edit]")
        click(driver, f"{card} [data-r28-ct-cancel]")
        assert driver.execute_script("return window.__ctWrites.length") == 1
        results["rerender"] = "pass"

        # Cambio de OC descarta el borrador.
        click(driver, f"{card} [data-r28-ct-edit]")
        driver.execute_script("window.__ctTestOC={nro_oc:'4500000002',control_terceros_hasta:'2026-08-31'}; window.__coiFichaOCActiva='4500000002'; window.resolverOrdenActual=()=>window.__ctTestOC; window.coiR28InjectControlTerceros('4500000002')")
        assert driver.find_element(By.CSS_SELECTOR, f"{card} [data-r28-ct-input]").get_attribute("disabled")
        assert driver.execute_script("return window.__ctWrites.length") == 1
        results["cambio_oc"] = "pass"

        # Fechas inválidas no escriben.
        click(driver, f"{card} [data-r28-ct-edit]")
        for value in ("", "0001-01-01"):
            field = driver.find_element(By.CSS_SELECTOR, f"{card} [data-r28-ct-input]")
            driver.execute_script("arguments[0].value=arguments[1]", field, value)
            click(driver, f"{card} [data-r28-ct-save]")
        assert driver.execute_script("return window.__ctWrites.length") == 1
        results["fechas_invalidas"] = "pass"

        # Un visualizador no recibe controles.
        driver.execute_script("document.getElementById('fichaOCBody').remove()")
        fixture(driver, "4500000003", False)
        assert not driver.find_elements(By.CSS_SELECTOR, "[data-r28-ct-edit],[data-r28-ct-save],[data-r28-ct-cancel]")
        results["permisos"] = "pass"
        return results
    finally:
        driver.quit()
        server.terminate()
        server.wait(timeout=5)


if __name__ == "__main__":
    output = run()
    print(json.dumps(output, indent=2, ensure_ascii=False))
