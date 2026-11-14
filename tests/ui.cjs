// Behavioral checks against the actual CSP-protected APK web bundle.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {spawn}=require('node:child_process'),{pathToFileURL}=require('node:url');
async function main(){
  const root=path.resolve(__dirname,'..'),out=path.join(root,'android/app/build/ui-report');
  await fs.mkdir(out,{recursive:true});
  const profile=await fs.mkdtemp(path.join(os.tmpdir(),'pleos-ui-'));
  const browser=spawn(process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',
    ['--headless=new','--no-first-run','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{stdio:['ignore','ignore','pipe'],windowsHide:true});
  let ws;
  try{
    const endpoint=await new Promise((resolve,reject)=>{
      let text='';const timer=setTimeout(()=>reject(Error('Chrome startup timeout')),20000);
      browser.on('error',reject);browser.stderr.on('data',b=>{text+=b;const m=text.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(m){clearTimeout(timer);resolve(m[1]);}});
    });
    ws=new WebSocket(endpoint);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
    let next=0;const pending=new Map(),errors=[];
    ws.onmessage=({data})=>{const m=JSON.parse(data);if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);if(!m.id)return;const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);};
    const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params,sessionId}));});
    const {targetId}=await send('Target.createTarget',{url:'about:blank'}),{sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
    const page=(method,params)=>send(method,params,sessionId);
    const evaluate=async expression=>{const r=await page('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
    await page('Page.enable');await page('Runtime.enable');
    await page('Emulation.setDeviceMetricsOverride',{width:1024,height:714,deviceScaleFactor:1,mobile:false});
    // Deterministic frame scheduling; the production Drive and input code run unchanged.
    await page('Page.addScriptToEvaluateOnNewDocument',{source:'window.requestAnimationFrame=f=>(window.__frame=f,1);window.cancelAnimationFrame=()=>{window.__frame=null};window.__clock=1000;'});
    await page('Page.navigate',{url:pathToFileURL(path.join(root,'dist/index.html')).href});
    for(let n=0;n<100;n++){if(await evaluate('Boolean(window.__game)'))break;await new Promise(r=>setTimeout(r,30));}
    const screenshot=async name=>{const shot=await page('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(out,name+'.png'),Buffer.from(shot.data,'base64'));};
    const tick=()=>evaluate('window.__frame?.(__clock+=16.667)');
    await tick();await screenshot('01-checking');
    await new Promise(r=>setTimeout(r,850));
    assert.equal(await evaluate('__game.getState().phase'),'intro');await screenshot('03-briefing');
    await evaluate("__game.pleos({type:'parked',parked:false,reason:'GEAR_DRIVE'})");
    assert.match(await evaluate("document.getElementById('current-gear').textContent"),/D/);await screenshot('04-start-blocked');
    await evaluate("document.getElementById('start').click();__game.simulate(5)");assert.equal(await evaluate('__game.getState().phase'),'intro');
    await evaluate("__game.pleos({type:'parked',parked:true});document.getElementById('start').click()");await tick();await screenshot('05-front');
    await evaluate("__game.setTurnSignal('RIGHT')");await tick();assert.equal(await evaluate('document.querySelector("main").dataset.view'),'right');await screenshot('06-right');
    await evaluate("__game.setTurnSignal('LEFT')");await tick();assert.equal(await evaluate('document.querySelector("main").dataset.view'),'left');await screenshot('07-left');
    await evaluate("__game.pleos({type:'parked',parked:false})");const stopped=await evaluate('__game.getState().t');
    await evaluate('__game.simulate(3)');assert.equal(await evaluate('__game.getState().t'),stopped);await screenshot('08-paused');
    await evaluate("__game.pleos({type:'parked',parked:true});__game.simulate(3)");assert.equal(await evaluate('__game.getState().t'),stopped);assert(await evaluate('__game.getState().paused'));
    await evaluate("document.getElementById('resume').click();__game.simulate(.2)");assert(await evaluate('__game.getState().t')>stopped);
    // Choose both outcomes deterministically without a production override.
    const startWithMist=async mist=>evaluate(`(()=>{
      const random=Math.random,create=Drive.create;Math.random=()=>${mist?0:.99};Drive.create=()=>create(0,()=>.5);
      try{document.getElementById('retry').click();}finally{Math.random=random;Drive.create=create;}
    })()`);
    await startWithMist(false);
    assert.equal(await evaluate('__game.getState().defrost.selected'),false);
    await evaluate("__game.simulate(15,{steer:1})");await tick();
    assert(!await evaluate('__game.getState().defrost.active'));
    assert(await evaluate('__game.getState().s')>await evaluate('Drive.track.turnStart'),'no turn-entry interlude on a clear round');
    await startWithMist(true);await tick();
    const mist=await evaluate('__game.getState()');
    assert.equal(mist.defrost.phase,'waiting');assert.equal(mist.defrost.selected,true);assert(mist.s<.01);
    await screenshot('16-condensation');
    // The cached windshield outline follows the same cabin shift during glances.
    for(const [signal,name] of [['LEFT','left'],['RIGHT','right'],['OFF','front-return']]){
      await evaluate("__game.setTurnSignal('"+signal+"')");
      for(let i=0;i<35;i++)await tick();
      const alignment=await evaluate(`(()=>{
        const m=new DOMMatrixReadOnly(getComputedStyle(document.getElementById('windshield-mist')).transform);
        return Math.abs(m.m41+__game.composition().view*document.getElementById('scene').getBoundingClientRect().width*.5);
      })()`);
      assert(alignment<.1,'mist must follow the cockpit during '+name);
      await screenshot('16-condensation-'+name);
    }
    const buttonBounds=await evaluate("(()=>{const b=document.getElementById('defrost-button').getBoundingClientRect(),s=document.getElementById('speed-cluster').getBoundingClientRect();return {right:b.right,speedLeft:s.left}})()");
    assert(buttonBounds.right<buttonBounds.speedLeft,'compact action must not cover the speed HUD');
    await evaluate('__game.simulate(3,{steer:1,throttle:1})');
    assert(await evaluate('__game.getState().t')>mist.t);
    assert(await evaluate('__game.getState().s')>mist.s,'driving continues under condensation');
    assert.equal(await evaluate('__game.getState().defrost.opacity'),.82,'driving cannot clear the mist');
    // Brakes and steering remain usable while the player chooses when to clear.
    await evaluate('__game.simulate(2,{brake:1})');assert.equal(await evaluate('__game.getState().speed'),0);
    await page('Input.dispatchKeyEvent',{type:'keyDown',key:'f',code:'KeyF',windowsVirtualKeyCode:70});
    await page('Input.dispatchKeyEvent',{type:'keyUp',key:'f',code:'KeyF',windowsVirtualKeyCode:70});
    assert.equal(await evaluate('__game.getState().defrost.source'),'mock-browser');
    await evaluate('__game.simulate(.5)');const fading=await evaluate('__game.getState()'),alpha=fading.defrost.opacity;assert(alpha>0&&alpha<.82);
    await evaluate("__game.pleos({type:'parked',parked:false});__game.simulate(5)");
    await evaluate("document.getElementById('defrost-button').click()");assert.equal(await evaluate('__game.getState().defrost.opacity'),alpha);
    await evaluate("__game.pleos({type:'parked',parked:true});__game.simulate(5)");
    assert.equal(await evaluate('__game.getState().t'),fading.t);assert(await evaluate('__game.getState().paused'));
    await evaluate("document.getElementById('resume').click();__game.simulate(1.7)");
    assert(await evaluate('__game.getState().t')>fading.t);
    assert.equal(await evaluate('__game.getState().defrost.phase'),'done');
    await screenshot('17-condensation-cleared');
    // A new fogged round starts at departure; touch runs the same command.
    await startWithMist(true);assert.equal(await evaluate('__game.getState().defrost.phase'),'waiting');
    await evaluate("document.getElementById('defrost-button').click();__game.simulate(1.7)");
    assert.equal(await evaluate('__game.getState().defrost.phase'),'done');
    await startWithMist(false);assert.equal(await evaluate('__game.getState().defrost.active'),false);
    // Full real Drive runs: steady approach fails; careful braking succeeds.
    async function play(careful){
      await evaluate(`(()=>{const create=Drive.create;Drive.create=()=>create(0,()=>.5);document.getElementById('retry').click();Drive.create=create;window.__brakeLatch=false;__game.setTurnSignal('RIGHT');})()`);
      await tick();
      for(let batch=0;batch<150;batch++){
        await evaluate(`(()=>{for(let n=0;n<30;n++){
          const r=__game.getState();if(r.defrost.phase==='waiting')document.getElementById('defrost-button').click();const p=Drive.pedestrian(r),cruise=(Drive.speeds.cruise-Drive.speeds.creep)/(Drive.speeds.top-Drive.speeds.creep),slow=(3.15-Drive.speeds.creep)/(Drive.speeds.top-Drive.speeds.creep);
          if(${careful}&&p&&!p.cue&&p.z<-Drive.track.exitLane+1.6&&r.x<Drive.crosswalk.from-2)window.__brakeLatch=true;
          if(window.__brakeLatch&&r.speed===0&&(!p||p.z>=-Drive.track.exitLane+1.6))window.__brakeLatch=false;
          const input=${careful}?window.__brakeLatch?{brake:1,throttle:0}:{throttle:r.s>19?slow:cruise,brake:r.s>19&&r.speed>3.4?.5:0}:{brake:0,throttle:cruise};
          __game.simulate(1/60,{steer:1,...input});
        }})()`);
        await tick();if(await evaluate('__game.getState().result'))break;
      }
      assert.equal(await evaluate('__game.getState().phase'),'result');
      assert.equal(await evaluate('__game.getState().result'),careful?'safe':'unsafe');
      await screenshot(careful?'09-success':'09-failure');
      assert(!await evaluate("document.querySelector('.metrics').textContent.includes('86')"));
      await evaluate("document.getElementById('show-report').click()");assert.equal(await evaluate('__game.getState().phase'),'report');
      const record=await evaluate('({state:__game.getState(),rows:[...document.querySelectorAll("#events li")].map(x=>x.textContent),entry:document.getElementById("entry-speed").textContent})');
      assert(record.state.samples.length>10);assert(record.rows.some(x=>x.includes('연습 종료')));
      assert.equal(record.entry,record.state.speedAtCross===undefined?'미진입':(record.state.speedAtCross*3.6).toFixed(1)+' km/h');
      if(careful)assert(record.state.stops.length>0);
      await fs.writeFile(path.join(out,careful?'success.json':'failure.json'),JSON.stringify(record,null,2));
      await screenshot(careful?'12-success-report':'10-failure-report');
    }
    await play(false);await play(true);
    assert(await evaluate("document.getElementById('report-home').disabled"));
    // Result captions where a metric does not apply: the large value stays a dash and the caption says why.
    async function scenario(attempt,control,name){
      await evaluate(`(()=>{const create=Drive.create;Drive.create=()=>create(${attempt},()=>.5);document.getElementById('retry').click();Drive.create=create;__game.setTurnSignal('RIGHT');})()`);
      await tick();
      for(let batch=0;batch<300&&!await evaluate('__game.getState().result');batch++)await evaluate(`(()=>{for(let n=0;n<30&&!__game.getState().result;n++){const r=__game.getState();if(r.defrost.phase==='waiting')document.getElementById('defrost-button').click();__game.simulate(1/60,(${control})(r));}})()`);
      await tick();assert.equal(await evaluate('__game.getState().phase'),'result');await screenshot(name);
      const shown=await evaluate("[...document.querySelectorAll('.metrics>div')].map(d=>d.querySelector('b').textContent+' / '+d.querySelector('small').textContent)");
      await evaluate("document.getElementById('show-report').click()");return {result:await evaluate('__game.getState().result'),shown};
    }
    const trap=await scenario(1,'r=>({steer:r.s>23?1:0,brake:0,throttle:0})','13-trap-slow');
    assert.equal(trap.result,'clear');assert.deepEqual(trap.shown.slice(1),['– / 보행자 없는 회차','– / 보행자 없음 · 서행 통과가 정답']);
    const lost=await scenario(0,'r=>({steer:0,brake:r.s>30&&!r.stops.length?1:0,throttle:0})','14-missed');
    assert.equal(lost.result,'missed');assert.equal(lost.shown[1],'– / 우회전 미완료로 측정 안 함');assert.equal(lost.shown[2],'– / 우회전 미완료로 측정 안 함');
    const early=await scenario(0,'r=>{const p=Drive.pedestrian(r);const hold=r.s>Drive.track.turnStart+.2&&p&&(p.cue||p.z<-Drive.track.exitLane+1.6);return {steer:r.s>23?1:0,brake:hold?1:0,throttle:0};}','15-early-brake');
    assert.equal(early.result,'safe');assert.equal(early.shown[1],'0.0초 / 미리 감속함');assert.match(early.shown[2],/^\d+\.\dm 앞 \/ 목표 정지선 앞$/);
    console.log('Captions:',JSON.stringify({trap,lost,early}));
    const assets=await evaluate('Promise.all([...document.querySelectorAll("img")].filter(i=>i.getAttribute("src")).map(async i=>{await i.decode();const r=i.getBoundingClientRect();return {src:i.src.slice(0,40),width:i.naturalWidth,height:i.naturalHeight,renderWidth:r.width,renderHeight:r.height};}))');
    assert(assets.every(a=>a.width>0&&a.height>0&&a.src.startsWith('data:')));
    for(const [width,height] of [[1700,1184],[850,592],[1280,800]]){
      await page('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
      await evaluate('window.dispatchEvent(new Event("resize"))');
      const rect=await evaluate('(()=>{const r=document.querySelector("main").getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()');
      assert(rect.x>=-.1&&rect.y>=-.1&&rect.x+rect.width<=width+.1&&rect.y+rect.height<=height+.1,JSON.stringify({width,height,rect}));
    }
    assert.equal(errors.length,0,JSON.stringify(errors));
    await page('Page.addScriptToEvaluateOnNewDocument',{source:'window.PleosHost={ready(){}};'});
    await page('Page.navigate',{url:pathToFileURL(path.join(root,'dist/index.html')).href+'?hooks=1'});await new Promise(r=>setTimeout(r,1100));
    assert.equal(await evaluate('__game.getState().gate'),'checking');
    await evaluate("document.getElementById('start').click();__game.simulate(2)");assert.equal(await evaluate('__game.getState().t'),0);
    await evaluate("__game.pleos({type:'parked',parked:false,reason:'gear-unknown'})");assert.equal(await evaluate('__game.getState().gate'),'restricted');
    await evaluate("__game.pleos({type:'parked',parked:true});__game.pleos({type:'uxRestrictions',requiresDO:true})");assert.equal(await evaluate('__game.getState().gate'),'restricted');
    await evaluate("__game.pleos({type:'uxRestrictions',requiresDO:false})");assert.equal(await evaluate('__game.getState().phase'),'intro');
    await fs.writeFile(path.join(out,'summary.json'),JSON.stringify({screens:11,realSuccessAndFailure:true,manualResume:true,unknownMetrics:true,assets,errors},null,2));
    console.log('PASS: 11 screens, actual success/failure reports, P gate, explicit resume, local assets, responsive bounds, no runtime exceptions.');
  }finally{ws?.close();browser.kill();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
