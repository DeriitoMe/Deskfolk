// Wrap Aseprite's lossless pixel exports in a multi-resolution Windows ICO.
// Run assemble-v42-icons.lua first, with output=.cache/icon-sizes.
const {readFileSync,writeFileSync,copyFileSync,mkdirSync}=require('node:fs');
const {resolve,join}=require('node:path');
const {createHash}=require('node:crypto');
const root=resolve(__dirname,'..'),icons=join(root,'assets/icons');
const sizes=[16,20,24,32,40,48,64,128,256];
const pngs=sizes.map(size=>{
 const data=readFileSync(join(root,'.cache/icon-sizes','icon-'+size+'.png'));
 if(data.readUInt32BE(16)!==size||data.readUInt32BE(20)!==size)throw Error('Unexpected PNG dimensions');
 return data;
});
const directory=Buffer.alloc(6+16*sizes.length);directory.writeUInt16LE(1,2);directory.writeUInt16LE(sizes.length,4);
let offset=directory.length;
sizes.forEach((size,i)=>{
 const p=6+i*16;directory[p]=size===256?0:size;directory[p+1]=size===256?0:size;
 directory.writeUInt16LE(1,p+4);directory.writeUInt16LE(32,p+6);directory.writeUInt32LE(pngs[i].length,p+8);directory.writeUInt32LE(offset,p+12);offset+=pngs[i].length;
});
mkdirSync(icons,{recursive:true});writeFileSync(join(icons,'deskfolk.ico'),Buffer.concat([directory,...pngs]));
const trayFiles={'tray.png':16,'tray@1.25x.png':20,'tray@1.5x.png':24,'tray@2x.png':32,'tray@2.5x.png':40,'tray@3x.png':48};
for(const [file,size] of Object.entries(trayFiles))copyFileSync(join(root,'.cache/icon-sizes','icon-'+size+'.png'),join(icons,file));
const hash=data=>createHash('sha256').update(data).digest('hex');
const manifest={master:'mutsumi-icon.aseprite',masterPixels:[48,48],scaling:'nearest-neighbor in Aseprite',trayLogicalPixels:[16,16],tray:Object.entries(trayFiles).map(([file,size])=>({file,pixels:[size,size],scaleFactor:size/16,sha256:hash(readFileSync(join(icons,file)))})),ico:{file:'deskfolk.ico',sizes,sha256:hash(readFileSync(join(icons,'deskfolk.ico')))}};
writeFileSync(join(icons,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');console.log(JSON.stringify(manifest));
