// Installed Pleos WebView: real Android keyboard events, READ SDK stream.
// adb forward tcp:9223 localabstract:webview_devtools_remote_<app pid>
// node tests/keyboard-pleos.cjs
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {execFile}=require('node:child_process');
async function main(){
  const targets=await fetch('http://127.0.0.1:9223/json').then(r=>r.json());
  const target=targets.find(t=>t.url.includes('appassets.androidplatform.net'));
  assert(target,'Installed app WebView unavailable');
  const ws=new WebSocket(target.webSocketDebuggerUrl),pending=new Map();let id=0;
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
  ws.onmessage=({data})=>{
    const message=JSON.parse(data),request=pending.get(message.id);
    if(!request)return;
    pending.delete(message.id);clearTimeout(request.timer);
    message.error?request.reject(Error(JSON.stringify(message.error))):request.resolve(message.result);
  };
  const send=(method,params={})=>new Promise((resolve,reject)=>{
    const token=++id,timer=setTimeout(()=>{pending.delete(token);reject(Error(method+' timed out'));},30000);
    pending.set(token,{resolve,reject,timer});ws.send(JSON.stringify({id:token,method,params}));
  });
  const evaluate=async expression=>{
    const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
    if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  try{
    await send('Page.enable');await send('Page.reload',{ignoreCache:true});
    for(let n=0;n<100;n++){
      if(await evaluate('Boolean(window.__game && window.Drive)'))break;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    await evaluate('('+String(function(){
      const create=Drive.create;Drive.create=()=>create(0,()=>.5);
      const kb=window.__kb={events:[],rows:[],down:new Set(),capture:false};
      kb.frames=count=>new Promise(resolve=>{
        function frame(){if(--count<=0)resolve();else requestAnimationFrame(frame);}
        requestAnimationFrame(frame);
      });
      for(const type of ['keydown','keyup'])document.addEventListener(type,event=>{
        if(!['arrowup',' ','q','e','w'].includes(event.key.toLowerCase()))return;
        if(type==='keydown')kb.down.add(event.key);else kb.down.delete(event.key);
        const state=__game.getState();
        kb.events.push({type,key:event.key,code:event.code,repeat:event.repeat,trusted:event.isTrusted,
          phase:state.phase,capabilities:state.pleos.capabilities});
      });
      function frame(){
        if(kb.capture)kb.rows.push({down:[...kb.down],state:__game.getState()});
        requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
      // Exercise arbitration against a continuously readable SDK stream, including OFF.
      // These values are test inputs; native key events still travel through Android.
      kb.sdk=()=>{
        __game.pleos({type:'capabilities',steering:'READ',turnSignal:'READ',brake:'READ',accelerator:'READ'});
        __game.pleos({type:'steeringAngle',deg:0});
        __game.pleos({type:'turnSignal',value:'OFF'});
        __game.pleos({type:'brakePedal',pressed:false});
        __game.pleos({type:'acceleratorPedal',value:.2});
      };
      __game.pleos({type:'parked',parked:true,reason:'TEST_ONLY'});
      __game.pleos({type:'uxRestrictions',requiresDO:false,active:0});
      kb.sdk();kb.timer=setInterval(kb.sdk,50);
      kb.start=async()=>{
        if(__game.getState().phase==='checking')await new Promise(resolve=>setTimeout(resolve,900));
        if(__game.getState().paused&&__game.getState().gate===null)document.getElementById('resume').click();
        if(__game.getState().phase==='play'){
          __game.simulate(30,{steer:1,brake:0,throttle:0});await kb.frames(2);
        }
        if(__game.getState().phase==='intro')document.getElementById('start').click();
        else{
          if(__game.getState().phase==='result')document.getElementById('show-report').click();
          document.getElementById('retry').click();
        }
        document.getElementById('scene').focus();kb.sdk();await kb.frames(3);
        return __game.getState();
      };
    })+')()');
    const results=[];
    async function androidKey(key){
      await evaluate('__kb.events=[];__kb.rows=[];__kb.capture=true');
      await new Promise((resolve,reject)=>execFile(process.env.ADB_PATH||'adb',
        ['-s',process.env.ADB_SERIAL||'emulator-5554','shell','input','keyevent','--longpress',key,
          ...(key==='KEYCODE_DPAD_UP'?[key]:[])],
        {timeout:15000},error=>error?reject(error):resolve()));
      await evaluate('__kb.frames(3)');
      const data=await evaluate('(__kb.capture=false,{events:__kb.events,rows:__kb.rows,after:__game.getState()})');
      for(const type of ['keydown','keyup'])assert(data.events.some(e=>e.type===type&&e.trusted&&e.code===''&&e.phase==='play'&&
        Object.values(e.capabilities).every(v=>v==='READ')),key+' missing empty-code trusted '+type+' during READ play');
      return data;
    }
    await evaluate('__kb.start()');
    await evaluate('__game.simulate(.8,{brake:1,steer:0,throttle:0});__kb.frames(3)');
    let before=await evaluate('__game.getState()'),data=await androidKey('KEYCODE_DPAD_UP');
    let held=data.rows.filter(r=>r.down.includes('ArrowUp'));
    assert(held.some(r=>r.state.input.throttle>.3),'Up did not override SDK accelerator: '+JSON.stringify({events:data.events,rows:data.rows.map(r=>({down:r.down,input:r.state.input,speed:r.state.speed,t:r.state.t})),before}));
    assert(held.some(r=>r.state.speed>before.speed+.2),'Up did not increase vehicle speed');
    assert.equal(data.after.input.throttle,.2,'Up release did not restore SDK');
    results.push({control:'ArrowUp',beforeSpeed:before.speed,heldPeakThrottle:Math.max(...held.map(r=>r.state.input.throttle)),
      heldPeakSpeed:Math.max(...held.map(r=>r.state.speed)),released:data.after.input,events:data.events});

    before=await evaluate('__kb.start()');data=await androidKey('KEYCODE_SPACE');
    held=data.rows.filter(r=>r.down.includes(' '));
    assert(held.some(r=>r.state.input.brake>=.5&&r.state.input.throttle===0),'Space did not brake with accelerator suppressed');
    assert(held.some(r=>r.state.speed<before.speed-.3),'Space did not slow vehicle');
    assert.equal(data.after.input.brake,0,'Space release did not restore SDK brake');
    results.push({control:'Space',beforeSpeed:before.speed,heldMinSpeed:Math.min(...held.map(r=>r.state.speed)),
      heldPeakBrake:Math.max(...held.map(r=>r.state.input.brake)),released:data.after.input,events:data.events});

    await evaluate('__kb.start()');
    for(const [key,expected] of [['KEYCODE_Q','LEFT'],['KEYCODE_E','RIGHT'],['KEYCODE_E','OFF'],['KEYCODE_Q','LEFT'],['KEYCODE_Q','OFF']]){
      data=await androidKey(key);
      await evaluate('__kb.frames(5)');
      const state=await evaluate('__game.getState()');
      assert.equal(state.input.turnSignal,expected,key+' failed toggle/direction/persistence');
      assert.equal(state.signal,expected==='LEFT'?-1:expected==='RIGHT'?1:0,'Dashboard/drive signal differs');
      results.push({control:key,signal:state.input.turnSignal,driveSignal:state.signal,events:data.events});
    }
    await evaluate('__kb.start()');
    before=await evaluate('__game.getState()');
    for(const expected of [!before.wipers,before.wipers]){
      data=await androidKey('KEYCODE_W');
      assert.equal(data.after.wipers,expected,'W did not toggle once');
      assert.equal(data.after.input.wipers,expected);
      assert(data.rows.filter(r=>r.down.includes('w')).every(r=>r.state.wipers===expected),'W repeated while held');
      results.push({control:'W',wipers:expected,events:data.events});
    }
    // ADB keyevent does not keep two keys held independently. Check this combination
    // using CDP, and identify it separately in the report.
    await evaluate('__kb.start()');
    await send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowUp',code:'',windowsVirtualKeyCode:38});
    await send('Input.dispatchKeyEvent',{type:'keyDown',key:' ',code:'',windowsVirtualKeyCode:32});
    await evaluate('__kb.frames(8)');
    let state=await evaluate('__game.getState()');
    assert(state.input.brake>=.5&&state.input.throttle===0,'Combined pedals did not prioritize brake');
    await evaluate("window.dispatchEvent(new Event('blur'));__kb.frames(2)");
    state=await evaluate('__game.getState()');
    assert.equal(state.input.brake,0);assert.equal(state.input.throttle,.2);
    for(const [key,virtual] of [['ArrowUp',38],[' ',32]])
      await send('Input.dispatchKeyEvent',{type:'keyUp',key,code:'',windowsVirtualKeyCode:virtual});
    await evaluate('__game.simulate(30,{steer:1});__kb.frames(2)');
    assert.equal(await evaluate('__game.getState().phase'),'result');
    await evaluate("document.getElementById('show-report').click()");
    assert.equal(await evaluate('__game.getState().phase'),'report');
    await evaluate("document.getElementById('retry').click();__kb.frames(3)");
    state=await evaluate('__game.getState()');
    assert.equal(state.phase,'play');assert.equal(state.input.throttle,.2);assert.equal(state.input.brake,0);
    await evaluate("__game.pleos({type:'parked',parked:false});__kb.frames(3)");
    assert.equal(await evaluate('__game.getState().paused'),true);
    await evaluate("clearInterval(__kb.timer);__game.pleos({type:'parked',parked:true});");
    const result={method:'ADB Android keyevent --longpress in installed Pleos WebView; continuously injected READ SDK test stream',
      windowsPhysicalKeyboardVerified:false,keyboardEnabledAvd:'Pleos_Connect_v2.1.0_API34 (hw.keyboard=yes)',
      nativeAndroidControls:results,cdpOnly:{simultaneousPedalsBrakePriority:true,blurClearsPedals:true},
      menusResultReportRetry:true,parkingGate:true};
    const output=path.resolve(__dirname,'../android/app/build/demo-report/keyboard-controls-adb.json');
    await fs.mkdir(path.dirname(output),{recursive:true});await fs.writeFile(output,JSON.stringify(result,null,2));
    console.log(JSON.stringify(result,null,2));
  }finally{ws.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
