const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {spawn} = require('node:child_process');
const {pathToFileURL} = require('node:url');

// Inject diagnostics into the test copy only; the shipped renderer exposes no test hooks.
const inspectionSource=String.raw`    function testView(run){
      const ped=Drive.pedestrian(run),place=ped?walkerPlace(ped):null,mask=[];
      if(!place)return {ped,place:null,mask,visibleArea:0};
      const {p,x,y,height,width}=place,step=Math.sin(ped.step*10),sway=run.result?0:step*width*.024;
      const left=x-width/2+sway,top=y-height+Math.abs(step)*height*.009;
      let visibleArea=0;
      for(let column=Math.max(0,left),end=Math.min(w,left+width);column<end;column+=2){
        const stripe=Math.min(2,end-column);
        for(const [from,to] of visibleRows(column+stripe/2,p.z,top,top+height,parkedVehicle(run))){
          const a=Math.max(0,from),b=Math.min(h,to);
          if(b>a){mask.push([column,a,stripe,b-a]);visibleArea+=stripe*(b-a);}
        }
      }
      return {ped,place,mask,visibleArea,cue:cueLocation(run)};
    }
`;

async function main() {
  const root = path.resolve(__dirname, '..');
  const demo=process.argv.includes('--demo');
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'pleos-render-'));
  const chrome = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const browser = spawn(chrome, ['--headless=new', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=0', '--disable-background-timer-throttling', '--window-size=1280,800',
    '--user-data-dir=' + profile, 'about:blank'], {stdio:['ignore','ignore','pipe']});
  let socket;
  try {
    const endpoint = await new Promise((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(new Error('Chrome startup timed out')), 20000);
      browser.on('error', reject);
      browser.stderr.on('data', chunk => {
        output += chunk;
        const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
        if (match) { clearTimeout(timer); resolve(match[1]); }
      });
      browser.on('exit', code => reject(new Error('Chrome exited: ' + code)));
    });
    socket = new WebSocket(endpoint);
    await new Promise((resolve, reject) => {socket.onopen=resolve; socket.onerror=reject;});
    let id = 0;
    const pending = new Map();
    socket.onmessage = event => {
      const message = JSON.parse(event.data);
      if (!message.id) return;
      const request = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) request.reject(new Error(JSON.stringify(message.error)));
      else request.resolve(message.result);
    };
    const send = (method, params={}, sessionId) => new Promise((resolve,reject) => {
      const requestId=++id;
      pending.set(requestId,{resolve,reject});
      socket.send(JSON.stringify({id:requestId,method,params,sessionId}));
    });
    const {targetId}=await send('Target.createTarget',{url:'about:blank'});
    const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
    const page=(method,params)=>send(method,params,sessionId);
    await page('Page.enable');
    await page('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});
    await page('Page.addScriptToEvaluateOnNewDocument',{source:'window.requestAnimationFrame=()=>1;'});
    await page('Page.navigate',{url:pathToFileURL(path.join(root,'dist/index.html')).href+'?quality=high'});
    const evaluate=async expression=>{
      const value=await page('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
      if(value.exceptionDetails)throw new Error(JSON.stringify(value.exceptionDetails));
      return value.result.value;
    };
    for(let i=0;i<100;i++){
      if(await evaluate('Boolean(window.Scene && window.Drive)'))break;
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    // Removed wall photos remain a fixture for the historical renderer only.
    const walls='data:image/webp;base64,'+(await fs.readFile(path.join(root,'web/walls.webp'))).toString('base64');
    await evaluate('(()=>{const meta=document.createElement("meta");meta.name="walls-asset";meta.content='+JSON.stringify(walls)+';document.head.append(meta);})()');
    const run=async (source,label)=>{
      if(process.env.PROFILE_RENDERER){await page('Profiler.enable');await page('Profiler.start');}
      source=source.replace(/\r\n/g,'\n');
      source=source.replace('    return {\n      draw,cueLocation,',inspectionSource+'    return {\n      testView,draw,cueLocation,');
      source=source.replace('const blade=g=>lerp(g.park,g.raised,sweep);','const blade=g=>lerp(g.park,g.raised,sweep);window.__testWipers={enabled:wipers,sweep,pivots:wiperGeometry};');
      const result=await evaluate('('+String(async function(source,label,demo){
      const OriginalImage=window.Image, assets=[];
      window.Image=class extends OriginalImage {constructor(){super();assets.push(this);}};
      try{(0,eval)(source);}finally{window.Image=OriginalImage;}
      await Promise.all(assets.map(image=>image.decode()));
      const previousCanvas=document.getElementById('scene');
      const canvas=previousCanvas.cloneNode(false);
      previousCanvas.width=previousCanvas.height=1;
      previousCanvas.replaceWith(canvas);
      canvas.width=canvas.height=1; // Use an independent context, including its raster backend.
      const realNow=performance.now.bind(performance);
      let clock=1000;
      performance.now=()=>clock;
      const renderer=Scene.create(canvas);
      const samples=[],snapshots=[];
      const cases=[
        {name:'approach',steps:0,vehicle:0,signal:0,wipers:true},
        {name:'bend',steps:300,vehicle:0,signal:1,wipers:true},
        {name:'crossing',steps:430,vehicle:1,signal:0,wipers:true},
        {name:'left-glance',steps:180,vehicle:2,signal:-1,wipers:true},
        {name:'wet-glass',steps:230,vehicle:0,signal:0,wipers:false},
        {name:'right-glance',steps:280,vehicle:2,signal:1,wipers:true}
      ];
      try{
        // Waiting pedestrians must be concealed from departure for every parked vehicle and glance.
        for(const vehicle of [0,1,2])for(const signal of [-1,0,1]){
          renderer.reset();const initial=Drive.create(0,()=>.5);initial.vehicle=vehicle;initial.signal=signal;
          clock+=1000/60;renderer.draw(initial,0);
          const view=renderer.testView(initial);
          if(view.visibleArea!==0)throw Error('Pedestrian visible at departure: '+JSON.stringify({vehicle,signal,view}));
        }
        for(const test of cases){
          renderer.reset();
          const run=Drive.create(0,()=>.5);
          run.vehicle=test.vehicle;
          for(let i=0;i<test.steps&&!run.result;i++)Drive.step(run,1/60,{steer:run.s>Drive.track.turnStart?1:0,brake:0,throttle:0});
          run.result=null;run.signal=test.signal;run.wipers=test.wipers;
          for(let i=0;i<40;i++){
            clock+=1000/60;
            Drive.step(run,1/60,{steer:run.s>Drive.track.turnStart?1:0,brake:0,throttle:0});
            const start=realNow();
            renderer.draw(run,1/60);
            const cost=realNow()-start;
            if(i>=20)samples.push(cost);
          }
          const context=canvas.getContext('2d');
          const pixels=new Uint8ClampedArray(context.getImageData(0,0,canvas.width,canvas.height).data);
          snapshots.push({name:test.name,pixels,width:canvas.width,height:canvas.height,png:canvas.toDataURL('image/png')});
          const cue=renderer.cueLocation(run);
          if(cue&&!cue.every(Number.isFinite))throw Error('Invalid cue projection');
          if(renderer.stats().quality!=='high')throw Error('Benchmark quality changed');
        }
        let journey=null;
        if(demo){
          renderer.reset();
          const run=Drive.create(0,()=>.5),trace=[];
          Drive.signal(run,1);
          const hold=speed=>(speed-Drive.speeds.creep)/(Drive.speeds.top-Drive.speeds.creep);
          let hidden=false,revealed=false,crossed=false;
          for(let frame=0;frame<900&&!run.result;frame++){
            const ped=Drive.pedestrian(run);
            const stopping=ped&&!ped.cue&&ped.z<-Drive.track.exitLane+1.6&&run.x<Drive.crosswalk.from-2;
            const control=stopping?{throttle:0,brake:1}:{throttle:run.s>19?hold(3.15):hold(Drive.speeds.cruise),brake:run.s>19&&run.speed>3.4?.5:0};
            Drive.step(run,1/30,{steer:1,...control});
            run.wipers=frame<60||frame>=120;
            clock+=1000/60;renderer.draw(run,1/30);
            const view=renderer.testView(run);
            trace.push({camera:renderer.composition(),view,wipers:window.__testWipers,
              run:JSON.parse(JSON.stringify(run))});
            const invisible=view.ped&&view.visibleArea===0;
            const exposed=view.ped&&!view.ped.cue&&view.visibleArea>0;
            if((invisible&&!hidden)||(exposed&&!revealed)){
              const name=invisible?'pedestrian-hidden':'pedestrian-revealed';
              snapshots.push({name,width:canvas.width,height:canvas.height,
                pixels:new Uint8ClampedArray(canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data),
                png:canvas.toDataURL('image/png')});
              if(invisible)hidden=true;else revealed=true;
            }
            if(!crossed&&exposed&&view.visibleArea>view.place.width*view.place.height*.4){
              snapshots.push({name:'pedestrian-crossing',width:canvas.width,height:canvas.height,
                pixels:new Uint8ClampedArray(canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data),
                png:canvas.toDataURL('image/png')});
              crossed=true;
            }
          }
          if(!crossed)throw Error('Pedestrian never became clearly visible');
          if(renderer.stats().quality!=='high')throw Error('Journey resolution changed');
          window.__demoTraces=window.__demoTraces||{};
          window.__demoTraces[label]=trace;
          const first=predicate=>trace.find(row=>predicate(row));
          journey={frames:trace.length,result:run.result,
            firstHiddenAt:first(row=>row.view.ped&&row.view.visibleArea===0)?.run.t,
            firstExposedAt:first(row=>row.view.ped&&!row.view.ped.cue&&row.view.visibleArea>0)?.run.t,
            wiperOffParked:trace.some(row=>row.wipers.enabled===false&&row.wipers.sweep===0),
            wiperOnMoving:trace.some(row=>row.wipers.enabled&&row.wipers.sweep>.1)};
          if(!hidden||!revealed||run.result!=='safe'||!journey.wiperOffParked||!journey.wiperOnMoving)
            throw Error('Demo interaction regression: '+JSON.stringify(journey));
        }
        const sorted=samples.slice().sort((a,b)=>a-b);
        const result={label,journey,frames:samples.length,meanMs:samples.reduce((a,b)=>a+b)/samples.length,
          medianMs:sorted[Math.floor(sorted.length*.5)],p95Ms:sorted[Math.floor(sorted.length*.95)],
          width:canvas.width,height:canvas.height};
        window.__renderSnapshots=window.__renderSnapshots||{};
        window.__renderSnapshots[label]=snapshots;
        result.images=snapshots.map(({name,png})=>({name,png}));
        const probe=Drive.create(0,()=>.5);
        renderer.reset();
        canvas.style.width='800px';canvas.style.height='450px';
        window.dispatchEvent(new Event('resize'));
        clock+=1000/60;renderer.draw(probe,1/60);
        if(canvas.width!==800||canvas.height!==450)throw Error('Resize did not update render buffers');
        canvas.style.width='';canvas.style.height='';
        window.dispatchEvent(new Event('resize'));
        clock+=1000/60;renderer.draw(probe,1/60);
        if(canvas.width!==result.width||canvas.height!==result.height)throw Error('Resize did not restore render buffers');
        result.resizeAndReset=true;
        return result;
      }finally{performance.now=realNow;}
    })+')('+JSON.stringify(source)+','+JSON.stringify(label)+','+JSON.stringify(demo)+')');
      if(process.env.PROFILE_RENDERER){
        const {profile}=await page('Profiler.stop');
        result.cpuSamples=profile.nodes.filter(node=>node.hitCount).sort((a,b)=>b.hitCount-a.hitCount).slice(0,12)
          .map(node=>({function:node.callFrame.functionName||'(anonymous)',samples:node.hitCount}));
      }
      return result;
    };
    const output=path.join(root,'android/app/build/renderer-report');
    await fs.mkdir(output,{recursive:true});
    const sources=process.argv.slice(2).filter(value=>value!=='--demo');
    const reports=[];
    if(sources.length)reports.push(await run(await fs.readFile(path.resolve(sources[0]),'utf8'),'before'));
    reports.push(await run(await fs.readFile(path.join(root,'web/scene.js'),'utf8'),'after'));
    for(const report of reports){
      for(const {name,png} of report.images)await fs.writeFile(path.join(output,report.label+'-'+name+'.png'),Buffer.from(png.split(',')[1],'base64'));
      delete report.images;
    }
    let comparison=null,behavior=null;
    if(sources.length){
      comparison=await evaluate(String.raw`(()=>{
        const a=window.__renderSnapshots.before,b=window.__renderSnapshots.after;
        return a.map((old,index)=>{
          const fresh=b[index];
          if(old.width!==fresh.width||old.height!==fresh.height)throw Error('Resolution changed');
          let total=0,changed=0,maximum=0;
          for(let i=0;i<old.pixels.length;i+=4){
            let delta=0;
            for(let c=0;c<3;c++){const d=Math.abs(old.pixels[i+c]-fresh.pixels[i+c]);total+=d;maximum=Math.max(maximum,d);delta=Math.max(delta,d);}
            if(delta>8)changed++;
          }
          return {name:old.name,meanChannelError:total/(old.width*old.height*3),changedPercent:100*changed/(old.width*old.height),maxChannelError:maximum};
        });
      })()`);
      if(demo){
        behavior=await evaluate(String.raw`(()=>{
          const a=window.__demoTraces.before,b=window.__demoTraces.after;
          if(JSON.stringify(a)!==JSON.stringify(b))throw Error('Camera, pedestrian clipping, wiper timing or safety result changed');
          return {frames:a.length,cameraAndOcclusionIdentical:true,wiperTimingIdentical:true,physicsAndSafetyIdentical:true};
        })()`);
        console.log('Behavior comparison: '+JSON.stringify(behavior));
      }else for(const item of comparison)assert(item.changedPercent<.25&&item.meanChannelError<.2,'Visual regression in '+item.name+': '+JSON.stringify(item));
    }
    const result={reports,comparison,behavior,comparisonMode:demo?'effects intentionally changed; exact camera/occlusion/wiper/physics traces compared':'pixel regression'};
    await fs.writeFile(path.join(output,'results.json'),JSON.stringify(result,null,2));
    console.log(JSON.stringify(result,null,2));
    await send('Browser.close');
  } finally {
    socket?.close();
    browser.kill();
    await new Promise(resolve=>setTimeout(resolve,500));
    await fs.rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200}).catch(()=>{});
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
