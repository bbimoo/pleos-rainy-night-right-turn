const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../web/input.js'),'utf8');
const close=(actual,expected,message)=>assert(Math.abs(actual-expected)<1e-10,message||actual+' != '+expected);
function fixture(search=''){
  let now=1000,active=true,hub,pad=null;
  const listeners=new Map();
  const document={
    querySelectorAll:()=>[],
    addEventListener(type,listener){if(!listeners.has(type))listeners.set(type,[]);listeners.get(type).push(listener);}
  };
  const context={window:{},document,location:{search},URLSearchParams,
    performance:{now:()=>now},navigator:{getGamepads:()=>pad?[pad]:[]},console};
  vm.runInNewContext(source,context);
  hub=context.window.GameInput.create({
    host:{ready(){}},enabled:()=>active&&!hub.pleos.blocked(),command(){},
    onChange(){if(hub?.pleos.blocked())hub.clear();}
  });
  const receive=message=>context.window.MCER.Pleos.receive(message);
  receive({type:'parked',parked:true});
  receive({type:'capabilities',steering:'READ',turnSignal:'NONE',brake:'NONE',accelerator:'NONE'});
  const key=(type,code,key,options={})=>{for(const listener of listeners.get(type)||[])listener({code,key,preventDefault(){},...options});};
  const sample=(ms=16)=>{now+=ms;return hub.sample();};
  const advance=(count=100)=>{let result;for(let i=0;i<count;i++)result=sample();return result;};
  return {hub,receive,key,sample,advance,setActive(value){active=value;},setPad(value){pad=value;}};
}
for(const mode of ['code','empty-code','unmapped-code'])for(const [arrow,direction] of [['ArrowLeft',-1],['ArrowRight',1]]){
  const code=mode==='code'?arrow:mode==='empty-code'?'':'Unidentified';
  const f=fixture(),vehicle=.5;
  f.receive({type:'steeringAngle',deg:226});
  close(f.sample().steer,vehicle);
  f.key('keydown',code,arrow);
  close(f.sample().steer,vehicle+Math.sign(direction-vehicle)*(.5*direction<0?5.2:2.6)*.016);
  f.receive({type:'steeringAngle',deg:114}); // SDK keeps updating during override.
  close(f.advance(60).steer,direction);
  f.key('keyup',code,arrow);
  let previous=direction;
  for(let i=0;i<80;i++){
    const current=f.sample().steer;
    assert(Math.abs(current-previous)<=3.4*.016+1e-10,'release must use the return interpolation');
    assert(Math.abs(current-.25)<=Math.abs(previous-.25)+1e-10,'return must approach the live SDK value');
    previous=current;
  }
  close(previous,.25);
  f.receive({type:'steeringAngle',deg:-450});
  close(f.sample().steer,-1,'idle SDK angle must be used immediately after handoff');
}
console.log('PASS: code, empty code + key, and unmapped code + key override READ steering and release smoothly to the live SDK angle.');
{
  const f=fixture();
  f.receive({type:'steeringAngle',deg:226});f.sample();
  f.key('keydown','KeyQ','ArrowRight');
  close(f.advance().steer,.5,'a mapped code must take precedence over a conflicting key');
  assert.equal(f.sample().turnSignal,'LEFT');
  f.key('keyup','KeyQ','ArrowRight');
  f.key('keydown','','ArrowUp');
  close(f.advance().throttle,1,'ArrowUp key fallback must accelerate');
  f.key('keyup','','ArrowUp');
  f.key('keydown','','ArrowLeft');close(f.advance().steer,-1);
  f.hub.clear();close(f.sample().steer,.5);
  f.setActive(false);f.key('keydown','','ArrowRight');close(f.advance().steer,.5);
  f.setActive(true);f.key('keydown','','ArrowRight');close(f.advance().steer,1);
  f.key('keyup','','ArrowRight');close(f.advance().steer,.5);
}
console.log('PASS: code precedence, ArrowUp fallback, clear and disabled-play handling.');
{
  const f=fixture();
  f.receive({type:'steeringAngle',deg:-226});f.sample();
  f.key('keydown','ArrowRight');f.advance(50);f.key('keyup','ArrowRight');
  f.sample();
  f.receive({type:'steeringAngle',deg:338});
  close(f.advance().steer,.75);
  f.key('keydown','ArrowLeft');f.key('keydown','ArrowRight');
  close(f.advance().steer,0,'both arrows still override the SDK at neutral');
  f.key('keyup','ArrowLeft');close(f.advance().steer,1);
  f.key('keyup','ArrowRight');close(f.advance().steer,.75);
}
console.log('PASS: changing SDK angles during return and simultaneous arrows.');
{
  const f=fixture('?steerLock=500&steerSign=-1');
  f.receive({type:'capabilities',steering:'READ_WRITE'});
  for(const [deg,expected] of [[0,0],[2,0],[-2,0],[251,-.5],[-500,1],[1000,-1]]){
    f.receive({type:'steeringAngle',deg});close(f.sample().steer,expected);
  }
  f.receive({type:'steeringAngle',deg:NaN});close(f.sample().steer,-1);
}
console.log('PASS: SDK READ_WRITE, range/sign calibration, dead zone and invalid-angle handling remain intact.');
{
  const f=fixture();
  f.receive({type:'steeringAngle',deg:226});f.sample();
  f.hub.press('left','pointer:1');
  f.setPad({axes:[-1],buttons:[]});
  close(f.advance().steer,.5,'touch/gamepad must not override readable SDK steering');
  f.receive({type:'capabilities',steering:'READ',turnSignal:'READ',brake:'READ',accelerator:'READ'});
  f.receive({type:'turnSignal',value:'LEFT'});
  f.receive({type:'brakePedal',pressed:false});
  f.receive({type:'acceleratorPedal',value:.3});
  for(const code of ['ArrowRight','KeyE','Space','ArrowUp'])f.key('keydown',code);
  let input=f.advance();
  close(input.steer,1);close(input.brake,1);close(input.throttle,0);assert.equal(input.turnSignal,'RIGHT');
  f.key('keyup','Space');close(f.sample().brake,0);close(f.sample().throttle,1);
  f.key('keyup','ArrowUp');close(f.sample().throttle,0);
  f.receive({type:'brakePedal',pressed:true});close(f.sample().brake,1);
  f.receive({type:'capabilities',steering:'NONE',turnSignal:'NONE',brake:'NONE',accelerator:'NONE'});
  f.setPad(null);f.hub.clear();f.sample();
  f.key('keydown','ArrowLeft');close(f.advance().steer,-1);
  f.key('keyup','ArrowLeft');close(f.advance().steer,0);
  f.hub.press('right','pointer:2');close(f.advance().steer,1);
  f.hub.release('right','pointer:2');close(f.advance().steer,0);
}
console.log('PASS: keyboard overrides READ pedals/indicators; existing non-SDK keyboard/touch steering.');
{
  const f=fixture();
  f.receive({type:'steeringAngle',deg:226});f.sample();
  f.key('keydown','ArrowLeft');close(f.advance().steer,-1);
  f.hub.clear(); // Existing app blur/hidden/blocked handlers call this same function.
  close(f.sample().steer,.5,'clear must discard override and all held-key state');
  f.key('keydown','ArrowLeft');close(f.advance().steer,-1);
  f.receive({type:'parked',parked:false});f.key('keydown','ArrowRight');
  close(f.advance().steer,.5);
  f.receive({type:'parked',parked:true});close(f.sample().steer,.5);
  f.setActive(false);f.key('keydown','ArrowLeft');close(f.advance().steer,.5);
  f.setActive(true);f.key('keydown','ArrowLeft');close(f.advance().steer,-1);
  f.hub.reset();close(f.sample().steer,.5);
}
console.log('PASS: clear/blur-equivalent, parking gate, disabled play and reset do not leave an override latched.');
for(const mode of ['code','empty-code','unmapped-code']){
  const f=fixture();
  f.receive({type:'capabilities',steering:'READ',turnSignal:'READ',brake:'READ',accelerator:'READ'});
  f.receive({type:'acceleratorPedal',value:.2});
  f.receive({type:'brakePedal',pressed:false});
  const emit=(type,code,key,options)=>f.key(type,mode==='code'?code:mode==='empty-code'?'':'Unidentified',key,options);
  const tap=(code,key)=>{emit('keydown',code,key);emit('keyup',code,key);};
  f.sample();
  emit('keydown','ArrowUp','ArrowUp');
  close(f.advance().throttle,1);
  f.receive({type:'acceleratorPedal',value:.4});
  close(f.sample().throttle,1,'SDK updates must not replace a held keyboard pedal');
  emit('keydown','Space',' ');
  let input=f.advance();
  close(input.brake,1);close(input.throttle,0,'braking must win over the held accelerator');
  emit('keyup','Space',' ');
  input=f.sample();close(input.brake,0);close(input.throttle,1);
  emit('keyup','ArrowUp','ArrowUp');
  close(f.sample().throttle,0,'release must stop throttle even when the SDK accelerator is pressed');
  f.receive({type:'brakePedal',pressed:true});
  emit('keydown','Space',' ');f.sample();
  emit('keyup','Space',' ');
  close(f.sample().brake,1,'release must restore the latest SDK brake, including pressed');
  f.receive({type:'brakePedal',pressed:false});
  close(f.sample().brake,0);

  emit('keydown','KeyQ','q');
  emit('keydown','KeyQ','q',{repeat:true});
  emit('keydown','KeyQ','q'); // Defend against duplicate down without repeat too.
  assert.equal(f.sample().turnSignal,'LEFT');
  emit('keyup','KeyQ','q');
  for(let i=0;i<20;i++){
    f.receive({type:'turnSignal',value:'OFF'});
    assert.equal(f.sample().turnSignal,'LEFT','SDK OFF must not cancel a latched keyboard signal');
  }
  tap('KeyE','E');assert.equal(f.sample().turnSignal,'RIGHT','opposite key changes direction');
  tap('KeyE','e');assert.equal(f.sample().turnSignal,'OFF','same key toggles off');
  tap('KeyQ','Q');assert.equal(f.sample().turnSignal,'LEFT');
  tap('KeyQ','q');assert.equal(f.sample().turnSignal,'OFF');
  tap('KeyE','e');f.hub.cancelRight();
  assert.equal(f.advance().turnSignal,'OFF','automatic cancellation must clear the keyboard signal');
  f.receive({type:'turnSignal',value:'RIGHT'});
  assert.equal(f.sample().turnSignal,'OFF','cancelled keyboard RIGHT must not relight from SDK');
  f.hub.reset();
  f.receive({type:'turnSignal',value:'LEFT'});
  assert.equal(f.sample().turnSignal,'LEFT','new drive must relinquish keyboard signal ownership');

  emit('keydown','KeyW','w');
  assert.equal(f.sample().wipers,false);
  emit('keydown','KeyW','w',{repeat:true});emit('keydown','KeyW','w');
  assert.equal(f.sample().wipers,false,'long press must toggle only once');
  emit('keyup','KeyW','w');
  tap('KeyW','W');assert.equal(f.sample().wipers,true);
  emit('keydown','ArrowUp','ArrowUp');emit('keydown','Space',' ');
  f.advance();f.hub.clear();
  input=f.sample();close(input.throttle,0);close(input.brake,0);
  emit('keydown','KeyW','w',{repeat:true});
  assert.equal(f.sample().wipers,true,'post-blur auto-repeat must not start a new toggle');
  f.receive({type:'uxRestrictions',requiresDO:true,active:1});
  tap('KeyE','e');tap('KeyW','w');tap('ArrowUp','ArrowUp');tap('Space',' ');
  input=f.sample();assert.equal(input.turnSignal,'LEFT');assert.equal(input.wipers,true);
  close(input.throttle,0);close(input.brake,0);
}
console.log('PASS: all controls with READ SDK and code/empty/unmapped code; pedal release, brake priority, latched indicators, repeat suppression, wipers and restrictions.');

// A WebView focus handoff clears local state. A physically held continuous
// key must recover on its next repeat; toggle controls must stay unchanged.
{
  const f=fixture();
  f.receive({type:'capabilities',steering:'READ',turnSignal:'READ',brake:'READ',accelerator:'READ'});
  f.receive({type:'brakePedal',pressed:false});
  f.key('keydown','',' ');close(f.advance().brake,1);
  f.hub.clear();close(f.sample().brake,0,'focus loss must clear held brake');
  f.key('keydown','',' ',{repeat:true});
  close(f.advance().brake,1,'a still-held Space must recover on repeat after focus returns');
  f.key('keyup','',' ');close(f.sample().brake,0,'Space release must end braking');
  f.hub.clear();f.receive({type:'parked',parked:false});
  f.key('keydown','',' ',{repeat:true});close(f.advance().brake,0,'repeat must not bypass the parking gate');
  f.receive({type:'parked',parked:true});
  f.key('keydown','','w',{repeat:true});assert.equal(f.sample().wipers,true,'repeat must not toggle a cleared action');
}
{
  const f=fixture();
  f.receive({type:'capabilities',steering:'READ',turnSignal:'READ',brake:'READ',accelerator:'READ'});
  f.receive({type:'acceleratorPedal',value:.7});
  f.hub.press('brake','pointer:7');
  for(let n=0;n<150;n++){
    f.receive({type:'brakePedal',pressed:false});const input=f.sample();
    assert(input.brake>=.5,'idle SDK updates must not replace held local brake');close(input.throttle,0);
  }
  close(f.sample().brake,1);f.hub.release('brake','pointer:7');close(f.sample().brake,0);
  f.receive({type:'brakePedal',pressed:true});f.key('keydown','',' ');
  close(f.sample().brake,1,'a partial local press must not weaken the vehicle brake');
  f.key('keyup','',' ');close(f.sample().brake,1,'vehicle braking must survive local release');
}
console.log('PASS: held Space recovers after focus return; parking/toggle guards remain; held touch brake survives SDK idle updates and suppresses acceleration.');
{
  const f=fixture();
  f.receive({type:'capabilities',accelerator:'READ'});
  f.receive({type:'acceleratorPedal',value:1});
  f.setPad({axes:[0],buttons:Array.from({length:8},(_,i)=>({value:i===7?1:0,pressed:i===7}))});
  f.hub.press('accelerate','pointer:1');
  close(f.advance().throttle,0,'SDK, gamepad and touch cannot accelerate');
  f.key('keydown','ArrowUp','ArrowUp');
  close(f.advance().throttle,1,'only held Up requests acceleration');
  f.key('keyup','ArrowUp','ArrowUp');
  close(f.sample().throttle,0,'release removes throttle immediately');
  f.hub.clear();close(f.sample().throttle,0);
}
console.log('PASS: acceleration is keyboard Up only; release and clear remove throttle.');

