import {mkdir,copyFile,readFile,writeFile,readdir,stat} from 'node:fs/promises';
import {join,basename} from 'node:path';
import {gzipSync} from 'node:zlib';
const from=join('node_modules','pdfjs-dist','build'),to=join('public','vendor');
await mkdir(to,{recursive:true});
for(const file of ['pdf.min.mjs','pdf.worker.min.mjs'])await copyFile(join(from,file),join(to,file));
const ocr=join(to,'ocr'),coreOut=join(ocr,'core');
await mkdir(coreOut,{recursive:true});
await copyFile(join('node_modules','jsqr','dist','jsQR.js'),join(to,'jsQR.js'));
const tess=join('node_modules','tesseract.js','dist');
for(const name of ['tesseract.min.js','worker.min.js'])await copyFile(join(tess,name),join(ocr,name));
const core=join('node_modules','tesseract.js-core');
let copied=0;
for(const name of await readdir(core)){
 if(!/^tesseract-core.*\.(?:js|wasm)$/.test(name))continue;
 await copyFile(join(core,name),join(coreOut,name));copied++;
}
if(copied<4)throw Error('Tesseract core is incomplete');
const languageRoot=join('node_modules','@tesseract.js-data','por');
async function findModel(directory){
 for(const item of await readdir(directory,{withFileTypes:true})){
  const filename=join(directory,item.name);
  if(item.isDirectory()){const found=await findModel(filename);if(found)return found;}
  else if(/^por\.traineddata(?:\.gz)?$/.test(item.name))return filename;
 }
 return null;
}
const model=await findModel(languageRoot);
if(!model)throw Error('Missing pinned Portuguese OCR model');
const trained=await readFile(model);
await writeFile(join(ocr,'por.traineddata.gz'),model.endsWith('.gz')?trained:gzipSync(trained));
console.log('Local PDF.js + jsQR + Portuguese Tesseract assets prepared (no CDN).');
