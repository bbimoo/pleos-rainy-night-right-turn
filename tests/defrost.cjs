const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
function fixture(browser=false){
 const timers=new Map();let serial=0,allowed=true;
 const window={},requests=[],cancels=[];
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../web/defrost.js'),'utf8'),{
   window,console,Date,Math,setTimeout(fn){timers.set(++serial,fn);return serial;},clearTimeout(id){timers.delete(id);}
 });
 const host=browser?undefined:{defrostFront:id=>requests.push(id),cancelDefroster:id=>cancels.push(id)};
 const d=window.Defrost.create({host,allowed:()=>allowed});
 const run={t:8,s:29,x:5,z:-10,speed:3,throttle:1,steer:0,brakeForce:0,signal:1,events:[]};
 const reply=(status,extra={})=>d.receive({type:'defroster',requestId:requests.at(-1),status,source:'sdk',...extra});
 return {d,run,requests,cancels,reply,timers,setAllowed:v=>allowed=v};
}
{
 const f=fixture();f.d.begin(f.run);assert.equal(f.run.speed,0);assert.equal(f.d.snapshot().phase,'waiting');
 f.d.request();f.d.request();assert.equal(f.requests.length,1,'deduplicate held/repeated requests');
 f.reply('confirming');f.d.tick(5);assert.equal(f.d.snapshot().opacity,.82,'set success is not an ON read');
 f.reply('on',{confirmed:false});assert.equal(f.d.snapshot().phase,'requesting');
 f.reply('on',{confirmed:true});f.d.tick(.8);assert(Math.abs(f.d.snapshot().opacity-.41)<1e-9);
 const fixed=[f.run.t,f.run.s,f.run.x,f.run.z];
 f.setAllowed(false);f.d.tick(5);assert.equal(f.d.snapshot().phase,'clearing');assert(Math.abs(f.d.snapshot().opacity-.41)<1e-9);
 f.setAllowed(true);f.d.tick(.8);assert.equal(f.d.snapshot().phase,'done');assert.deepEqual([f.run.t,f.run.s,f.run.x,f.run.z],fixed);
 f.d.begin(f.run);assert.equal(f.d.snapshot().phase,'done','once per run');
 f.d.reset();f.d.begin(f.run);assert.equal(f.d.snapshot().phase,'waiting');
}
for(const status of ['permission','unsupported','error','timeout']){
 const f=fixture();f.d.begin(f.run);f.d.request();const old=f.requests[0];
 f.reply(status,{message:'F로 다시 요청'});assert.equal(f.d.snapshot().phase,'error');f.d.tick(9);assert.equal(f.d.snapshot().opacity,.82);
 f.d.request();assert.notEqual(f.requests[1],old);
 f.d.receive({type:'defroster',requestId:old,status:'on',source:'sdk',confirmed:true});
 assert.equal(f.d.snapshot().phase,'requesting','ignore completion from failed attempt');f.d.reset();
}
{
 const f=fixture();f.d.begin(f.run);f.d.request();const old=f.requests[0];
 f.setAllowed(false);f.d.suspend();f.reply('on',{confirmed:true});f.d.request();
 assert.equal(f.requests.length,1);assert.equal(f.d.snapshot().phase,'error');assert.equal(f.cancels[0],old);
 f.setAllowed(true);f.d.tick(5);assert.equal(f.d.snapshot().phase,'error','P restoration alone must not complete an interrupted request');
 f.d.request();f.reply('on',{confirmed:true});f.d.tick(1.6);assert.equal(f.d.snapshot().phase,'done');
}
{
 const f=fixture();f.d.begin(f.run);f.d.request();for(const fn of [...f.timers.values()])fn();
 assert.equal(f.d.snapshot().phase,'error');assert.match(f.d.snapshot().detail,/초과/);f.d.reset();
}
{
 const f=fixture(true);f.d.begin(f.run);f.d.request();assert.equal(f.d.snapshot().source,'mock-browser');f.d.tick(1.6);assert.equal(f.d.snapshot().phase,'done');
}
console.log('PASS: defrost freezes position/time, confirmed ON only, duplicate requests, single trigger, fade pause, cancellation, stale replies, all failure/retry paths, explicit browser mock.');
