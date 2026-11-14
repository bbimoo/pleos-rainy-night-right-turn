// Run from android/: node tests/native-space.cjs
// Requires the debug APK open in Pleos and tcp:9223 forwarded to its WebView.
// Uses Android key injection, not CDP keyboard injection. READ values are test inputs.
const assert=require('node:assert/strict');
const {execFile}=require('node:child_process');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
  const target=(await fetch('http://127.0.0.1:9223/json').then(r=>r.json())).find(t=>t.url.includes('appassets'));
  assert(target,'Debug APK WebView unavailable');
  const ws=new WebSocket(target.webSocketDebuggerUrl),pending=new Map();let id=0;
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
  ws.onmessage=({data})=>{const m=JSON.parse(data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}};
  const send=(method,params={})=>new Promise((resolve,reject)=>{const key=++id,timer=setTimeout(()=>{pending.delete(key);reject(Error(method+' timeout'));},10000);pending.set(key,{resolve,reject,timer});ws.send(JSON.stringify({id:key,method,params}));});
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true});assert(!r.exceptionDetails,JSON.stringify(r.exceptionDetails));return r.result.value;};
  async function until(expression){for(let n=0;n<100;n++){if(await evaluate(expression))return;await wait(100);}throw Error('Timeout: '+expression);}
  const hold=async(code,ms)=>new Promise((resolve,reject)=>execFile('adb',['shell','input','keycombination','-t',String(ms),String(code),'59'],(error,out,err)=>error?reject(Error(out+err)):resolve()));
  async function accelerate(){
    await hold(19,3000);
    await until('__game.getState().input?.throttle===0');
    const speed=await evaluate('__game.getState().speed');
    assert(speed>.5,'Up must accelerate from rest');
    await wait(300);
    assert(await evaluate('__game.getState().speed')<=Math.max(speed,await evaluate('Drive.speeds.creep'))+.03,'Up release must approach the creep speed');
  }
  async function resumesCreep(){
    await until('__game.getState().speed>.1');
    assert(await evaluate('__game.getState().speed')<3,'Brake release must resume low-speed creep');
  }
  try{
    await send('Page.reload',{ignoreCache:true});await until('Boolean(window.__game)&&__game.getState().phase==="intro"');
    await evaluate(`(()=>{
      __game.pleos({type:'capabilities',steering:'READ',turnSignal:'READ',brake:'READ',accelerator:'NONE'});
      __game.pleos({type:'brakePedal',pressed:false});
      window.__nativeSpace=[];
      for(const type of ['keydown','keyup'])document.addEventListener(type,e=>{if(e.code==='Space')__nativeSpace.push({type,trusted:e.isTrusted});});
      document.getElementById('start').click();
    })()`);
    await wait(700);assert(await evaluate('__game.getState().speed')>0,'No pedals must start creeping without Up');
    await accelerate();
    // Shift provides the second key required by keycombination; Space is held
    // with no repeated DOWN calls, so the original edge must persist.
    const braking=hold(62,4000);
    await wait(3300);
    assert.equal(await evaluate('__game.getState().speed'),0,'Held Space must maintain a full stop');
    await braking;
    await until('__game.getState().input?.brake===0');
    const record=await evaluate('({events:__nativeSpace,state:__game.getState()})');
    assert.deepEqual(record.events,[{type:'keydown',trusted:false},{type:'keyup',trusted:false}],'Physical Space must use the pre-IME bridge exactly once per edge');
    assert(record.state.stops.length>0,'Held native Space did not reach a full stop');
    assert(record.state.speed<.5);
    await resumesCreep();
    console.log('PASS: creep without throttle, native Up acceleration, held Space maintains zero, release resumes creep.');
    await evaluate("document.getElementById('retry').click();__nativeSpace.length=0");
    await wait(300);
    await accelerate();
    // Replay the actual failure shape: repeated complete taps, not a held DOWN.
    // Each input command produces a zero-duration synthetic key pair.
    const pulseCommand='for n in '+Array.from({length:40},(_,i)=>i+1).join(' ')+'; do input keyevent 62; sleep 0.06; done';
    await new Promise((resolve,reject)=>execFile('adb',['shell',pulseCommand],(error,out,err)=>error?reject(Error(out+err)):resolve()));
    await until('__game.getState().input?.brake===0');
    const pulses=await evaluate('({events:__nativeSpace,state:__game.getState()})');
    assert(pulses.state.stops.length>0,'Emulator tap stream did not reach a full stop');
    assert(pulses.events.length<20,'Repeated tap edges were not merged');
    assert(pulses.events.every(e=>!e.trusted),'Tap normalization bypassed the native bridge');
    await resumesCreep();
    console.log('PASS: emulator down/up pulse stream maintains braking to zero and releases after the repeat stream ends.');
  }finally{ws.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
