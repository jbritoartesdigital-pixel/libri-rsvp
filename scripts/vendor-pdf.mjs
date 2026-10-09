import {mkdir,copyFile} from 'node:fs/promises';
import {join} from 'node:path';
const from=join('node_modules','pdfjs-dist','build'),to=join('public','vendor');
await mkdir(to,{recursive:true});
await copyFile(join(from,'pdf.min.mjs'),join(to,'pdf.min.mjs'));
await copyFile(join(from,'pdf.worker.min.mjs'),join(to,'pdf.worker.min.mjs'));
console.log('PDF.js files copied locally from the pinned dependency.');
