// Full app boot in a disposable browser DOM, with cloud configuration removed.
import assert from 'node:assert/strict';import fs from 'node:fs';import {build} from 'esbuild';import {JSDOM,VirtualConsole} from 'jsdom';import {webcrypto} from 'node:crypto';
const errors=[];const vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e));
const dom=new JSDOM(fs.readFileSync('index.html','utf8'),{url:'https://test.invalid/',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:vc});
const w=dom.window;w.matchMedia=()=>({matches:false,addListener(){},removeListener(){}});w.scrollTo=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};Object.defineProperty(w,'crypto',{value:webcrypto});
const result=await build({entryPoints:['src/js/app.js'],bundle:true,write:false,format:'iife',platform:'browser',define:{'import.meta.env':'{}'}});
try{
 w.eval(result.outputFiles[0].text);w.document.dispatchEvent(new w.Event('DOMContentLoaded'));await new Promise(r=>setTimeout(r,10));
 const people=['a','b','c','d'].map((id,i)=>({id,name:i===0?'A <img src=x onerror=alert(1)>':id,elo:1000,matchesPlayed:0,wins:0,losses:0,gender:'male',frequency:'regular'}));
 w.StorageService.saveLocalMembers(people);w.StorageService.setCurrentUser('a');
 for(const tab of ['members','leaderboard','history','sessions','attendance','court'])w.appSwitchTab(tab);
 w.appViewPlayerProfile('a');assert.ok(w.document.body.textContent.includes('A <img'));assert.equal(w.document.querySelectorAll('[onerror],script:not([src])').length,0);
 assert.equal(errors.length,0,errors.map(e=>e.message).join('\n'));console.log('PASS Full app boots, renders all six tabs and safely displays member profile');
}finally{w.close();}
