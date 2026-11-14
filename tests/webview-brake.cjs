// Sustained controls in the installed Pleos APK (actual key/pointer events).
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function main(){
  const before=process.argv.includes('--before'),out=path.resolve(__dirname,'../android/app/build/brake-report');await fs.mkdir(out,{recursive:true});
  const target=(await fetch('http://127.0.0.1:9223/json').then(r=>r.json())).find(t=>t.url.includes('appassets.androidplatform.net'));assert(target,'Installed APK WebView unavailable');
  const ws=new WebSocket(target.webSocketDebuggerUrl),pending=new Map();let next=0;
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
  ws.onmessage=({data})=>{const m=JSON.parse(data);if(!m.id)return;const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);};
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
  const key=(type,extra={})=>send('Input.dispatchKeyEvent',{type,key:' ',code:'',windowsVirtualKeyCode:32,...extra});
  async function until(expression){for(let n=0;n<150;n++){if(await evaluate(expression))return;await wait(100);}throw Error('Timeout: '+expression);}
  const output={};
  try{
    await send('Page.enable');await send('Page.reload',{ignoreCache:true});await until('Boolean(window.__game)&&__game.getState().phase==="intro"');
    await evaluate(`(()=>{
      window.__brakeTest={events:[],rows:[],active:false};
      for(const type of ['keydown','keyup','pointerdown','pointerup','pointercancel','lostpointercapture','contextmenu','blur','focus']){
        (type==='blur'||type==='focus'?window:document).addEventListener(type,e=>__brakeTest.events.push({type,key:e.key,code:e.code,repeat:e.repeat,target:e.target?.id,at:performance.now()}),true);
      }
      function sample(){if(__brakeTest.active){const r=__game.getState();__brakeTest.rows.push({at:performance.now(),t:r.t,speed:r.speed,brake:r.input?.brake,throttle:r.input?.throttle,hud:!document.getElementById('braking').hidden,paused:r.paused,phase:r.phase});}requestAnimationFrame(sample)}requestAnimationFrame(sample);
    })()`);
    async function start(readable){
      await evaluate(`(()=>{
        clearInterval(window.__idleBrake);
        // Test SDK capability/idle values; native P/UX gating remains untouched.
        __game.pleos({type:'capabilities',steering:'READ',turnSignal:'READ',brake:'${readable?'READ':'NONE'}',accelerator:'NONE'});
        __game.pleos({type:'brakePedal',pressed:false});
        const r=__game.getState();if(r.phase==='intro')document.getElementById('start').click();else document.getElementById('retry').click();
        __brakeTest.events=[];__brakeTest.rows=[];__brakeTest.active=true;
        window.__idleBrake=setInterval(()=>__game.pleos({type:'brakePedal',pressed:false}),50);
      })()`);
      await until('__game.getState().phase==="play"&&Boolean(__game.getState().input)');
      await send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowUp',code:'ArrowUp',windowsVirtualKeyCode:38});
      await wait(2200);
      await send('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowUp',code:'ArrowUp',windowsVirtualKeyCode:38});
      await until('__game.getState().input?.throttle===0');
      assert(await evaluate('__game.getState().speed')>1,'Accelerate with Up before testing the brake');
      await evaluate('__brakeTest.events=[];__brakeTest.rows=[];');
    }
    async function record(name){
      output[name]=await evaluate('(__brakeTest.active=false,{events:__brakeTest.events,rows:__brakeTest.rows,state:__game.getState()})');
      await fs.writeFile(path.join(out,(before?'before-':'after-')+name+'.json'),JSON.stringify(output[name],null,2));
      const rows=output[name].rows;console.log(JSON.stringify({name,frames:rows.length,brakes:rows.map(r=>r.brake),events:output[name].events,speeds:rows.length?[rows[0].speed,rows.at(-1).speed]:[]}));
      if(!before){
        const start=name==='keyboard-after-focus-loss'?output[name].events.find(e=>e.type==='keydown'&&e.repeat)?.at+200:rows.find(r=>r.brake>=.5)?.at;
        const held=rows.filter(r=>r.at>=start);
        assert(held.length>5,name+' did not produce held input samples');
        assert(held.every(r=>r.brake>=.5&&r.hud&&r.throttle===0),name+' lost braking while held');
        assert.equal(output[name].state.speed,0,name+' did not reach a full stop');
      }
    }
    async function released(){
      await until('__game.getState().input?.brake===0');
      assert.equal(await evaluate("document.getElementById('braking').hidden"),true);
      await until('__game.getState().speed>.1');
    }
    await start(true);await key('keyDown');
    for(let n=0;n<35;n++){await wait(100);await key('keyDown',{autoRepeat:true});}
    if(!before)await until('__game.getState().speed===0');
    await record('keyboard-held');await key('keyUp');if(!before)await released();
    await start(true);await key('keyDown');await wait(200);
    await evaluate("window.dispatchEvent(new Event('blur'))");
    for(let n=0;n<15;n++){await wait(100);await key('keyDown',{autoRepeat:true});}
    if(!before)await until('__game.getState().speed===0');
    await record('keyboard-after-focus-loss');await key('keyUp');if(!before)await released();
    for(const readable of [false,true]){
      await start(readable);
      // Exercise a visible local button against an idle readable SDK too.
      if(before)await evaluate("document.querySelector('[data-action=brake]').hidden=false");
      else assert.equal(await evaluate("document.querySelector('[data-action=brake]').hidden"),false);
      const b=await evaluate("(()=>{const r=document.querySelector('[data-action=brake]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()");
      await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...b,id:1}]});await wait(3500);
      if(!before)await until('__game.getState().speed===0');
      await record(readable?'touch-readable':'touch-local');await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});if(!before)await released();
    }
    if(!before){
      await key('keyDown');await wait(200);await evaluate("__game.pleos({type:'parked',parked:false})");
      const frozen=await evaluate('__game.getState().t');await key('keyDown',{autoRepeat:true});await wait(300);
      assert.equal(await evaluate('__game.getState().paused'),true);assert.equal(await evaluate('__game.getState().t'),frozen);
      await evaluate("__game.pleos({type:'parked',parked:true})");await key('keyDown',{autoRepeat:true});await wait(200);
      assert.equal(await evaluate('__game.getState().t'),frozen);await key('keyUp');
      await evaluate("document.getElementById('gate-home').click()");
      await fs.writeFile(path.join(out,'summary.json'),JSON.stringify({keyboardHold:true,repeatAfterBlur:true,touchHold:true,idleReadSdkUpdates:true,releaseResumesCreep:true,parkingGate:true,method:'CDP keyboard/touch events in installed APK; injected blur event and SDK idle/parking test messages'},null,2));
      console.log('PASS: continuous Space/touch, repeat after focus handoff, full stop, release resumes creep, SDK idle arbitration and P gate.');
    }
  }finally{await key('keyUp').catch(()=>{});await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]}).catch(()=>{});await evaluate('clearInterval(window.__idleBrake);__brakeTest.active=false').catch(()=>{});ws.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
