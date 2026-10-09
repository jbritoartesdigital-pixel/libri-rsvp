import test from 'node:test';
import assert from 'node:assert/strict';
import {stat,readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import pngjs from 'pngjs';
const root=new URL('../public/vendor/',import.meta.url);
test('bundle local tem decoder QR, OCR português e arquivos WebAssembly necessários',async()=>{
 const expected=['pdf.min.mjs','pdf.worker.min.mjs','jsQR.js',
  'ocr/tesseract.min.js','ocr/worker.min.js','ocr/por.traineddata.gz',
  'ocr/core/tesseract-core.wasm.js','ocr/core/tesseract-core-simd.wasm.js',
  'ocr/core/tesseract-core-lstm.wasm.js','ocr/core/tesseract-core-simd-lstm.wasm.js'];
 for(const path of expected){
  const info=await stat(new URL(path,root));
  assert(info.size>1000,'Missing/empty local asset: '+path);
 }
 const lang=gunzipSync(await readFile(new URL('ocr/por.traineddata.gz',root)));
 assert(lang.length>100_000,'Portuguese traineddata appears empty');
});
test('decoder alternativo jsQR lê o PNG criado pela mesma biblioteca que gera os ingressos',async()=>{
 const code='a'.repeat(43),uri='https://libri.example.test/qr/'+code;
 const buf=await QRCode.toBuffer(uri,{type:'png',errorCorrectionLevel:'M',margin:4,scale:7});
 const png=pngjs.PNG.sync.read(buf);
 const found=jsQR(new Uint8ClampedArray(png.data),png.width,png.height,{inversionAttempts:'attemptBoth'});
 assert.equal(found?.data,uri);
});
