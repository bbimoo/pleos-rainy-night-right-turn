// Fixed-resolution, full-app RAF timing on a debug WebView forwarded through adb.
// Usage: node tests/pleos-demo.cjs before|after off|on [seconds=30]
// Keyboard steering with readable SDK input: node tests/pleos-demo.cjs steering
// Real Android DPAD (no DevTools key injection): node tests/pleos-demo.cjs steering-adb
// adb forward tcp:9223 localabstract:webview_devtools_remote_<app pid>
const fs=require('node:fs/promises'),path=require('node:path');
const {execFile}=require('node:child_process');
async function main(){
  const [label='after',wipers='off',duration='30']=process.argv.slice(2);
  const tabs=await fetch('http://127.0.0.1:9223/json').then(r=>r.json());
  const target=tabs.find(t=>t.url.includes('appassets.androidplatform.net'));
  if(!target)throw Error('Pleos app WebView is not available');
  const ws=new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
  let next=0;
  const pending=new Map();
  ws.onmessage=({data})=>{
    const message=JSON.parse(data),request=pending.get(message.id);
    if(!request)return;
    pending.delete(message.id);clearTimeout(request.timer);
    if(message.error)request.reject(Error(JSON.stringify(message.error)));else request.resolve(message.result);
  };
  const send=(method,params={})=>new Promise((resolve,reject)=>{
    const id=++next,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout: '+method));},90000);
    pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));
  });
  const evaluate=async(expression,awaitPromise=false)=>{
    const result=await send('Runtime.evaluate',{expression,awaitPromise,returnByValue:true});
    if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  try{
    await send('Page.enable');
    // Pin only the renderer's adaptive-quality clock; RAF/physics/input clocks stay real.
    // This makes both APKs render at the same default high resolution.
    await send('Page.addScriptToEvaluateOnNewDocument',{source:String.raw`
      let sceneValue;
      Object.defineProperty(window,'Scene',{configurable:true,get(){return sceneValue;},set(value){
        const create=value.create;
        value.create=function(canvas){
          const scene=create(canvas),draw=scene.draw;
          let clock=1000;
          scene.draw=function(run,dt){
            const real=performance.now.bind(performance);
            clock+=1000/60;performance.now=()=>clock;
            try{return draw(run,dt);}finally{performance.now=real;}
          };
          return scene;
        };
        sceneValue=value;
      }});
    `});
    await send('Page.reload',{ignoreCache:true});
    for(let i=0;i<200;i++){
      if(await evaluate('Boolean(window.__game && window.Drive)'))break;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    if(label==='steering'||label==='steering-adb'){
      const useAdb=label==='steering-adb';
      await evaluate('('+String(function(){
        const create=Drive.create;
        Drive.create=()=>create(0,()=>.5);
        const receive=window.MCER.Pleos.receive;
        window.__lastSteeringAngle=0;
        const observed=message=>{
          const data=typeof message==='string'?JSON.parse(message):message;
          if(data?.type==='steeringAngle'&&Number.isFinite(data.deg))window.__lastSteeringAngle=data.deg;
          return receive(message);
        };
        __game.pleos=window.MCER.Pleos.receive=observed;
        window.__expectedSteering=()=>{
          const query=new URLSearchParams(location.search);
          const lock=Number(query.get('steerLock'))>0?Number(query.get('steerLock')):450;
          const sign=query.get('steerSign')==='-1'?-1:1,deg=window.__lastSteeringAngle;
          return Math.abs(deg)<=2?0:Math.sign(deg)*sign*Math.max(0,Math.min(1,(Math.abs(deg)-2)/(lock-2)));
        };
        window.__nativeEvents=[];window.__nativeSamples=[];window.__nativeDown=false;window.__nativeCapture=false;
        for(const type of ['keydown','keyup'])document.addEventListener(type,event=>{
          if(!['ArrowLeft','ArrowRight'].includes(event.key))return;
          window.__nativeDown=type==='keydown';
          window.__nativeEvents.push({type,key:event.key,code:event.code,trusted:event.isTrusted,
            phase:__game.getState().phase,sdk:__game.getState().pleos.capabilities.steering});
          if(type==='keyup')window.__nativeReleaseIndex=window.__nativeSamples.length;
        });
        function capture(){
          if(window.__nativeCapture)window.__nativeSamples.push({down:window.__nativeDown,state:__game.getState()});
          requestAnimationFrame(capture);
        }
        requestAnimationFrame(capture);
        window.__steeringFrames=count=>new Promise(resolve=>{
          function frame(){if(--count<=0)resolve();else requestAnimationFrame(frame);}
          requestAnimationFrame(frame);
        });
        window.__steeringStart=async function(deg){
          if(__game.getState().phase==='play'){
            __game.simulate(30,{steer:1,brake:0,throttle:0});
            await __steeringFrames(2);
          }
          const phase=__game.getState().phase;
          if(phase==='intro')document.getElementById('start').click();
          else{
            if(phase==='result')document.getElementById('show-report').click();
            document.getElementById('retry').click();
          }
          __game.pleos({type:'capabilities',turnSignal:'READ',steering:'READ',brake:'READ',accelerator:'NONE'});
          __game.pleos({type:'steeringAngle',deg});
          __game.pleos({type:'turnSignal',value:'OFF'});
          __game.pleos({type:'brakePedal',pressed:false});
          __game.simulate(5.85,{steer:1,brake:0,throttle:0});
          document.getElementById('scene').focus();
          await __steeringFrames(1);
          return __game.getState();
        };
        __game.pleos({type:'parked',parked:true,reason:'TEST_ONLY'});
        __game.pleos({type:'uxRestrictions',requiresDO:false,active:0});
      })+')()');
      const output=path.resolve(__dirname,'../android/app/build/demo-report');
      await fs.mkdir(output,{recursive:true});
      const results=[];
      for(const [code,direction,virtualKey] of [['ArrowLeft',-1,37],['ArrowRight',1,39]]){
        const before=await evaluate('__steeringStart('+(-direction*114)+')',true);
        let held,androidHeading=null;
        if(useAdb){
          await evaluate('__nativeEvents=[];__nativeSamples=[];__nativeReleaseIndex=0;__nativeCapture=true');
          const androidKey=direction<0?'KEYCODE_DPAD_LEFT':'KEYCODE_DPAD_RIGHT';
          await new Promise((resolve,reject)=>execFile(process.env.ADB_PATH||'adb',
            ['-s',process.env.ADB_SERIAL||'emulator-5554','shell','input','keyevent','--longpress',androidKey,androidKey],
            {timeout:15000},error=>error?reject(error):resolve()));
          held=await evaluate('(()=>{const samples=__nativeSamples.filter(row=>row.down).map(row=>row.state);return samples.reduce((best,row)=>!best||row.input.steer*'+direction+'>=best.input.steer*'+direction+'?row:best,null);})()');
          if(!held)throw Error('ADB produced no held-key gameplay samples');
          androidHeading=await evaluate('(()=>{const rows=__nativeSamples;for(let i=1;i<rows.length;i++){const r=rows[i],previous=rows[i-1].state;if(r.down&&r.state.input.steer*'+direction+'>.2&&(r.state.yaw-previous.yaw)*'+direction+'>.001)return {from:previous.yaw,to:r.state.yaw,input:r.state.input.steer,curve:r.state.curve};}return null;})()');
        }else{
          await send('Input.dispatchKeyEvent',{type:'keyDown',key:code,code,windowsVirtualKeyCode:virtualKey});
          await evaluate('__steeringFrames(12)',true);
          await evaluate("__game.pleos({type:'steeringAngle',deg:226});__steeringFrames(2)",true);
          held=await evaluate('__game.getState()');
        }
        // Android's fixed-duration longpress need not reach full lock; check
        // the observed steering sign and a real heading change while held.
        if((useAdb?held.input.steer*direction<.2:Math.abs(held.input.steer-direction)>.01)||held.wheel*direction<=0||
            (useAdb?!androidHeading:(held.yaw-before.yaw)*direction<=.03))throw Error(code+' did not change both wheel and heading: '+JSON.stringify({before,held}));
        const png=await evaluate("document.getElementById('scene').toDataURL('image/png')");
        await fs.writeFile(path.join(output,(useAdb?'steering-adb-':'steering-')+(direction<0?'left':'right')+'.png'),Buffer.from(png.split(',')[1],'base64'));
        await evaluate("__game.pleos({type:'brakePedal',pressed:true})");
        if(!useAdb)await send('Input.dispatchKeyEvent',{type:'keyUp',key:code,code,windowsVirtualKeyCode:virtualKey});
        await evaluate('__steeringFrames(24)',true);
        const released=await evaluate('__game.getState()');
        const sdk=await evaluate('({deg:__lastSteeringAngle,steer:__expectedSteering()})');
        if(Math.abs(released.input.steer-sdk.steer)>.001||released.pleos.capabilities.steering!=='READ')
          throw Error('Key release did not return to live Pleos steering: '+JSON.stringify(released));
        let native=null;
        if(useAdb){
          native=await evaluate('({events:__nativeEvents,releaseInputs:__nativeSamples.slice(__nativeReleaseIndex).map(row=>row.state.input.steer)})');
          await evaluate('__nativeCapture=false');
          native.headingChangeWhileHeld=androidHeading;
          for(const type of ['keydown','keyup']){
            if(!native.events.some(event=>event.type===type&&event.key===code&&event.code===''&&event.trusted&&event.phase==='play'&&event.sdk==='READ'))
              throw Error('Expected empty-code Android '+type+' during READ gameplay: '+JSON.stringify(native.events));
          }
          if(native.releaseInputs.length<2||Math.abs(native.releaseInputs[0]-sdk.steer)<.01)
            throw Error('No observable smooth handoff after Android keyup');
        }
        results.push({code,native,sdkCapability:held.pleos.capabilities.steering,
          before:{input:before.input.steer,wheel:before.wheel,yaw:before.yaw},
          held:{input:held.input.steer,wheel:held.wheel,yaw:held.yaw,x:held.x,z:held.z},
          released:{input:released.input.steer,sdk,wheel:released.wheel,yaw:released.yaw}});
      }
      await send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowLeft',code:'ArrowLeft',windowsVirtualKeyCode:37});
      await evaluate('__steeringFrames(8)',true);
      await evaluate("window.dispatchEvent(new Event('blur'))");
      await evaluate('__steeringFrames(2)',true);
      const blurred=await evaluate('__game.getState()');
      const expected=await evaluate('__expectedSteering()');
      if(Math.abs(blurred.input.steer-expected)>.001)throw Error('Blur did not clear keyboard override');
      await send('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowLeft',code:'ArrowLeft',windowsVirtualKeyCode:37});
      const result={arrows:results,blurRestoresSdk:true,windowsPhysicalKeyboardVerified:false,
        method:useAdb?'ADB Android DPAD longpress; trusted keydown/keyup with empty code during READ gameplay':'trusted CDP keyboard events in the installed Pleos WebView; READ steering signal remains active'};
      await fs.writeFile(path.join(output,useAdb?'steering-adb-input.json':'steering-input.json'),JSON.stringify(result,null,2));
      console.log(JSON.stringify(result,null,2));
      return;
    }
    const result=label==='controls'?await evaluate('('+String(async function(){
      const frames=count=>new Promise(resolve=>{function tick(){if(--count<=0)resolve();else requestAnimationFrame(tick);}requestAnimationFrame(tick);});
      const check=(condition,message)=>{if(!condition)throw Error(message);};
      __game.pleos({type:'parked',parked:true,reason:'TEST_ONLY'});
      __game.pleos({type:'uxRestrictions',requiresDO:false,active:0});
      document.getElementById('start').click();
      await frames(3);
      __game.pleos({type:'capabilities',turnSignal:'READ',steering:'READ',brake:'READ',accelerator:'NONE'});
      __game.pleos({type:'steeringAngle',deg:450});
      __game.pleos({type:'turnSignal',value:'RIGHT'});
      __game.pleos({type:'brakePedal',pressed:false});
      await frames(4);
      const steering=__game.getState();
      check(steering.input.steer===1&&steering.input.turnSignal==='RIGHT'&&steering.steer>.1,'Steering/indicator bridge input failed');
      const before=steering.speed;
      __game.pleos({type:'brakePedal',pressed:true});
      await frames(22);
      const braking=__game.getState();
      check(braking.input.brake===1&&braking.speed<before-1,'Brake press did not slow the car');
      __game.pleos({type:'brakePedal',pressed:false});
      await frames(22);
      const released=__game.getState();
      check(released.input.brake===0&&released.speed>braking.speed+.1,'Brake release did not resume cruise');
      const button=document.getElementById('touch-wipers');
      button.click();await frames(2);
      check(__game.getState().wipers===false&&button.getAttribute('aria-pressed')==='false','Wiper off button failed');
      button.click();await frames(2);
      check(__game.getState().wipers===true&&button.getAttribute('aria-pressed')==='true','Wiper on button failed');
      __game.simulate(30,{steer:1,brake:0,throttle:0});
      await frames(2);
      const outcome=__game.getState();
      check(outcome.result&&outcome.phase==='result'&&!document.getElementById('result').hidden,'Result screen did not open');
      document.getElementById('show-report').click();
      check(__game.getState().phase==='report'&&!document.getElementById('report').hidden,'Report screen did not open');
      const feedback=document.getElementById('feedback').textContent;
      document.getElementById('retry').click();
      check(__game.getState().phase==='play','Retry failed');
      __game.pleos({type:'parked',parked:false,reason:'TEST_ONLY'});
      const paused=__game.getState().t;
      await frames(3);
      check(__game.getState().paused&&__game.getState().t===paused,'Parking restriction did not pause play');
      __game.pleos({type:'parked',parked:true,reason:'TEST_ONLY'});
      return {bridgeSteeringAndIndicator:true,brakePressAndRelease:true,
        beforeSpeed:before,brakingSpeed:braking.speed,releasedSpeed:released.speed,
        wiperButtonOnOff:true,result:outcome.result,resultReportRetry:true,parkingGate:true,feedback};
    })+')()',true):await evaluate('('+String(async function(wipers,seconds){
      const create=Drive.create;
      Drive.create=()=>create(0,()=>.5);
      let currentWipers=true;
      const setup=()=>{
        __game.pleos({type:'capabilities',turnSignal:'NONE',steering:'NONE',brake:'NONE',accelerator:'NONE'});
        __game.pleos({type:'parked',parked:true,reason:'TEST_ONLY'});
        __game.pleos({type:'uxRestrictions',requiresDO:false,active:0});
        const phase=__game.getState().phase;
        if(phase==='intro')document.getElementById('start').click();
        else{
          if(phase==='result')document.getElementById('show-report').click();
          if(__game.getState().phase==='report')document.getElementById('retry').click();
        }
        __game.simulate(4.5,{steer:0,brake:0,throttle:0});
        __game.setTurnSignal('RIGHT');
        document.dispatchEvent(new KeyboardEvent('keydown',{code:'ArrowRight',key:'ArrowRight',bubbles:true}));
        if(currentWipers!==wipers){document.getElementById('touch-wipers').click();currentWipers=wipers;}
      };
      setup();
      const samples=[],states=[];
      let previous=null,runs=1,start=null,viewport=null;
      await new Promise((resolve,reject)=>{
        function frame(now){
          try{
          if(start===null)start=now;
          const elapsed=now-start,game=__game.getState();
          if(game.paused)throw Error('App became paused during the sample');
          if(Object.values(game.pleos.capabilities).some(value=>value!=='NONE'))__game.pleos({type:'capabilities',turnSignal:'NONE',steering:'NONE',brake:'NONE',accelerator:'NONE'});
          if(previous!==null&&previous-start>=2000)samples.push(now-previous);
          if(game.phase!=='play'){
            previous=null;setup();runs++;
          }else{
            previous=now;
            if(!viewport)viewport={innerWidth,innerHeight,canvasWidth:document.getElementById('scene').width,canvasHeight:document.getElementById('scene').height,quality:__game.stats().quality};
            const canvas=document.getElementById('scene');
            if(canvas.width!==viewport.canvasWidth||canvas.height!==viewport.canvasHeight)throw Error('Render resolution changed');
            if(states.length<runs)states.push({run:runs,t:game.t,steer:game.steer,wipers:game.wipers});
          }
          if(elapsed>=seconds*1000)resolve();else requestAnimationFrame(frame);
          }catch(error){reject(error);}
        }
        requestAnimationFrame(frame);
      });
      if(samples.length<10||states.some(state=>state.wipers!==wipers))throw Error('Insufficient or inconsistent driving sample');
      const sorted=samples.slice().sort((a,b)=>a-b),total=samples.reduce((a,b)=>a+b,0);
      return {seconds,wipers,viewport,runs,frames:samples.length,activeSeconds:total/1000,
        averageFps:1000*samples.length/total,p95FrameMs:sorted[Math.floor(sorted.length*.95)],
        maxFrameMs:Math.max(...samples),over50ms:samples.filter(n=>n>50).length,
        stallsOver1s:samples.filter(n=>n>=1000).length,states,intervalsMs:samples,
        final:(()=>{const r=__game.getState();return {phase:r.phase,t:r.t,s:r.s,yaw:r.yaw,steer:r.steer,brake:r.braking,wipers:r.wipers,capabilities:r.pleos.capabilities};})(),
        method:'real requestAnimationFrame intervals in full app; first 2 seconds and report/restart boundaries excluded; adaptive quality pinned; identical test keyboard/bridge inputs'};
    })+')('+JSON.stringify(wipers==='on')+','+Number(duration)+')',true);
    result.label=label;
    const output=path.resolve(__dirname,'../android/app/build/demo-report');
    await fs.mkdir(output,{recursive:true});
    await fs.writeFile(path.join(output,label+'-'+wipers+'.json'),JSON.stringify(result,null,2));
    const {intervalsMs,...summary}=result;console.log(JSON.stringify(summary,null,2));
  }finally{ws.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
