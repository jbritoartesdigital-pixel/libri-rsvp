// Etapa 2: teste isolado do Admin RSVP. Não usa banco, convidados reais ou produção.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {join,extname,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright';
import {PNG} from 'pngjs';

const dir=resolve('.artifacts/etapa2-rsvp');
mkdirSync(dir,{recursive:true});
const base=process.env.LIBRI_BASE_SHA||'';
if(base&&!/^[a-f0-9]{40}$/i.test(base))throw Error('Referência inválida');
const report={fixture:'fictícia',passed:[],warnings:[],errors:[],result:'pending'};
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8','.png':'image/png','.svg':'image/svg+xml',
  '.json':'application/json'};
const cache=new Map();
function getFile(file,sha){
  const key=sha+':'+file;
  if(cache.has(key))return cache.get(key);
  const data=sha?execFileSync('git',['show',sha+':'+file],{maxBuffer:8*1024*1024})
    :readFileSync(file);
  cache.set(key,data);return data;
}
async function runServer(sha){
  let authenticated=false;
  const server=createServer((req,res)=>{
    const path=new URL(req.url,'http://localhost').pathname;
    const respond=(status,data,ct='application/json; charset=utf-8')=>{
      res.writeHead(status,{'content-type':ct,'cache-control':'no-store'});res.end(data);
    };
    const json=(status,data)=>respond(status,JSON.stringify(data));
    if(path.startsWith('/api/')){
      if(path==='/api/admin/me')return json(authenticated?200:401,
        authenticated?{admin:{id:'teste'}}:{error:'Não autenticado'});
      if(path==='/api/admin/login'&&req.method==='POST'){
        authenticated=true;return json(200,{ok:true});
      }
      if(path==='/api/admin/events')return json(authenticated?200:401,
        authenticated?{events:[]}:{error:'Não autenticado'});
      if(path==='/api/admin/failure')return json(503,{error:'Falha fictícia'});
      return json(501,{error:'Rota fora do cenário simulado'});
    }
    const target=path==='/admin'||path==='/admin/'?'/index.html':path;
    if(target.includes('..')||!/^\/[a-zA-Z0-9_./-]+$/.test(target))
      return respond(404,'Não encontrado','text/plain');
    try {
      const file='public'+target;
      return respond(200,getFile(file,sha),mime[extname(target)]||'application/octet-stream');
    }catch{return respond(404,'Arquivo não encontrado','text/plain');}
  });
  await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
  return {server,url:'http://127.0.0.1:'+server.address().port};
}
async function testVersion(browser,sha,label){
  const local=await runServer(sha);
  const ctx=await browser.newContext({viewport:{width:390,height:844},
    isMobile:true,hasTouch:true,deviceScaleFactor:1,locale:'pt-BR',
    timezoneId:'America/Sao_Paulo',reducedMotion:'reduce'});
  const page=await ctx.newPage(),errors=[],outside=[];
  page.on('pageerror',e=>errors.push(e.name));
  page.on('request',r=>{if(!r.url().startsWith(local.url+'/'))outside.push('externa');});
  await page.route('**/*',route=>route.request().url().startsWith(local.url+'/')
    ?route.continue():route.abort('blockedbyclient'));
  try{
    await page.clock.setFixedTime(new Date('2026-10-10T15:00:00Z'));
    await page.goto(local.url+'/admin',{waitUntil:'domcontentloaded'});
    await page.locator('#login input[name="password"]').waitFor({timeout:15000});
    assert.equal(await page.locator('#passkeyLogin').isVisible(),true);
    await page.locator('#login input[name="password"]').fill('SENHA_APENAS_TESTE');
    await page.locator('#login button[type="submit"],#login button').first().click();
    await page.locator('#newEvent').waitFor({timeout:12000});
    await page.getByRole('button',{name:'Ver diagnóstico técnico'}).waitFor();
    for(const width of [320,360,390,412]){
      await page.setViewportSize({width,height:844});
      const d=await page.evaluate(()=>{
        const r=document.querySelector('#app').getBoundingClientRect();
        return {doc:document.documentElement.scrollWidth,body:document.body.scrollWidth,left:r.left,right:r.right};
      });
      assert.ok(d.doc<=width+1&&d.body<=width+1&&d.left>=-1&&d.right<=width+1,
        'Overflow RSVP '+width+': '+JSON.stringify(d));
      if(width===320||width===390)await page.screenshot({
        path:join(dir,label+'-'+width+'.png'),fullPage:true,animations:'disabled'});
    }
    await page.evaluate(()=>fetch('/api/admin/failure').then(()=>null));
    await page.getByRole('button',{name:'Ver diagnóstico técnico'}).click();
    const dlg=page.locator('.libri-bug-dialog[open]');
    await dlg.waitFor();
    const message=await dlg.locator('textarea').inputValue();
    assert.match(message,/Libri RSVP \| DIAGNÓSTICO/);
    assert.match(message,/503/);
    assert.ok(!message.includes('SENHA_APENAS_TESTE'));
    assert.equal(await dlg.getByRole('button',{name:'Enviar ao ChatGPT'}).count(),1);
    assert.deepEqual(errors,[],'Exceção no navegador');
    assert.deepEqual(outside,[],'Tráfego inesperado fora do servidor fictício');
    report.passed.push(label+': login simulado, digital presente, 🐞, 4 larguras');
  }finally{
    await ctx.close();
    await new Promise(ok=>local.server.close(ok));
  }
}
function compare(width){
  const a=PNG.sync.read(readFileSync(join(dir,'main-'+width+'.png')));
  const b=PNG.sync.read(readFileSync(join(dir,'alteracao-'+width+'.png')));
  if(a.width!==b.width||a.height!==b.height){
    report.warnings.push('Altura/largura mudou em '+width+'px; conferir capturas');return;
  }
  let count=0;
  const d=new PNG({width:a.width,height:a.height});
  for(let i=0;i<a.data.length;i+=4){
    const changed=[0,1,2].some(j=>Math.abs(a.data[i+j]-b.data[i+j])>25);
    if(changed)count++;
    for(let j=0;j<3;j++)d.data[i+j]=changed?(j===0?230:j===1?50:70):b.data[i+j];
    d.data[i+3]=255;
  }
  writeFileSync(join(dir,'diff-'+width+'.png'),PNG.sync.write(d));
  report.warnings.push('Mudança visual '+width+'px: '+
    (100*count/(a.width*a.height)).toFixed(2)+'% (aviso, não falha)');
}
let browser;
try{
  browser=await chromium.launch({channel:'chrome',headless:true});
  if(base)await testVersion(browser,base,'main');
  await testVersion(browser,'','alteracao');
  if(base)for(const width of [320,390])compare(width);
  report.result='success';
  console.log('✓ RSVP: login fictício, mobile, comparação visual e 🐞 aprovados');
}catch(e){
  report.result='failure';
  report.errors.push(String(e?.message||e).slice(0,1500));
  console.error('Etapa 2 RSVP falhou:',String(e?.message||e));
  process.exitCode=1;
}finally{
  await browser?.close();
  writeFileSync(join(dir,'resumo.json'),JSON.stringify(report,null,2)+'\n');
  writeFileSync(join(dir,'diagnostico-para-chatgpt.md'),
    'LIBRI RSVP | TESTES AUTOMÁTICOS\nAmbiente: totalmente fictício\n'+
    'Resultado: '+report.result+'\n'+report.passed.join('\n')+'\n'+
    report.warnings.join('\n')+'\n'+report.errors.join('\n')+'\n');
}
