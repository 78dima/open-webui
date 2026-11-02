import fs from 'node:fs/promises';
import sharp from 'sharp';
const source = 'src/lib/custom/brand/logo.png';
const sizes = {'logo.png':500,'favicon.png':512,'favicon-16x16.png':16,'favicon-32x32.png':32,'favicon-96x96.png':96,'apple-touch-icon.png':180,'web-app-manifest-192x192.png':192,'web-app-manifest-512x512.png':512,'splash.png':500,'splash-dark.png':500};
for(const [name,size] of Object.entries(sizes)) {
 let image = sharp(source).resize(size,size);
 if(name === 'splash-dark.png') image = image.negate({alpha:false});
 await image.png().toFile('static/static/'+name);
}
await fs.copyFile('static/static/favicon.png','static/favicon.png');
const icons = await Promise.all([16,32].map(size=>sharp(source).resize(size,size).png().toBuffer()));
const header=Buffer.alloc(6+16*icons.length);header.writeUInt16LE(1,2);header.writeUInt16LE(icons.length,4);let offset=header.length;
icons.forEach((data,i)=>{const size=[16,32][i],p=6+16*i;header[p]=size;header[p+1]=size;header.writeUInt16LE(1,p+4);header.writeUInt16LE(32,p+6);header.writeUInt32LE(data.length,p+8);header.writeUInt32LE(offset,p+12);offset+=data.length;});
await fs.writeFile('static/static/favicon.ico',Buffer.concat([header,...icons]));
const png=await sharp(source).resize(500,500).png().toBuffer();
await fs.writeFile('static/static/favicon.svg',`<svg xmlns="http://www.w3.org/2000/svg" width="500" height="500" viewBox="0 0 500 500"><image width="500" height="500" href="data:image/png;base64,${png.toString('base64')}"/></svg>`);
