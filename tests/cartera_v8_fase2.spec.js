const { test, expect } = require('@playwright/test');
const sample = Buffer.from('UEsDBBQAAAAIAK9sT11RjC3IqQAAAP0AAAAPAAAAeGwvd29ya2Jvb2sueG1sjY9JDoMwDEWvEvkABLroAjEI1C5YVSoHqFIwJYIkyE6H4zeCsu/Kw5ff98/Kj5nFC4m1szkkUQxlkb0dTXfnJhFEyzmM3i+plNyNaBRHbkEblMGRUT6M9JC8EKqeR0RvZnmI46M0SlvYCCn9w3DDoDs8ue5p0PoNQjgrH17jUS8MRbY68K8KqwzmUFft+Xapr1ULYt03fUgCglIdGmr6BGSRyf1U7umKL1BLAwQUAAAACACvbE9dbTbpdJoAAAAGAQAAGgAAAHhsL19yZWxzL3dvcmtib29rLnhtbC5yZWxzjc87DsIwDAbgq0Q+QN0yMKCmXVhYEReIUrep2jwUm9ftiRgQlRiYLP+2Pstt//CrulHmOQYNTVVD37VnWo2UgN2cWJWNwBqcSDogsnXkDVcxUSiTMWZvpLR5wmTsYibCXV3vMX8bsDXVadCQT0MD6vJM9I8dx3G2dIz26inIjxN4j3lhRyQFNXki0fCJGN+lqYoK2LW4+bB7AVBLAwQUAAAACACvbE9dUH0t6DkBAACWAwAAGAAAAHhsL3dvcmtzaGVldHMvc2hlZXQxLnhtbJWTcUrDMBTGrxJygKVzm6C0GbUNMtB2dLtAyJ422iYlic57eBHBG7iLmY1RFBLBPwLJe9/3hfeDly7f+g69grFSqwxPJwle0nSvzbNtARzyXWUz3Do3XBNiRQs9txM9gPKdB2167vzTPBI7GOC7k6nvyEWSXJKeS4VpeqqV3HGaGr1HJsMzXxXHSz7DyGVYqk4q2Djj69LS1NHq6wPVN02eEkdTcqwRcfaUMU/Jqvp+VeXF6vBeIYLWdyt2WwcSWCyBbbZ5GXI0MUdd/FYTP+E45nwccx6xTwN/FTHxugjRiKkLMIb3EpTTaAdo4FZ2nbYhHLEIphA8gXgR8vCpQlRixvliliTJlT9/0FmMdBb/oRMTbxsWwhOTNzBww0+THfE4EG0YTiyAqY4LCFGJOUIsyI/lIOPW0W9QSwECFAMUAAAACACvbE9dUYwtyKkAAAD9AAAADwAAAAAAAAAAAAAAgAEAAAAAeGwvd29ya2Jvb2sueG1sUEsBAhQDFAAAAAgAr2xPXW026XSaAAAABgEAABoAAAAAAAAAAAAAAIAB1gAAAHhsL19yZWxzL3dvcmtib29rLnhtbC5yZWxzUEsBAhQDFAAAAAgAr2xPXVB9Leg5AQAAlgMAABgAAAAAAAAAAAAAAIABqAEAAHhsL3dvcmtzaGVldHMvc2hlZXQxLnhtbFBLBQYAAAAAAwADAMsAAAAXAwAAAAA=','base64');
const sampleUpdated = Buffer.from('UEsDBBQAAAAIAKMLUF1RjC3IqQAAAP0AAAAPAAAAeGwvd29ya2Jvb2sueG1sjY9JDoMwDEWvEvkABLroAjEI1C5YVSoHqFIwJYIkyE6H4zeCsu/Kw5ff98/Kj5nFC4m1szkkUQxlkb0dTXfnJhFEyzmM3i+plNyNaBRHbkEblMGRUT6M9JC8EKqeR0RvZnmI46M0SlvYCCn9w3DDoDs8ue5p0PoNQjgrH17jUS8MRbY68K8KqwzmUFft+Xapr1ULYt03fUgCglIdGmr6BGSRyf1U7umKL1BLAwQUAAAACACjC1BdbTbpdJoAAAAGAQAAGgAAAHhsL19yZWxzL3dvcmtib29rLnhtbC5yZWxzjc87DsIwDAbgq0Q+QN0yMKCmXVhYEReIUrep2jwUm9ftiRgQlRiYLP+2Pstt//CrulHmOQYNTVVD37VnWo2UgN2cWJWNwBqcSDogsnXkDVcxUSiTMWZvpLR5wmTsYibCXV3vMX8bsDXVadCQT0MD6vJM9I8dx3G2dIz26inIjxN4j3lhRyQFNXki0fCJGN+lqYoK2LW4+bB7AVBLAwQUAAAACACjC1BdxdzzcAUBAACAAgAAGAAAAHhsL3dvcmtzaGVldHMvc2hlZXQxLnhtbHWScUrDMBTGrxJygL3MVkFJM7q2SkHb0XmB2GU22KYliU68hhfxDHoxszGKQvJHIPne+73wfTy6eh969Ca0kaNK8HJB8IrRw6hfTCeERa6qTII7a6cbANN2YuBmMU5Cucp+1AO37qmfwUxa8N0JGnq4IOQKBi4VZvSk5dxyRvV4QDrBkVPb4yWNMLIJlqqXSmytdro0jFpWfX+het2kFCyjcNSgPTN5iMmLqn4oqzQrfz4rBGhzXxZ3tWdCEZpQbB/T3Ec0IaLO/neDczjbjGebcQBfev7KQs2bzJdGqLt+0hzx1r7yXn7wHfflEGJvpQpTTYiKLyNCyLU7vkzgzxrAvF/sF1BLAQIUAxQAAAAIAKMLUF1RjC3IqQAAAP0AAAAPAAAAAAAAAAAAAACAAQAAAAB4bC93b3JrYm9vay54bWxQSwECFAMUAAAACACjC1BdbTbpdJoAAAAGAQAAGgAAAAAAAAAAAAAAgAHWAAAAeGwvX3JlbHMvd29ya2Jvb2sueG1sLnJlbHNQSwECFAMUAAAACACjC1BdxdzzcAUBAACAAgAAGAAAAAAAAAAAAAAAgAGoAQAAeGwvd29ya3NoZWV0cy9zaGVldDEueG1sUEsFBgAAAAADAAMAywAAAOMCAAAAAA==','base64');

test('Cartera V8 fase 2: vista independiente, KPIs, progreso y ficha', async ({page}) => {
  await page.goto('/index.html',{waitUntil:'domcontentloaded'});
  await expect(page.locator('#coiV8V2Nav')).toHaveCount(1);
  await page.evaluate(()=>document.getElementById('coiV8V2Nav').click());
  await expect(page.locator('#vistaCarteraObrasV8')).toHaveClass(/active/);
  await page.locator('#cv2File').setInputFiles({
    name:'BASE_OBRAS_TEST.xlsx',
    mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer:sample
  });
  await expect(page.locator('#cv2Result')).toContainText('2 de 2 registros',{timeout:20000});
  await expect(page.locator('#cv2Kpis')).toContainText('Intervenciones');
  await expect(page.locator('#cv2Body tr')).toHaveCount(2);

  await page.locator('#cv2File').setInputFiles({
    name:'BASE_OBRAS_TEST_ACTUALIZADO.xlsx',
    mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer:sampleUpdated
  });
  await expect(page.locator('#cv2Result')).toContainText('1 de 1 registros',{timeout:20000});
  await expect(page.locator('#cv2Body tr')).toHaveCount(1);
  await expect(page.locator('#cv2Body')).toContainText('Obra actualizada');
  await expect(page.locator('#cv2ChartEstado')).toContainText('Finalizada');

  await page.locator('#cv2Body [data-cv2-row]').first().click();
  await expect(page.locator('#cv2Detail')).toBeVisible();
  await expect(page.locator('#cv2DetailGrid')).toContainText('Denominación / Pliego');
  await expect(page.locator('#cv2DetailGrid')).toContainText('Sin informar');
  // Una celda vacía nunca debe dibujarse como etiqueta sin valor.
  const blanks = await page.locator('#cv2DetailGrid .cv2-field span').evaluateAll(nodes => nodes.filter(n => !n.textContent.trim()).length);
  expect(blanks).toBe(0);
  await page.evaluate(()=>{
    window.resolverEstacionCatalogo=value=>({idEstacion:'EST-TEST',nombre:value||'Estación test'});
    window.seleccionarEstacionPorId=id=>{window.__cv2SelectedStation=id;return {idEstacion:id,nombre:'Estación test'};};
  });
  await page.locator('#cv2GoMap').click();
  await expect.poll(()=>page.evaluate(()=>window.__cv2SelectedStation||'')).toBe('EST-TEST');
  await page.evaluate(()=>window.COI_CARTERA_V8_P2.open());
  await expect(page.locator('#cv2Detail')).toBeVisible();
  await page.locator('#cv2CloseDetail').click();
  await expect(page.locator('#cv2Detail')).toBeHidden();
  await page.locator('#cv2Audit').click();
  await expect(page.locator('#coiV8Overlay')).not.toHaveAttribute('hidden');
  await page.locator('#coiV8Close').click();
  // La auditoría no debe restaurar el Excel anterior: la cartera sigue con la última carga.
  await expect(page.locator('#cv2Body tr')).toHaveCount(1);
  await expect(page.locator('#cv2Body')).toContainText('Obra actualizada');
});
