// Installed WebView integration. F goes through Android KeyEvent; no Virtual
// Console writes or SDK mocks. Safety injection below is labelled separately.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {execFile}=require('node:child_process'),{promisify}=require('node:util');
const exec=promisify(execFile),wait=ms=>new Promise(r=>setTimeout(r,ms));
async function main(){
 const serial=process.env.ANDROID_SERIAL||'emulator-5554';
 const tabs=await(await fetch('http://127.0.0.1:9223/json')).json(),tab=tabs.find(t=>t.url.includes('appassets.androidplatform.net'));
 assert(tab,'No installed game WebView');
 const ws=new WebSocket(tab.webSocketDebuggerUrl),pending=new Map();let next=0;
 await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
 ws.onmessage=({data})=>{const m=JSON.parse(data);if(!m.id)return;const p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);};
 const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++next,timer=setTimeout(()=>reject(Error('CDP timeout '+method)),15000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});
 const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
 const state=()=>evaluate('__game.getState()');
 const until=async(fn,ms=12000)=>{const end=Date.now()+ms;while(Date.now()<end){const r=await state();if(fn(r))return r;await wait(80);}throw Error('Condition timeout: '+JSON.stringify(await state()));};
 const consoleState=async()=>{try{return await(await fetch('http://127.0.0.1:8088/vehicle/state',{signal:AbortSignal.timeout(2000)})).json();}catch{return null;}};
 const prepare=async()=>{await evaluate("document.getElementById('retry').click();__game.simulate(20,{steer:1})");return until(r=>r.defrost.phase==='waiting');};
 const touch=async()=>{const p=await evaluate("(()=>{const r=document.getElementById('defrost-button').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()");
   await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...p,radiusX:1,radiusY:1,force:1}]});await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});};
 try{
   await send('Page.enable');await send('Page.reload',{ignoreCache:true});await wait(1500);
   const bootstrap=await state();assert.equal(bootstrap.gate,null,'Real native gear/UX must allow play');
   await evaluate("window.__defrostMessages=[];const receive=MCER.Defroster.receive;MCER.Defroster.receive=m=>{window.__defrostMessages.push(m);receive(m);}");
   const beforeConsole=await consoleState();
   const before=await prepare(),fixed=[before.t,before.s,before.x,before.z];
   await wait(500);const still=await state();assert.deepEqual([still.t,still.s,still.x,still.z],fixed);assert.equal(still.speed,0);
   await exec('adb',['-s',serial,'shell','input','keyevent','34']);
   const on=await until(r=>['clearing','error'].includes(r.defrost.phase));
   if(on.defrost.phase==='error'){
     const messages=await evaluate('window.__defrostMessages');
     const report={outcome:'SDK ON not confirmed; fail-closed',actualSdkSetRequested:messages.some(m=>m.source==='sdk'&&m.status==='setting'),
       actualSdkSetAcknowledged:messages.some(m=>m.source==='sdk'&&m.status==='confirming'),actualSdkOnVerified:false,
       nativeKeyboardF:true,before:fixed,after:[on.t,on.s,on.x,on.z],defrost:on.defrost,messages};
     assert.deepEqual(report.after,fixed);assert.equal(on.defrost.opacity,.82);
     const out=path.join(__dirname,'../android/app/build/defrost-report');
     await fs.mkdir(out,{recursive:true});await fs.writeFile(path.join(out,'sdk-unconfirmed.json'),JSON.stringify(report,null,2));
     console.log(JSON.stringify(report,null,2));
     if(!process.argv.includes('--allow-sdk-off'))throw Error('Native defroster error: '+on.defrost.detail);
     assert(report.actualSdkSetRequested&&report.actualSdkSetAcknowledged);
     // A real touch retries the SDK request. It must still never clear on ACK alone.
     const count=messages.length;await touch();
     const retry=await until(r=>['clearing','error'].includes(r.defrost.phase));
     assert.equal(retry.defrost.phase,'error');assert.deepEqual([retry.t,retry.s,retry.x,retry.z],fixed);
     const touchMessages=(await evaluate('window.__defrostMessages')).slice(count);
     assert(touchMessages.some(m=>m.status==='setting'));assert(touchMessages.some(m=>m.status==='timeout'));
     report.touchRetry={method:'real WebView touch',messages:touchMessages,remainsFrozen:true};
     await fs.writeFile(path.join(out,'sdk-unconfirmed.json'),JSON.stringify(report,null,2));
     console.log('PASS: actual SDK requests via F and touch; SDK remains OFF, ACK is not treated as ON, timeout/retry preserves position and time.');
     await send('Page.reload',{ignoreCache:true});return;
   }
   assert.deepEqual([on.t,on.s,on.x,on.z],fixed,'ON confirmation must not advance the scenario');
   const done=await until(r=>r.defrost.phase==='done');assert.equal(done.defrost.used,true);
   const evidence=await evaluate('window.__defrostMessages');
   assert(evidence.some(m=>m.status==='on'&&m.confirmed));
   const source=on.defrost.source;
   // Current ON is reused on a fresh run; touch must reach the same host request.
   const second=await prepare();const index=evidence.length;await touch();
   const secondDone=await until(r=>['done','error'].includes(r.defrost.phase));
   assert.equal(secondDone.defrost.phase,'done',secondDone.defrost.detail);
   const touchMessages=(await evaluate('window.__defrostMessages')).slice(index);
   if(source==='sdk')assert(!touchMessages.some(m=>m.status==='setting'),'already ON must not cause a second set request');
   // Web-only D/UX regression. It must stop before any host API request.
   // This never changes or bypasses the native parking gate.
   await prepare();const count=(await evaluate('window.__defrostMessages')).length;
   const blockedCases=[];
   for(const type of ['gear','ux']){
     await evaluate(type==='gear'?"__game.pleos({type:'parked',parked:false,reason:'GEAR_DRIVE'})":"__game.pleos({type:'uxRestrictions',requiresDO:true})");
     const frozen=await state();
     await exec('adb',['-s',serial,'shell','input','keyevent','34']);
     await evaluate("document.getElementById('defrost-button').click();__game.simulate(3)");
     const blocked=await state();assert.equal(blocked.t,frozen.t);assert.equal(blocked.defrost.phase,'waiting');
     assert.equal((await evaluate('window.__defrostMessages')).length,count);
     await evaluate(type==='gear'?"__game.pleos({type:'parked',parked:true})":"__game.pleos({type:'uxRestrictions',requiresDO:false})");
     assert((await state()).paused,'Restoring P/UX alone must not resume');
     await evaluate("document.getElementById('resume').click()");
     blockedCases.push({type,method:'injected WebView safety message; native gate unchanged',noRequest:true,manualResume:true});
   }
   const report={source,actualSdkVerified:source==='sdk',bootstrap:{parked:bootstrap.pleos.parked,reason:bootstrap.pleos.reason},
     keyboard:{method:'adb Android KEYCODE_F -> pre-IME -> shared web command',before:fixed,confirmedAt:[on.t,on.s,on.x,on.z],resumed:done.defrost.phase,messages:evidence},
     touch:{method:'WebView touchStart/touchEnd -> same command',noDuplicateSet:!touchMessages.some(m=>m.status==='setting'),messages:touchMessages},
     blockedCases,virtualConsole:{use:'read-only before/after',before:beforeConsole,after:await consoleState()}};
   const out=path.join(__dirname,'../android/app/build/defrost-report');
   await fs.mkdir(out,{recursive:true});await fs.writeFile(path.join(out,source+'.json'),JSON.stringify(report,null,2));
   console.log(JSON.stringify(report,null,2));
   // Leave a fresh real parked game for the user.
   await send('Page.reload',{ignoreCache:true});
 }finally{ws.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
