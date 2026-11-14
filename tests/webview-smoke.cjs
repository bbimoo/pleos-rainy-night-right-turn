// Installed Android WebView checks. Injected messages are explicitly test data;
// the native gate is never bypassed or changed by this script.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function main(){
  const targets=await fetch('http://127.0.0.1:9223/json').then(r=>r.json());
  const target=targets.find(t=>t.url.includes('appassets.androidplatform.net'));assert(target,'No app WebView');
  const ws=new WebSocket(target.webSocketDebuggerUrl),pending=new Map();let next=0;
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
  ws.onmessage=({data})=>{const m=JSON.parse(data);if(!m.id)return;const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);};
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
  const key=(type,key,code,virtual)=>send('Input.dispatchKeyEvent',{type,key,code,windowsVirtualKeyCode:virtual});
  try{
    await send('Page.enable');await send('Page.reload',{ignoreCache:true});await wait(1500);
    const actual=await evaluate('__game.getState()');
    const consoleState=await fetch('http://127.0.0.1:8088/vehicle/state').then(r=>r.json());
    await evaluate(`(()=>{
      __game.pleos({type:'parked',parked:true,reason:'WEBVIEW_TEST_ONLY'});
      __game.pleos({type:'uxRestrictions',requiresDO:false});
      __game.pleos({type:'capabilities',steering:'READ',turnSignal:'READ',brake:'READ',accelerator:'READ'});
      __game.pleos({type:'steeringAngle',deg:0});__game.pleos({type:'brakePedal',pressed:false});
      __game.pleos({type:'turnSignal',value:'OFF'});__game.pleos({type:'acceleratorPedal',value:0});
      document.getElementById('start').click();
    })()`);
    await wait(200);assert.equal(await evaluate('__game.getState().phase'),'play');
    assert(await evaluate('__game.getState().speed')>0,'No pedals must creep');
    await key('keyDown','ArrowUp','',38);await wait(2200);
    await key('keyUp','ArrowUp','',38);await wait(150);
    const before=await evaluate('__game.getState().speed');assert(before>1);
    await key('keyDown',' ','',32);await wait(2000);
    const held=await evaluate('__game.getState()');assert(held.input?.brake>.98,'Sustained Space did not brake');assert(held.speed<before-1);
    await key('keyUp',' ','',32);await wait(700);
    const released=await evaluate('__game.getState()');
    assert.equal(released.input.brake,0);assert(released.speed>0,'Brake release must resume creep');
    const directions=[];
    for(const [letter,virtual,expected] of [['e',69,1],['q',81,-1]]){
      await key('keyDown',letter,'',virtual);await key('keyUp',letter,'',virtual);await wait(150);
      const r=await evaluate('__game.getState()');assert.equal(r.signal,expected);directions.push(r.signal);
    }
    await key('keyDown','ArrowRight','',39);await wait(600);const steering=await evaluate('__game.getState().input.steer');assert(steering>.2);
    await key('keyUp','ArrowRight','',39);
    for(let n=0;n<80;n++){await wait(100);if(Math.abs(await evaluate('__game.getState().input.steer'))<.05)break;}
    assert(Math.abs(await evaluate('__game.getState().input.steer'))<.05);
    await evaluate("__game.pleos({type:'parked',parked:false,reason:'GEAR_DRIVE'})");
    const frozen=await evaluate('__game.getState().t');await wait(400);assert.equal(await evaluate('__game.getState().t'),frozen);
    await evaluate("__game.pleos({type:'parked',parked:true})");await wait(400);assert.equal(await evaluate('__game.getState().t'),frozen);
    await evaluate("document.getElementById('resume').click()");
    for(let n=0;n<40;n++){await wait(100);if(await evaluate('__game.getState().t')>frozen)break;}
    assert(await evaluate('__game.getState().t')>frozen);
    const report={method:'CDP keyDown/keyUp with empty code in installed Pleos WebView; injected READ test stream',
      actualBootstrap:{phase:actual.phase,gate:actual.gate,pleos:actual.pleos},actualSdkVerified:false,
      virtualConsole:{bridgeReady:consoleState.gear?.bridge_ready,ddsReady:consoleState.controls?.dds_ready},
      space:{before,heldSpeed:held.speed,heldBrake:held.input.brake,releasedSpeed:released.speed},directions,steering,manualResume:true};
    const out=path.resolve(__dirname,'../android/app/build/ui-report/webview-smoke.json');await fs.mkdir(path.dirname(out),{recursive:true});await fs.writeFile(out,JSON.stringify(report,null,2));
    console.log(JSON.stringify(report,null,2));
  }finally{ws.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
