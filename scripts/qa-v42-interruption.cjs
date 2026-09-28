const {app,BrowserWindow}=require('electron');const{join}=require('node:path');const{pathToFileURL}=require('node:url');const{mkdirSync,writeFileSync}=require('node:fs');const assert=require('node:assert/strict');
const root=join(__dirname,'..'),out=join(root,'assets/characters/wakaba-mutsumi/v42-motion/preview');process.env.PET_USER_DATA=join(root,'.cache/v42-interrupt-'+Date.now());process.env.PET_TEST_MODE='1';mkdirSync(process.env.PET_USER_DATA,{recursive:true});const pause=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 await import(pathToFileURL(join(root,'out/main/index.js')).toString());let pet;for(let i=0;i<120;i++){pet=BrowserWindow.getAllWindows()[0];if(pet&&await pet.webContents.executeJavaScript('!!document.querySelector("canvas.pet-art[data-ready=true]")').catch(()=>false))break;await pause(100)}await pause(600);pet.showInactive();
 const js=s=>pet.webContents.executeJavaScript(s),action=()=>js('document.querySelector(".figure").dataset.action');
 await js('window.qaTime=0;window.qaNow=performance.now.bind(performance);Object.defineProperty(performance,"now",{value:()=>window.qaNow()+window.qaTime});true');
 const advance=async ms=>{await js('window.qaTime+='+ms);await pause(250)};
 const point=()=>js(`(()=>{const c=document.querySelector('canvas.pet-art'),r=c.getBoundingClientRect();return {x:Math.round(r.x+256/512*r.width),y:Math.round(r.y+270/512*r.height)}})()`);
 const down=async()=>{const p=await point();pet.webContents.sendInputEvent({type:'mouseMove',...p});pet.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...p});await pause(100);return p};
 const up=async p=>{pet.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...p});await pause(180)};
 await advance(30100);assert.equal(await action(),'nap');let p=await down();assert.equal(await action(),'idle','nap cancels on pointerdown');await up(p);assert.equal(await action(),'idle','interrupted nap click skips touch');
 await advance(29500);assert.equal(await action(),'idle');await advance(650);assert.equal(await action(),'nap');await advance(15100);assert.equal(await action(),'idle');await advance(30100);assert.equal(await action(),'water');
 p=await down();assert.equal(await action(),'idle','watering cancels immediately');pet.webContents.sendInputEvent({type:'mouseMove',x:p.x+12,y:p.y+7,button:'left'});await pause(120);assert.equal(await action(),'drag');await up({x:p.x+12,y:p.y+7});assert.equal(await action(),'idle');
 await advance(29100);assert.equal(await action(),'idle');await advance(1000);assert.equal(await action(),'nap');
 writeFileSync(join(out,'interruption.json'),JSON.stringify({passed:true,clock:'accelerated for input-path regression; durations independently verified in real time',checks:['nap pointerdown immediately idle','click does not resume nap','30 seconds after release','watering pointerdown immediately idle','existing drag reaction preserved','release returns idle without happy finale','fresh 30 seconds after drag']},null,2));console.log('PASS nap/water native pointer interruption');app.quit();
})().catch(e=>{console.error(e);app.exit(1)});
