let scriptPromise=null;
const loadScript=src=>new Promise((resolve,reject)=>{
 const script=document.createElement('script');script.src=src;script.async=true;
 script.onload=resolve;script.onerror=()=>reject(Error('Não foi possível iniciar o reconhecimento de texto.'));
 document.head.append(script);
});
export async function startLocalOCR({progress=()=>{}}={}){
 if(!scriptPromise)scriptPromise=loadScript('/vendor/ocr/tesseract.min.js').catch(e=>{scriptPromise=null;throw e;});
 await scriptPromise;
 if(!globalThis.Tesseract?.createWorker)throw Error('Reconhecimento indisponível neste navegador.');
 progress('Preparando OCR em português…');
 const worker=await globalThis.Tesseract.createWorker('por',1,{
  workerPath:'/vendor/ocr/worker.min.js',
  corePath:'/vendor/ocr/core',
  langPath:'/vendor/ocr',
  workerBlobURL:false,
  cacheMethod:'write',
  logger:msg=>{if(msg.status==='recognizing text')progress('Lendo imagem: '+Math.round((msg.progress||0)*100)+'%');}
 });
 return {
  recognize:async image=>(await worker.recognize(image)).data,
  terminate:()=>worker.terminate()
 };
}
export async function scannedPdfPage(page,ocr,{progress=()=>{}}={}){
 const original=page.getViewport({scale:1});
 const scale=Math.min(2,1800/Math.max(original.width,original.height));
 const viewport=page.getViewport({scale});
 const canvas=document.createElement('canvas');
 canvas.width=Math.max(1,Math.round(viewport.width));canvas.height=Math.max(1,Math.round(viewport.height));
 const ctx=canvas.getContext('2d',{willReadFrequently:true});
 if(!ctx)throw Error('O navegador não permite analisar esta página.');
 await page.render({canvasContext:ctx,viewport}).promise;
 progress('Reconhecendo imagem digitalizada…');
 try{
  const result=await ocr.recognize(canvas);
  return {text:String(result.text||''),confidence:Number(result.confidence||0)};
 }finally{canvas.width=0;canvas.height=0;}
}
