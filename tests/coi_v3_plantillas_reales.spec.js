const {test,expect}=require('@playwright/test');
function fixtureXlsx(sheetTitles,rowsBySheet){
 const enc=s=>Buffer.from(s,'utf8'),pieces=[],central=[];let offset=0;
 function crc32(b){let c=0xffffffff;for(const x of b){c^=x;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0)}return(c^0xffffffff)>>>0}
 function add(name,data){
  const n=enc(name),b=enc(data),crc=crc32(b),local=Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);
  local.writeUInt32LE(crc,14);local.writeUInt32LE(b.length,18);local.writeUInt32LE(b.length,22);local.writeUInt16LE(n.length,26);
  pieces.push(local,n,b);
  const record=Buffer.alloc(46);record.writeUInt32LE(0x02014b50,0);record.writeUInt16LE(20,4);record.writeUInt16LE(20,6);
  record.writeUInt32LE(crc,16);record.writeUInt32LE(b.length,20);record.writeUInt32LE(b.length,24);record.writeUInt16LE(n.length,28);record.writeUInt32LE(offset,42);
  central.push(record,n);offset+=local.length+n.length+b.length;
 }
 const xmlEscape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
 const col=num=>{let v='',n=num+1;while(n){n--;v=String.fromCharCode(65+n%26)+v;n=Math.floor(n/26)}return v};
 const ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
 const rel='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
 const wb='<?xml version="1.0"?><workbook xmlns="'+ns+'" xmlns:r="'+rel+'"><sheets>'+sheetTitles.map((title,i)=>'<sheet name="'+xmlEscape(title)+'" sheetId="'+(i+1)+'" r:id="rId'+(i+1)+'"/>').join('')+'</sheets></workbook>';
 const relations='<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+sheetTitles.map((name,i)=>'<Relationship Id="rId'+(i+1)+'" Type="'+rel+'/worksheet" Target="worksheets/sheet'+(i+1)+'.xml"/>').join('')+'</Relationships>';
 add('xl/workbook.xml',wb);add('xl/_rels/workbook.xml.rels',relations);
 for(let i=0;i<sheetTitles.length;i++){
  const rows=rowsBySheet[i]||[];
  const sheet='<?xml version="1.0"?><worksheet xmlns="'+ns+'"><sheetData>'+rows.map(([row,cells])=>'<row r="'+row+'">'+Object.entries(cells).map(([index,value])=>'<c r="'+col(Number(index))+row+'" t="inlineStr"><is><t>'+xmlEscape(value)+'</t></is></c>').join('')+'</row>').join('')+'</sheetData></worksheet>';
  add('xl/worksheets/sheet'+(i+1)+'.xml',sheet);
 }
 const body=Buffer.concat(pieces),c=Buffer.concat(central),end=Buffer.alloc(22);
 end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(sheetTitles.length+2,8);end.writeUInt16LE(sheetTitles.length+2,10);
 end.writeUInt32LE(c.length,12);end.writeUInt32LE(body.length,16);
 return Buffer.concat([body,c,end]);
}
test('Excel Servicios: extrae 2 contratos del BUSCADOR y no los duplica por ACTA MEDICION',async({page})=>{
 await page.goto('/index.html',{waitUntil:'domcontentloaded'});
 const head={2:'OC N°',10:'Descripción del Servicio',11:'ESTACION',12:'PROVEED.',13:'FECHA ACTA INICIO'};
 const s=[[6,head],[7,{2:'4530009805',10:'Preventivo escaleras',11:'A DEMANDA',12:'FEMYP S.R.L'}],[8,{2:'4550000286',10:'Reparación ascensores',11:'TEMPERLEY',12:'FEMYP S.R.L'}]];
 const measurements=[[2,{3:'OC',7:'Descripcion',17:'PROVEEDOR'}],[3,{3:'4530009805',7:'Escalera 1',17:'FEMYP'}],[4,{3:'4530009805',7:'Escalera 2',17:'FEMYP'}],[5,{3:'4550000286',7:'Ascensor 1',17:'FEMYP'}]];
 const zip=fixtureXlsx(['BUSCADOR SVICIOS OC','3 - (ACTA MEDICION)'],[s,measurements]);
 const output=await page.evaluate(async bytes=>{
  const file=new File([new Uint8Array(bytes)],'servicios.xlsx',{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  const parsed=await window.__COI_CARTERA_V8_F1__.readSheet(file,'Servicio');
  return {sheet:parsed.sheet,rows:parsed.rows.length,ocs:parsed.rows.map(r=>r.cells[2])};
 },Array.from(zip));
 expect(output).toEqual({sheet:'BUSCADOR SVICIOS OC',rows:2,ocs:['4530009805','4550000286']});
});
test('Excel Obras: lee BASE_OBRAS fila 3 sin confundir DASHBOARD',async({page})=>{
 await page.goto('/index.html',{waitUntil:'domcontentloaded'});
 const zip=fixtureXlsx(['DASHBOARD','BASE_OBRAS'],[[[1,{0:'TOTAL DE OBRAS',3:'OC'}]],
 [[3,{0:'N° OBRA',3:'DENOMINACIÓN / PLIEGO',17:'OC',20:'CONTRATISTA'}],[4,{0:'42',3:'Canaletas TRE',17:'4530009408',20:'COREL'}]]]);
 const output=await page.evaluate(async bytes=>{
  const file=new File([new Uint8Array(bytes)],'obras.xlsx',{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  const parsed=await window.__COI_CARTERA_V8_F1__.readSheet(file,'Obra');
  return {sheet:parsed.sheet,rows:parsed.rows.length,oc:parsed.rows[0].cells[17]};
 },Array.from(zip));
 expect(output).toEqual({sheet:'BASE_OBRAS',rows:1,oc:'4530009408'});
});
