// Layout regression in the installed APK, without emulating its viewport.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function measure(){
  const rect=e=>{if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom,clientWidth:e.clientWidth,clientHeight:e.clientHeight,scrollWidth:e.scrollWidth,scrollHeight:e.scrollHeight,scrollTop:e.scrollTop,scrollLeft:e.scrollLeft};};
  const chartImage=document.getElementById('record-chart-image');
  return {phase:__game.getState().phase,viewport:{innerWidth,innerHeight,clientWidth:document.documentElement.clientWidth,clientHeight:document.documentElement.clientHeight,dpr:devicePixelRatio,visual:visualViewport&&{width:visualViewport.width,height:visualViewport.height,scale:visualViewport.scale,offsetLeft:visualViewport.offsetLeft,offsetTop:visualViewport.offsetTop}},windowScroll:{x:scrollX,y:scrollY},document:rect(document.scrollingElement),body:rect(document.body),root:rect(document.querySelector('main')),report:rect(document.getElementById('report')),header:rect(document.querySelector('#report header')),title:rect(document.getElementById('report-title')),chart:rect(document.querySelector('.chart-card')),chartImage:rect(chartImage),chartImageReady:Boolean(chartImage?.complete&&chartImage.naturalWidth===940&&chartImage.naturalHeight===290),right:rect(document.querySelector('.report-right')),buttons:rect(document.querySelector('.report-right .actions')),timeline:rect(document.querySelector('.timeline')),events:rect(document.getElementById('events'))};
}
async function main(){
  const before=process.argv.includes('--before'),tag=before?'before':'after',out=path.resolve(__dirname,'../android/app/build/layout-report');await fs.mkdir(out,{recursive:true});
  const targets=await fetch('http://127.0.0.1:9223/json').then(r=>r.json());
  const target=targets.find(t=>t.url.includes('appassets.androidplatform.net'));assert(target,'Installed WebView missing');
  const ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
  let id=0;const pending=new Map();
  ws.onmessage=({data})=>{const m=JSON.parse(data);if(!m.id)return;const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);};
  const send=(method,params={})=>new Promise((resolve,reject)=>{const token=++id;pending.set(token,{resolve,reject});ws.send(JSON.stringify({id:token,method,params}));});
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
  const snapshot=()=>evaluate('('+measure.toString()+')()');
  const screenshot=async name=>{const shot=await send('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(out,name+'.png'),Buffer.from(shot.data,'base64'));};
  async function until(expression){for(let n=0;n<100;n++){if(await evaluate(expression))return;await wait(100);}throw Error('Timed out: '+expression);}
  const wheel=async(x,y,deltaY=700)=>{await send('Input.dispatchMouseEvent',{type:'mouseWheel',x,y,deltaX:0,deltaY});await wait(350);};
  const fixed=(a,b)=>{for(const key of ['x','y','width','height'])assert(Math.abs(a[key]-b[key])<1,'Moved '+key+': '+JSON.stringify({a,b}));};
  const fits=(r,v)=>assert(r.x>=-1&&r.y>=-1&&r.right<=v.visual.width+1&&r.bottom<=v.visual.height+1,'Outside visual viewport: '+JSON.stringify({r,v}));
  const results={};
  try{
    await send('Page.enable');await until('Boolean(window.__game)');
    if(process.argv.includes('--inspect')){
      const graph=await evaluate(`(()=>{const c=document.getElementById('record-chart'),p=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let pixels=0;for(let i=3;i<p.length;i+=4)if(p[i])pixels++;return {width:c.width,height:c.height,paintedPixels:pixels,rect:c.getBoundingClientRect().toJSON(),image:c.toDataURL()}})()`);
      await fs.writeFile(path.join(out,'graph-bitmap.png'),Buffer.from(graph.image.split(',')[1],'base64'));delete graph.image;console.log(JSON.stringify(graph));await screenshot('inspect-report');return;
    }
    if(!before){await send('Page.reload',{ignoreCache:true});await until('Boolean(window.__game)');}
    const initial=await evaluate('__game.getState()');assert.equal(initial.gate,null,'Vehicle safety gate must be open for UI verification');
    if(initial.phase!=='report'||['safe','clear'].includes(initial.result)){
      await until('__game.getState().phase!=="checking"');
      await evaluate(`(()=>{const r=__game.getState();if(r.paused)document.getElementById('resume').click();if(r.phase==='intro')document.getElementById('start').click();else document.getElementById('retry').click();__game.simulate(30,{steer:1,brake:0});})()`);
      await until('__game.getState().phase==="result"');await evaluate("document.getElementById('show-report').click()");
    }
    assert(!['safe','clear'].includes(await evaluate('__game.getState().result')),'Expected failure report');
    await wait(200);results.report=await snapshot();await screenshot(tag+'-failure-report');
    if(before){await wheel(50,80,-700);results.wheelUp=await snapshot();}
    await wheel(50,80);results.outsideWheel=await snapshot();
    if(!before){
      const v=results.report.viewport;
      for(const key of ['root','header','title','chart','chartImage','right','buttons'])fits(results.report[key],v);
      assert(results.report.chartImageReady,'Report graph did not load');
      assert.equal(v.innerWidth,v.clientWidth);assert.equal(v.innerHeight,v.clientHeight);
      assert.equal(results.report.document.scrollWidth,v.clientWidth);assert.equal(results.report.document.scrollHeight,v.clientHeight);
      fixed(results.report.root,results.outsideWheel.root);assert.deepEqual(results.outsideWheel.windowScroll,{x:0,y:0});assert.equal(results.outsideWheel.viewport.visual.offsetTop,0);assert.equal(results.outsideWheel.viewport.visual.offsetLeft,0);
      // Add long-list fixtures only to verify containment, then remove them.
      await evaluate(`(()=>{const list=document.getElementById('events');for(let i=0;i<60;i++){const row=list.firstElementChild.cloneNode(true);row.dataset.layoutFixture='1';list.append(row);}})()`);
      const long=await snapshot(),list=long.events;
      await wheel(list.x+list.width/2,list.y+Math.min(list.height/2,80));results.listWheel=await snapshot();
      assert(results.listWheel.events.scrollTop>0,'The event list did not scroll');
      fixed(long.root,results.listWheel.root);fixed(long.buttons,results.listWheel.buttons);assert.deepEqual(results.listWheel.windowScroll,{x:0,y:0});
      await evaluate("document.getElementById('events').scrollTop=1e7");await wheel(list.x+list.width/2,list.y+40);results.listBoundary=await snapshot();fixed(long.root,results.listBoundary.root);assert.deepEqual(results.listBoundary.windowScroll,{x:0,y:0});
      await evaluate("document.querySelectorAll('[data-layout-fixture]').forEach(e=>e.remove());document.getElementById('events').scrollTop=0");
      await screenshot('after-failure-report');
      for(const [name,action] of [['checking',"document.getElementById('report-home').click()"],['intro',null],['play',"document.getElementById('start').click()"]]){
        if(action)await evaluate(action);if(name==='intro')await until('__game.getState().phase==="intro"');
        const a=await snapshot();await wheel(30,35);const b=await snapshot();fixed(a.root,b.root);assert.deepEqual(b.windowScroll,{x:0,y:0});fits(b.root,b.viewport);results[name]=b;
      }
      await evaluate("__game.simulate(30,{steer:1,brake:0})");await until('__game.getState().phase==="result"');await evaluate("document.getElementById('show-report').click()");
    }
    await fs.writeFile(path.join(out,tag+'.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
  }finally{ws.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
