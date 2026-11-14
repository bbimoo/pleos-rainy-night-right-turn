const fs=require('fs'),vm=require('vm'),assert=require('assert');
const context={window:{}};vm.runInNewContext(fs.readFileSync(require('path').join(__dirname,'../web/drive.js'),'utf8'),context);const D=context.window.Drive;
const hold=speed=>(speed-D.speeds.creep)/(D.speeds.top-D.speeds.creep),cruising=hold(D.speeds.cruise),slowly=hold(3.15);
function simulate(steering,signal=0){const r=D.create(1,()=>.5);r.speed=D.speeds.cruise;r.signal=signal;for(let i=0;i<3000&&!r.result;i++)D.step(r,.016,{steer:steering(r),brake:0,throttle:cruising});return r;}
for(const signal of [0,1]){const r=simulate(()=>0,signal);assert.equal(r.result,'missed');assert.equal(r.yaw,0);assert.equal(r.x,5.05);assert(r.z>3);}
const brief=simulate(r=>r.s>24&&r.s<27?1:0);assert.equal(brief.result,'missed');assert(brief.yaw<.01);
const partial=simulate(r=>r.s<32?1:0);assert.equal(partial.result,'missed');assert(!partial.turnComplete);
const full=simulate(()=>1,1);assert(full.turnComplete);assert.equal(full.signal,0);assert.equal(full.result,'fast');assert(full.x>16);assert(Math.abs(full.z+D.track.exitLane)<.06);const done=full.events.find(e=>e.label==='우회전 조향 완료'),off=full.events.find(e=>e.label.includes('자동 해제'));assert(off.t-done.t>=.7&&off.t-done.t<.74);
const r=D.create(1);r.s=32;r.z=-7.55;r.steer=0;r.speed=0;r.coastSpeed=0;for(let i=0;i<100;i++)D.step(r,.016,{steer:1,brake:1});assert.equal(r.yaw,0);
console.log('PASS: no input, indicator only, brief input, partial turn, full turn, delayed cancellation, stationary steering.');
// Pedestrian checks at the crossing beyond the parked vehicle.
const line=D.crosswalk.from+1.15,exit=-D.track.exitLane;
function atCrossing(lead,crossed){const r=D.create(0);Object.assign(r,{s:D.track.crossing-lead,x:D.crosswalk.from+.27-lead,z:exit,yaw:Math.PI/2,turnComplete:true,turned:true,t:20,cueAt:0,stepAt:20-crossed,crossPace:1.9,speed:2,coastSpeed:2});return r;}
const hidden=D.create(0,()=>.5),waiting=D.pedestrian(hidden);
assert.equal(waiting.phase,'wait');assert.equal(waiting.x,hidden.walkerX);assert.equal(waiting.z,-6.95);
hidden.cueAt=0;hidden.t=4;assert.deepEqual(D.pedestrian(hidden),waiting,'wait at the crossing kerb instead of walking from the corner');
const delayed=D.create(0,()=>.5);Object.assign(delayed,{cueAt:0,t:4.5,s:D.track.crossing-3,speed:2,coastSpeed:2});
D.step(delayed,1/60,{steer:0,brake:1});assert.equal(delayed.stepAt,null,'do not step out before the concealed wait finishes');
delayed.t=4.6;D.step(delayed,1/60,{steer:0,brake:1});assert.notEqual(delayed.stepAt,null);assert.equal(D.pedestrian(delayed).phase,'cross');
const passed=atCrossing(2,4.2);assert(D.pedestrian(passed).z>exit+1.2);D.step(passed,.016,{steer:0,brake:0});assert.notEqual(passed.result,'unsafe');
const overlapping=atCrossing(2,2.3);assert(Math.abs(D.pedestrian(overlapping).z-exit)<.2);D.step(overlapping,.016,{steer:0,brake:0});assert.equal(overlapping.result,'unsafe');
const distant=atCrossing(9,2.3);D.step(distant,.016,{steer:0,brake:0});assert.notEqual(distant.result,'unsafe');
const stopped=atCrossing(2,2.3);stopped.speed=0;stopped.coastSpeed=0;D.step(stopped,.016,{steer:0,brake:1});assert.notEqual(stopped.result,'unsafe');
const onPavement=atCrossing(2,0);onPavement.stepAt=null;D.step(onPavement,.016,{steer:0,brake:0});assert.notEqual(onPavement.result,'unsafe');
console.log('PASS: waiting pedestrian, pedestrian past the lane, overlapping path, distant car, stationary car, pedestrian still on the pavement.');
// Steering and cornering smoothness: curvature eases in and out instead of snapping.
function trace(steering,speed){const r=D.create(1,()=>.5);r.empty=true;r.speed=speed;const rows=[];for(let i=0;i<6000&&!r.result;i++){D.step(r,.016,{steer:steering(r),brake:0,throttle:hold(speed)});rows.push({s:r.s,x:r.x,z:r.z,yaw:r.yaw,curve:r.curve,wheel:r.wheel});}return {r,rows};}
const held=trace(()=>1,3.15);let jump=0,peak=0;for(let i=1;i<held.rows.length;i++){jump=Math.max(jump,Math.abs(held.rows[i].curve-held.rows[i-1].curve));peak=Math.max(peak,held.rows[i].curve);}
assert(peak<=1/D.track.radius+1e-9);assert(jump<.012,'curvature must change gradually, got '+jump);
const settled=held.rows.at(-1);assert(Math.abs(settled.z+D.track.exitLane)<.05);assert(Math.abs(settled.yaw-Math.PI/2)<.01);assert(Math.abs(settled.wheel)<.35);
// The swept body stays clear of the parked vehicle and the kerb corner on the ideal line.
for(const {x,z,yaw} of held.rows)for(const f of [-2.2,0,2])for(const l of [-.92,.92]){const bx=x+Math.sin(yaw)*f+Math.cos(yaw)*l,bz=z+Math.cos(yaw)*f-Math.sin(yaw)*l;assert(bx>D.obstruction.front||Math.max(D.obstruction.rear-bx,bz-D.obstruction.edge)>.4,'too close to the parked vehicle');assert(Math.max(6.5-bx,bz+6.5)>.1,'cuts the kerb corner');}
// A late turn runs wide, then the lane-keeping correction brings it back without a jolt.
const late=trace(r=>r.s>D.track.turnStart+1.6?1:0,3.15);assert(late.r.turnComplete);const wide=Math.max(...late.rows.map(p=>p.z));assert(wide>-D.track.exitLane+.5);assert(Math.abs(late.rows.at(-1).z+D.track.exitLane)<wide+D.track.exitLane);
// The encounter is certain at any speed: driving on meets the pedestrian, braking for them clears it.
function drive(policy){const r=D.create(0);r.speed=D.speeds.cruise;for(let i=0;i<9000&&!r.result;i++){D.step(r,.016,{steer:1,...policy(r,D.pedestrian(r))});}return r;}
const steady=()=>({throttle:cruising,brake:0});
const slow=r=>({throttle:r.s>19?slowly:cruising,brake:r.s>19&&r.speed>3.4?.5:0});
assert.equal(drive(steady).result,'unsafe');
assert.equal(drive(slow).result,'unsafe');
const careful=drive((r,ped)=>ped&&!ped.cue&&ped.z<-D.track.exitLane+1.6&&r.x<D.crosswalk.from-2?{throttle:0,brake:1}:slow(r));
assert.equal(careful.result,'safe');assert(careful.events.some(e=>e.label==='횡단보도 앞에서 정지'));
const stepped=careful.events.find(e=>e.label.includes('앞으로 나옴'));assert(stepped&&stepped.t-careful.cueAt>4);
const idle=D.create(0);for(let i=0;i<4000&&idle.stepAt===null;i++)D.step(idle,.016,{steer:0,brake:idle.s>22?1:0,throttle:idle.s>22?0:cruising});assert(idle.stepAt!==null&&idle.speed===0);
// D-mode creep approaches 10 km/h; explicit throttle accelerates; braking wins.
const pedal=(throttle,brake,seconds)=>{const r=D.create(1,()=>.5);for(let i=0;i<seconds/.016;i++){r.s=0;r.z=-39.55;D.step(r,.016,{steer:0,brake,throttle});}return r;};
assert(Math.abs(pedal(0,0,15).speed-D.speeds.creep)<.02);assert(Math.abs(pedal(1,0,10).speed-D.speeds.top)<.1);assert(Math.abs(pedal(cruising,0,10).speed-D.speeds.cruise)<.1);assert.equal(pedal(1,1,4).speed,0);
const easing=D.create(1,()=>.5);easing.speed=D.speeds.cruise;let drop=0;for(let i=0;i<200;i++){const before=easing.speed;D.step(easing,.016,{steer:0,brake:0,throttle:0});drop=Math.max(drop,(before-easing.speed)/.016);}assert(drop<1,'lifting off must not feel like braking');
console.log('PASS: eased curvature, exit line, clearances, late-turn correction, forced encounter at cruising and slow speed, braking clears it, pedestrian does not wait for ever, accelerator pedal.');

// Isolate speed control from scenario completion by keeping the approach active.
for(const speed of [0,2,D.speeds.cruise,7]){
 const r=D.create(1);r.speed=speed;
 for(let i=0;i<1800;i++){
  r.s=0;r.z=-39.55;
  D.step(r,.016,{steer:0,brake:0,throttle:0});
 }
 assert(Math.abs(r.speed-D.speeds.creep)<.02,'no pedals must settle near 10 km/h from either side');
}
console.log('PASS: no pedals gently converges to 10 km/h from stationary, low and high speeds.');
{
 const r=D.create(1);r.speed=D.speeds.cruise;
 const step=(brake,throttle=0)=>{r.s=0;r.z=-39.55;D.step(r,.016,{steer:0,brake,throttle});};
 for(let i=0;i<700;i++)step(1,1);
 assert.equal(r.speed,0,'full brake must beat throttle and creep');
 for(let i=0;i<300;i++)step(1);
 assert.equal(r.speed,0,'held brake must keep the car stationary');
 for(let i=0;i<1000;i++)step(0);
 assert(Math.abs(r.speed-D.speeds.creep)<.02,'releasing the brake resumes creep without throttle');
 assert(r.stops.length>0,'full stop must remain in the session record');
}
console.log('PASS: brake overrides creep and throttle, holds zero, and release resumes creep.');

// Empty variant: a car's brake pedal reads only as on or off (brake 0 or 1),
// so a hard stop must be recognised from what a press did to the car.
function trap(policy){const r=D.create(1,()=>.5);r.speed=D.speeds.cruise;assert(r.empty);for(let i=0;i<9000&&!r.result;i++){const near=r.s>D.track.crossing-6&&r.s<D.track.crossing;D.step(r,.016,{steer:r.s>D.track.turnStart&&!r.turnComplete?1:0,throttle:cruising,brake:policy(r,near)});}return r;}
let stopAt=null;
const stopHard=trap((r,near)=>{if(near&&stopAt===null)stopAt=r.t;return stopAt!==null&&r.t-stopAt<1.2?1:0;});
assert.equal(stopHard.hardBrakes,1,'holding the pedal down near the empty crossing is a hard stop');assert(stopHard.hardBrake);
assert(stopHard.events.some(e=>e.label.startsWith('불필요한 급제동')));
let tapAt=null;
const taps=trap((r,near)=>{if(!near)return 0;if(tapAt===null)tapAt=r.t;return ((r.t-tapAt)%0.8)<0.15?1:0;});
assert.equal(taps.hardBrakes,0,'light taps while passing are not a hard stop');
const slowedEarly=trap(r=>r.s>D.track.turnStart-12&&r.s<D.track.turnStart&&r.speed>10/3.6?1:0);
assert.equal(slowedEarly.hardBrakes,0,'slowing down before the turn is the right way to pass');
let keyAt=null;
const keyStop=trap((r,near)=>{if(near&&keyAt===null)keyAt=r.t;if(keyAt===null)return 0;const e=r.t-keyAt;return e<1.2?Math.min(1,.5+e*1.15):0;});
assert.equal(keyStop.hardBrakes,1,'a held key or touch brake is judged the same way');
assert.equal(careful.hardBrakes,0,'stopping for a pedestrian who steps out is never a hard-brake penalty');
console.log('PASS: on/off pedal hard stop counted, light taps and early slowing allowed, key brake judged alike, real stop not penalised.');
// Result metrics: reaction time from the pedestrian stepping out, stop position against the stop line, safety score.
{
const pace=v=>(v-D.speeds.creep)/(D.speeds.top-D.speeds.creep);
function drive(attempt,kmh,delay,signal=true){const r=D.create(attempt,()=>.5);if(signal)D.signal(r,1);let latch=false,done=false;
  for(let i=0;i<9000&&!r.result;i++){const p=D.pedestrian(r);
    if(!done&&delay!==null&&r.stepAt!==null&&r.t-r.stepAt>=delay)latch=true;
    if(latch&&r.speed===0&&(!p||p.z>-D.track.exitLane+1.6)){latch=false;done=true;}
    D.step(r,1/60,{steer:r.s>23?1:0,brake:latch?1:0,throttle:latch?0:kmh>10?pace(kmh/3.6):0});}
  return {r,s:D.score(r)};}
const quick=drive(0,10,.5);assert.equal(quick.r.result,'safe');assert(Math.abs(quick.s.reaction-.5)<.05);assert(quick.s.reactionMet);
assert(quick.s.stopGap>0&&quick.s.stopMet);assert.equal(quick.s.value,100);
const slow=drive(0,10,1.5);assert.equal(slow.r.result,'safe');assert(!slow.s.reactionMet);assert(!slow.s.stopMet);assert.equal(slow.s.value,80); // Later step-out also carries this stop past the line.
const over=drive(0,20,.25);assert.equal(over.r.result,'safe');assert(over.s.stopGap<0&&over.s.stopGap>-1);assert(!over.s.stopMet);assert.equal(over.s.value,90);
const lateBrake=drive(0,20,.5);assert.equal(lateBrake.r.result,'unsafe');assert(lateBrake.s.reactionMet&&!lateBrake.s.pass,'a quick reaction alone cannot replace slowing before the concealed crossing');
const hit=drive(0,20,null);assert.equal(hit.r.result,'unsafe');assert.equal(hit.s.reaction,null);assert(hit.s.stopProjected);assert(hit.s.stopGap<-1);
assert(hit.s.value<hit.s.passMark);assert.equal(hit.s.value,20);
const unsignalled=drive(0,10,.5,false);assert.equal(unsignalled.s.value,95);
const prepared=drive(0,10,0);assert(prepared.s.reaction<.05);
const trapSlow=drive(1,10,null);assert.equal(trapSlow.r.result,'clear');assert.equal(trapSlow.s.reaction,null);assert.equal(trapSlow.s.stopGap,null);assert.equal(trapSlow.s.value,100);
const trapFast=drive(1,20,null);assert.equal(trapFast.r.result,'fast');assert(trapFast.s.value<trapFast.s.passMark);
// The score never contradicts the pass/fail verdict.
for(const {r,s} of [quick,slow,over,hit,unsignalled,trapSlow,trapFast])assert.equal(s.value>=s.passMark,['safe','clear'].includes(r.result));
const worstPass=D.create(0);Object.assign(worstPass,{result:'safe',stepAt:1,reaction:null,stopGap:-3,hardBrakes:1,turnSpeed:3,signalAtTurn:false});assert.equal(D.score(worstPass).value,70);
// Already braking when the pedestrian steps out counts as an early reaction; a quick press after does not.
const ready=D.create(0,()=>.5);D.signal(ready,1);for(let i=0;i<9000&&!ready.result;i++){const p=D.pedestrian(ready);const near=ready.s>D.track.turnStart+4;const hold=near&&p&&(p.cue||p.z<-D.track.exitLane+1.6);D.step(ready,1/60,{steer:ready.s>23?1:0,brake:hold?1:0,throttle:0});}
const readyScore=D.score(ready);assert.equal(ready.result,'safe');assert(readyScore.reactionEarly&&readyScore.reaction===0&&readyScore.reactionMet);assert(!quick.s.reactionEarly);
// A failed turn never reaches the stop line: no stop position and no stop deduction even after a full stop.
const lost=D.create(0,()=>.5);D.signal(lost,1);for(let i=0;i<9000&&!lost.result;i++){const b=lost.s>30&&!lost.stops.length;D.step(lost,1/60,{steer:0,brake:b?1:0,throttle:0});}
assert.equal(lost.result,'missed');assert(lost.stops.length>0);const lostScore=D.score(lost);assert.equal(lostScore.stopGap,null);assert(!lostScore.deductions.some(d=>d.label.includes('정지선')||d.label.includes('반응')));assert.equal(lostScore.reaction,null);
console.log('PASS: reaction time from step-out, stop gap before/past the line and projected on collision, score bands and pass/fail agreement.');
}
