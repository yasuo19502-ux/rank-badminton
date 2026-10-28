// Full app boot in a disposable browser DOM, with cloud configuration removed.
import assert from 'node:assert/strict';import fs from 'node:fs';import {build} from 'esbuild';import {JSDOM,VirtualConsole} from 'jsdom';import {webcrypto} from 'node:crypto';
const errors=[];const vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e));
const dom=new JSDOM(fs.readFileSync('index.html','utf8'),{url:'https://test.invalid/',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:vc});
const w=dom.window;w.matchMedia=()=>({matches:false,addListener(){},removeListener(){}});w.scrollTo=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};Object.defineProperty(w,'crypto',{value:webcrypto});
// JSDOM does not implement native dialog methods; browser checks cover focus and Escape.
w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
const result=await build({stdin:{contents:fs.readFileSync('src/js/app.js','utf8')+'\nwindow.__refreshHeader=renderUserAuthHeader;',resolveDir:process.cwd()+'/src/js',sourcefile:'app.js'},bundle:true,write:false,format:'iife',platform:'browser',define:{'import.meta.env':'{}'}});
try{
 w.eval(result.outputFiles[0].text);w.document.dispatchEvent(new w.Event('DOMContentLoaded'));await new Promise(r=>setTimeout(r,10));
 const people=['a','b','c','d'].map((id,i)=>({id,name:i===0?'A <img src=x onerror=alert(1)>':id,elo:1000,matchesPlayed:0,wins:0,losses:0,gender:'male',frequency:'regular'}));
 w.StorageService.saveLocalMembers(people);w.StorageService.setCurrentUser('a');
 w.__refreshHeader();
 const account=w.document.getElementById('account-menu'),trigger=()=>w.document.getElementById('header-user-widget');
 trigger().click();assert.equal(account.open,true,'Avatar opens the account dialog');assert.equal(trigger().getAttribute('aria-expanded'),'true');
 assert.ok(account.textContent.includes(people[0].name),'Menu safely displays the signed-in name');
 assert.equal(account.querySelectorAll('[data-member-action=shop],[data-member-action=fund]').length,0,'Shared club actions remain outside account menu');
 account.querySelector('[data-member-action=wallet]').click();await new Promise(r=>setTimeout(r,0));assert.equal(account.open,false);assert.ok(w.document.querySelector('#modal-user-wallet').classList.contains('open'));
 w.document.querySelector('#modal-user-wallet .btn-close-modal').click();
 trigger().click();account.querySelector('[data-member-action=inventory]').click();await new Promise(r=>setTimeout(r,0));assert.equal(account.open,false);assert.ok(w.document.querySelector('#modal-club-shop').classList.contains('open'));
 w.document.querySelector('#modal-club-shop .btn-close-modal').click();
 trigger().click();account.querySelector('[data-member-action=myhistory]').click();await new Promise(r=>setTimeout(r,0));assert.equal(account.open,false);assert.ok(w.document.querySelector('#modal-player-profile').classList.contains('open'));
 w.document.querySelector('#modal-player-profile .btn-close-modal').click();
 trigger().click();account.querySelector('[data-member-action=members]').click();await new Promise(r=>setTimeout(r,0));assert.equal(account.open,false);assert.equal(w.document.getElementById('tab-members').style.display,'block');
 trigger().click();account.querySelector('[data-member-action=me]').click();assert.equal(account.open,false);assert.equal(w.document.getElementById('tab-me').style.display,'block');
 trigger().click();w.document.getElementById('btn-close-account-menu').click();assert.equal(account.open,false);assert.equal(trigger().getAttribute('aria-expanded'),'false');

 for(const tab of ['members','leaderboard','history','sessions','attendance','court','me'])w.appSwitchTab(tab);
 assert.equal(w.document.querySelectorAll('.mobile-nav-item').length,4);
 assert.equal(w.document.querySelector('.mobile-nav-item[aria-current=page]').dataset.tab,'me');
 w.document.querySelector('[data-member-action=wallet]').click();await new Promise(r=>setTimeout(r,0));assert.ok(w.document.querySelector('#modal-user-wallet').classList.contains('open'));
 w.appSwitchTab('history');assert.equal(w.document.querySelector('.mobile-nav-item[aria-current=page]').dataset.tab,'court');
 w.document.querySelector('[data-section-link=attendance]').click();assert.equal(w.document.querySelector('#tab-attendance').style.display,'block');
 w.appSwitchTab('me');w.document.querySelector('[data-member-action=members]').click();assert.equal(w.document.querySelector('#tab-members').style.display,'block');
 assert.ok(w.document.querySelector('#tab-me #banner-celebrate-2010'));
 const ids=[...w.document.querySelectorAll('[id]')].map(e=>e.id);assert.equal(new Set(ids).size,ids.length,'No duplicate IDs after restructuring');
 w.appViewPlayerProfile('a');assert.ok(w.document.body.textContent.includes('A <img'));assert.equal(w.document.querySelectorAll('[onerror],script:not([src])').length,0);
 trigger().click();account.querySelector('[data-member-action=logout]').click();await new Promise(r=>setTimeout(r,0));assert.equal(account.open,false);assert.equal(w.StorageService.getCurrentUser(),null);assert.ok(w.document.querySelector('.btn-header-login'));
 assert.equal(errors.length,0,errors.map(e=>e.message).join('\n'));console.log('PASS Full app boots, renders all seven views, contextual navigation, personal wallet, avatar menu routes, logout and safely displays member profile');
}finally{w.close();}
