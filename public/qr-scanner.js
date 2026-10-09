let decoderPromise;
function loadDecoder(){
 if(!decoderPromise)decoderPromise=new Promise((resolve,reject)=>{
  if(typeof globalThis.jsQR==='function')return resolve(globalThis.jsQR);
  const script=document.createElement('script');script.src='/vendor/jsQR.js';script.async=true;
  script.onload=()=>typeof globalThis.jsQR==='function'?resolve(globalThis.jsQR):reject(Error('Leitor QR indisponível.'));
  script.onerror=()=>reject(Error('Não foi possível carregar o leitor QR.'));document.head.append(script);
 }).catch(e=>{decoderPromise=null;throw e;});
 return decoderPromise;
}
export function extractQrToken(value,origin=globalThis.location?.origin){
 const raw=String(value||'').trim();
 if(!raw)return '';
 if(!raw.includes('/')&&!raw.includes(':'))return /^[A-Za-z0-9_-]{20,220}$/.test(raw)?raw:'';
 try{
  if(!origin)return '';
  const u=new URL(raw,origin);
  if(u.origin!==origin)return '';
  const m=u.pathname.match(/^\/qr\/([A-Za-z0-9_-]{20,220})\/?$/);
  return m?m[1]:'';
 }catch{return '';}
}
/** Never auto-register: the decoded token only opens a confirmation preview. */
export async function startUniversalQR({video,onRead,onError=()=>{},onStop=()=>{}}){
 if(!navigator.mediaDevices?.getUserMedia)throw Error('A câmera precisa de HTTPS e permissão do navegador.');
 let stream,active=true,timer=null,busy=false,detector=null,decoder=null;
 const stop=()=>{
  if(!active)return;active=false;if(timer!==null)clearTimeout(timer);
  stream?.getTracks().forEach(t=>t.stop());video.pause();video.srcObject=null;onStop();
 };
 const onPageHide=()=>stop();window.addEventListener('pagehide',onPageHide,{once:true});
 const onVisibility=()=>{if(document.visibilityState==='hidden')stop();};
 document.addEventListener('visibilitychange',onVisibility);
 try{
  if(typeof globalThis.BarcodeDetector==='function'){
   try{detector=new globalThis.BarcodeDetector({formats:['qr_code']});}catch{}
  }
  if(!detector)decoder=await loadDecoder();
  stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});
  video.srcObject=stream;video.hidden=false;await video.play();
  const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d',{willReadFrequently:true});
  if(!ctx&&!detector)throw Error('Seu navegador não permite a leitura do QR.');
  const tick=async()=>{
   if(!active||busy)return;
   busy=true;
   try{
    let scanned=null;
    if(detector){const found=await detector.detect(video);scanned=found[0]?.rawValue||null;}
    else if(video.readyState>=2){
     const ratio=Math.min(1,640/Math.max(video.videoWidth,video.videoHeight));
     canvas.width=Math.max(1,Math.floor(video.videoWidth*ratio));
     canvas.height=Math.max(1,Math.floor(video.videoHeight*ratio));
     ctx.drawImage(video,0,0,canvas.width,canvas.height);
     const pixels=ctx.getImageData(0,0,canvas.width,canvas.height);
     scanned=decoder(pixels.data,pixels.width,pixels.height,{inversionAttempts:'attemptBoth'})?.data||null;
    }
    const token=extractQrToken(scanned);
    if(token){stop();await onRead(token);return;}
   }catch(e){onError(e);}
   finally{busy=false;}
   if(active)timer=setTimeout(tick,240);
  };
  timer=setTimeout(tick,120);
 }catch(error){stop();throw error;}
 return ()=>{stop();document.removeEventListener('visibilitychange',onVisibility);window.removeEventListener('pagehide',onPageHide);};
}
