const { test, expect } = require('@playwright/test');
// XLSX minimo sintetico sin datos de produccion, comprimido con ZIP/deflate.
const sample = Buffer.from('UEsDBBQAAAAIAK9sT11RjC3IqQAAAP0AAAAPAAAAeGwvd29ya2Jvb2sueG1sjY9JDoMwDEWvEvkABLroAjEI1C5YVSoHqFIwJYIkyE6H4zeCsu/Kw5ff98/Kj5nFC4m1szkkUQxlkb0dTXfnJhFEyzmM3i+plNyNaBRHbkEblMGRUT6M9JC8EKqeR0RvZnmI46M0SlvYCCn9w3DDoDs8ue5p0PoNQjgrH17jUS8MRbY68K8KqwzmUFft+Xapr1ULYt03fUgCglIdGmr6BGSRyf1U7umKL1BLAwQUAAAACACvbE9dbTbpdJoAAAAGAQAAGgAAAHhsL19yZWxzL3dvcmtib29rLnhtbC5yZWxzjc87DsIwDAbgq0Q+QN0yMKCmXVhYEReIUrep2jwUm9ftiRgQlRiYLP+2Pstt//CrulHmOQYNTVVD37VnWo2UgN2cWJWNwBqcSDogsnXkDVcxUSiTMWZvpLR5wmTsYibCXV3vMX8bsDXVadCQT0MD6vJM9I8dx3G2dIz26inIjxN4j3lhRyQFNXki0fCJGN+lqYoK2LW4+bB7AVBLAwQUAAAACACvbE9dUH0t6DkBAACWAwAAGAAAAHhsL3dvcmtzaGVldHMvc2hlZXQxLnhtbJWTcUrDMBTGrxJygKVzm6C0GbUNMtB2dLtAyJ422iYlic57eBHBG7iLmY1RFBLBPwLJe9/3hfeDly7f+g69grFSqwxPJwle0nSvzbNtARzyXWUz3Do3XBNiRQs9txM9gPKdB2167vzTPBI7GOC7k6nvyEWSXJKeS4VpeqqV3HGaGr1HJsMzXxXHSz7DyGVYqk4q2Djj69LS1NHq6wPVN02eEkdTcqwRcfaUMU/Jqvp+VeXF6vBeIYLWdyt2WwcSWCyBbbZ5GXI0MUdd/FYTP+E45nwccx6xTwN/FTHxugjRiKkLMIb3EpTTaAdo4FZ2nbYhHLEIphA8gXgR8vCpQlRixvliliTJlT9/0FmMdBb/oRMTbxsWwhOTNzBww0+THfE4EG0YTiyAqY4LCFGJOUIsyI/lIOPW0W9QSwECFAMUAAAACACvbE9dUYwtyKkAAAD9AAAADwAAAAAAAAAAAAAAgAEAAAAAeGwvd29ya2Jvb2sueG1sUEsBAhQDFAAAAAgAr2xPXW026XSaAAAABgEAABoAAAAAAAAAAAAAAIAB1gAAAHhsL19yZWxzL3dvcmtib29rLnhtbC5yZWxzUEsBAhQDFAAAAAgAr2xPXVB9Leg5AQAAlgMAABgAAAAAAAAAAAAAAIABqAEAAHhsL3dvcmtzaGVldHMvc2hlZXQxLnhtbFBLBQYAAAAAAwADAMsAAAAXAwAAAAA=','base64');
test('Cartera V8: boton de navegacion e importacion XLSX local en modo seguro', async ({ page }) => {
  await page.goto('/index.html',{waitUntil:'domcontentloaded'});
  await expect(page.locator('#btnCarteraObrasV8')).toHaveCount(1);
  await page.evaluate(() => document.getElementById('btnCarteraObrasV8').click());
  await expect(page.locator('#coiV8Overlay')).not.toHaveAttribute('hidden');
  await page.locator('#coiV8File').setInputFiles({name:'BASE_OBRAS_PRUEBA.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:sample});
  await expect(page.locator('#coiV8Message')).toContainText(/Conciliaci[oó]n|Inici[aá]|Supabase|conexi[oó]n/i,{timeout:12000});
  await expect(page.locator('#coiV8Found')).toContainText('2 resultados de 2 registros');
  await expect(page.locator('#coiV8Rows tr')).toHaveCount(2);
  await expect(page.locator('#coiV8Rows')).toContainText('N.º obra repetido');
  await expect(page.locator('#coiV8Rows')).toContainText('Sin OC');
  await expect(page.locator('#coiV8Export')).toBeEnabled();
  await page.evaluate(() => document.getElementById('coiV8Close').click());
  await expect(page.locator('#coiV8Overlay')).toHaveAttribute('hidden');
});
