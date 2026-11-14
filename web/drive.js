(() => {
  const lane = 5.05;
  // The right turn sweeps a wider, eased arc and settles on a line that passes
  // the parked vehicle on its left instead of driving into its tail.
  const exitLane = 2.5;
  const radius = 5;
  const entryLength = 1.1;
  const exitLength = 1.5;
  const exitFloor = .02;
  const unwindLength = .45;
  const quarter = Math.PI/2;
  const startZ = -39.55;
  const cruiseSpeed = 20/3.6;
  // The practice car simulates D: no pedals gently approaches creep speed.
  // Holding the brake prevents creep; Up requests speed above the creep pace.
  const topSpeed = 30/3.6;
  const creepSpeed = 10/3.6;
  const signalCancelDelay = .7;
  // In the empty variant a hard stop is penalised. A car's brake pedal reads
  // only as pressed or released, so a hard stop is judged by what one press
  // did to the car: started while still at speed close to the crossing, and
  // taking a lot of speed off before it was released. Slowing down before the
  // turn, or a few light taps, is the right way to pass and is not counted.
  const hardBrakeFrom = 12/3.6;
  const hardBrakeDrop = 8/3.6;
  const hardBrakeBefore = 8;
  const hardBrakeAfter = 3;
  // A delivery vehicle is stopped at the kerb just round the corner. The
  // crossing lies directly beyond its nose, so anyone stepping off the
  // pavement there is hidden from a driver passing alongside.
  const nose = 17.7;
  const parkedLengths = [8.1, 7, 4.3];
  const obstruction = {rear:nose-parkedLengths[0], front:nose, edge:-4.08, kerb:-6.5};
  const parked = vehicle => ({...obstruction, rear:nose-parkedLengths[vehicle]});
  const crosswalk = {from:nose+.95, to:nose+4.0};
  const crossEdge = crosswalk.from+.27;
  // Result metrics. The stop line is the white bar scene.js paints 0.62 m
  // before the crossing, .45 m wide; a car should stop with its nose short of
  // its near edge. The nose sits 2 m ahead of the car's reference point.
  const stopLine = crosswalk.from-.62-.45/2;
  const noseAhead = 2;
  // Wait at the crossing kerb behind the obstruction from the start.
  // Delay the step-out until the approaching driver has less warning.
  const cueDistance = 15.5;
  const revealDelay = 4.6; // Concealed wait after the approach cue (seconds).
  const kerbside = -6.95;
  const stepLead = 2.8;
  const patience = 4.5;
  const crossPace = 1.9;
  const farSide = 7.4;
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  // Curvature follows the steering command over a short distance instead of
  // snapping to it, and unwinds by itself as the heading approaches 90 degrees.
  function turn(state, travel, steer) {
    const remaining = quarter-state.yaw;
    let target = clamp(steer,-1,1)/radius;
    target = Math.min(target, remaining/exitLength+exitFloor);
    target = Math.max(target, -state.yaw/exitLength-exitFloor);
    const follow = Math.abs(target) < Math.abs(state.curve) ? unwindLength : entryLength;
    state.curve += (target-state.curve)*(1-Math.exp(-travel/follow));
    let nextYaw = clamp(state.yaw+state.curve*travel,0,quarter);
    if (quarter-nextYaw < .004 && state.curve > 0) nextYaw = quarter;
    advance(state, travel, nextYaw);
  }
  function advance(state, travel, nextYaw) {
    const delta = nextYaw-state.yaw;
    if (Math.abs(delta) > 1e-8) {
      const arcRadius = travel/delta;
      state.x += arcRadius*(Math.cos(state.yaw)-Math.cos(nextYaw));
      state.z += arcRadius*(Math.sin(nextYaw)-Math.sin(state.yaw));
    } else {
      state.x += Math.sin(state.yaw)*travel;
      state.z += Math.cos(state.yaw)*travel;
    }
    state.yaw = nextYaw;
  }
  // Trace the turn made with the wheel held over, then place the start of the
  // junction so that this ideal line ends exactly on the exit line.
  const ideal = (() => {
    const state = {x:0,z:0,yaw:0,curve:0};
    let length = 0;
    while (state.yaw < quarter && length < 40) {
      turn(state,.004,1);
      length += .004;
    }
    return {dx:state.x, dz:state.z, length};
  })();
  const turnZ = -exitLane-ideal.dz;
  const turnStart = turnZ-startZ;
  const turnEnd = turnStart+ideal.length;
  const exitX = lane+ideal.dx;
  const crossing = turnEnd+crossEdge-exitX;
  function pose(run) {
    return {x:run.x,z:run.z,yaw:run.yaw};
  }
  function create(attempt, random = Math.random) {
    const empty = attempt > 0 && attempt % 2 === 1;
    return {
      t:0, s:0, x:lane, z:startZ, yaw:0, curve:0, wheel:0, turnComplete:false, speed:0, throttle:0, steer:0, lean:0, signal:0, signalCancelAt:null, turned:false,
      empty, rain:attempt ? .7+random()*.55 : 1, vehicle:attempt ? Math.floor(random()*3) : 0,
      walkerX:crosswalk.from+(attempt ? .75+random()*.9 : 1.15),
      pace:attempt ? 2.25+random()*.25 : 2.4,
      events:[], samples:[], stops:[], cueAt:null, stepAt:null, entered:false, braking:false, brakeForce:0, waited:false, hardBrake:false,
      hardBrakes:0, pressSpeed:0, pressCounted:false,
      reaction:null, reactedEarly:false, stopGap:null, stopProjected:false, signalAtTurn:false
    };
  }
  function note(run, label) {
    const last=run.events.at(-1);
    if(last && last.label===label && run.t-last.t<.3)return;
    run.events.push({t:run.t,label,speed:run.speed*3.6,steer:run.steer,brake:run.brakeForce,signal:run.signal,x:run.x,z:run.z});
  }
  function signal(run, direction) {
    run.signalCancelAt=null;
    run.signal = run.signal === direction ? 0 : direction;
    note(run, run.signal ? (direction > 0 ? '우측 방향지시등 켬' : '좌측 방향지시등 켬') : '방향지시등 끔');
  }
  function step(run, dt, input) {
    if (run.result) return;
    run.t += dt;
    const oldSpeed = run.speed;
    const steer = clamp(input.steer, -1, 1);
    const brake = clamp(input.brake, 0, 1);
    run.brakeForce += (brake-run.brakeForce)*Math.min(1,dt*(brake>run.brakeForce?4.8:11));
    run.steer += (steer-run.steer)*Math.min(1,dt*8);
    run.lean = clamp((run.lean+run.steer*dt*.8)*(1-dt*1.2),-.46,.46);
    if (run.s > 23 && run.s < turnEnd+2 && run.steer > .25 && !run.turned) {
      run.turned = true;
      note(run,'우측 조향 시작');
    }
    if (brake > .06 && !run.braking) {
      if (run.stepAt !== null && run.reaction === null) run.reaction = run.t-run.stepAt;
      run.braking = true;
      run.pressSpeed = oldSpeed;
      run.pressCounted = false;
      note(run,'브레이크 밟음 · '+Math.round(oldSpeed*3.6)+' km/h');
    } else if (brake <= .06 && run.braking) {
      run.braking = false;
      note(run,'브레이크 해제 · '+Math.round(oldSpeed*3.6)+' km/h');
    }
    run.throttle += (clamp(input.throttle??0,0,1)-run.throttle)*Math.min(1,dt*7);
    const accelerating = (input.throttle??0)>0 && brake<=.06;
    const pull = accelerating ? creepSpeed+(topSpeed-creepSpeed)*run.throttle : creepSpeed;
    // Brake pressure takes priority over both creep and the accelerator.
    // No engine pull is applied while braking, so a full press holds zero.
    const target = run.speed*(1-run.brakeForce);
    let acceleration;
    if (run.brakeForce > .03) acceleration = clamp((target-run.speed)*4,-5.2,0);
    else if (pull > run.speed) acceleration = Math.min((pull-run.speed)*1.6,accelerating?.55+1.9*run.throttle:.55);
    else acceleration = Math.max((pull-run.speed)*.9,-.95);
    run.speed = clamp(run.speed + acceleration*dt,0,topSpeed);
    if (brake >= .98 && run.speed < .12) run.speed = 0;
    if (run.empty && run.braking && !run.pressCounted && run.pressSpeed >= hardBrakeFrom &&
        run.s > crossing-hardBrakeBefore && run.s < crossing+hardBrakeAfter &&
        run.pressSpeed-run.speed >= hardBrakeDrop) {
      run.pressCounted = true;
      run.hardBrakes++;
      run.hardBrake = true;
      note(run,'불필요한 급제동 · '+Math.round(run.pressSpeed*3.6)+' → '+Math.round(run.speed*3.6)+' km/h');
    }
    const prior = run.s;
    run.s += run.speed*dt;
    // Before the junction the approach stays in its lane. Inside the junction,
    // distance alone never rotates the car: only current steering adds yaw.
    const approachDistance=Math.max(0,Math.min(run.s,turnStart)-Math.min(prior,turnStart));
    run.z+=approachDistance;
    const travel=run.s-prior-approachDistance;
    const wasComplete=run.turnComplete;
    if(travel>0){
      if(!wasComplete)turn(run,travel,run.steer);
      else{
        // After the turn a gentle lane-keeping correction eases the car onto
        // the exit line, so a slightly late or wide turn still settles cleanly.
        const drift=clamp(-.25*(-exitLane-run.z),-.16,.16);
        const command=drift-(run.yaw-quarter);
        run.curve+=(command-run.curve)*(1-Math.exp(-travel/unwindLength));
        advance(run,travel,run.yaw+run.curve*travel);
      }
    }
    // The on-screen wheel shows a little of the driver's input at once and the
    // rest as the car actually turns, then unwinds with the car.
    const shown=.3*run.steer+.7*clamp(run.curve*radius,-1,1);
    run.wheel+=(shown-run.wheel)*Math.min(1,dt*9);
    const completedNow=!wasComplete&&run.yaw>=quarter-1e-6;
    if(completedNow){run.turnComplete=true;note(run,'우회전 조향 완료');}
    if (run.s >= cueDistance && run.cueAt === null) {
      run.cueAt = run.t;
      run.cueSpeed = run.speed;
      run.cueBraking = run.braking;
      if (!run.empty) note(run,'가려진 횡단보도 대기 지점에 접근');
    }
    if(completedNow&&run.signal===1){
      run.signalCancelAt=run.t+signalCancelDelay;
    }
    if(run.signalCancelAt!==null&&run.t>=run.signalCancelAt){
      run.signalCancelAt=null;
      run.signal=0;
      note(run,'우회전 후 우측 방향지시등 자동 해제');
    }
    // Once the pedestrian has reached the kerb they step out when the car is
    // a few seconds from the crossing, or after waiting a while regardless.
    if (!run.empty && run.cueAt !== null && run.stepAt === null) {
      const waiting = run.t-run.cueAt-revealDelay;
      const arrival = Math.max(0,turnEnd+run.walkerX-exitX-run.s)/Math.max(run.speed,.8);
      if (waiting >= 0 && (arrival <= stepLead || waiting >= patience)) {
        run.stepAt = run.t;
        // Reaction time runs from this moment. A driver already braking or
        // already stopped has nothing left to react to.
        if (run.braking || run.speed < .4) {
          run.reaction = 0;
          run.reactedEarly = true;
        }
        // Someone who never had to wait keeps their hurried pace across.
        run.crossPace = waiting < .3 ? run.pace : crossPace;
        note(run,'보행자가 정차 차량 앞으로 나옴');
      }
    }
    const crossingNow = run.stepAt !== null && kerbside+(run.t-run.stepAt)*run.crossPace < 0;
    if (oldSpeed > 0 && run.speed === 0) {
      run.stops.push({t:run.t,x:run.x,z:run.z,yaw:run.yaw,s:run.s});
      note(run,'완전 정지');
      // The last full stop after the turn begins and before the crossing is
      // the stop made for the crossing.
      if (run.s > turnStart && !run.entered) run.stopGap = gap(run);
    }
    // Sample in simulation time, excluding all pauses. Preserve control values
    // with the speed curve instead of reconstructing them from example graphs.
    if (!run.samples.length || run.t-run.samples.at(-1).t >= .1) {
      run.samples.push({t:run.t,speed:run.speed*3.6,brake,steer:input.steer,signal:run.signal,x:run.x,z:run.z});
    }
    if (prior < turnStart && run.s >= turnStart) {
      run.turnSpeed = run.speed;
      run.signalAtTurn = run.signal > 0;
    }
    if (run.z > 3 || (run.s > turnEnd+12 && !run.turnComplete)) {
      note(run,'우회전 미완료 · 교차로 직진 또는 조향 부족');
      run.result = 'missed';
      return;
    }
    if (!run.empty && crossingNow && run.s > turnStart-2 && run.x < crossEdge && run.braking && run.speed < .4 && !run.waited) {
      run.waited = true;
      note(run,'횡단보도 앞에서 정지');
    }
    if (run.x >= crossEdge && !run.entered) {
      run.entered = true;
      run.speedAtCross = run.speed;
      note(run,'횡단보도 진입 · '+Math.round(run.speed*3.6)+' km/h');
    }
    // Test the pedestrian's actual position against the moving vehicle's
    // footprint, rather than declaring the entire crossing unsafe on a timer.
    if(!run.empty&&run.speed>.25){
      for(let sample=0;sample<=6;sample++){
        const ahead=sample*.1;
        const ped=pedestrian({...run,t:run.t+ahead});
        if(!ped||ped.cue)continue;
        const dx=ped.x-run.x-Math.sin(run.yaw)*run.speed*ahead;
        const dz=ped.z-run.z-Math.cos(run.yaw)*run.speed*ahead;
        const forward=dx*Math.sin(run.yaw)+dz*Math.cos(run.yaw);
        const lateral=dx*Math.cos(run.yaw)-dz*Math.sin(run.yaw);
        if(forward>-.9&&forward<2.5&&Math.abs(lateral)<1.15){
          note(run,'보행자와 차량의 진행 경로 겹침');
          run.result='unsafe';
          // The run ends here while the car is still moving, so report where
          // it would have come to rest under full braking from this moment.
          run.stopGap = projectedGap(run);
          run.stopProjected = true;
          return;
        }
      }
    }

    if (run.x >= crossEdge+6.5 && run.turnComplete && run.signalCancelAt===null) {
      run.result = run.speedAtCross > 4.2 ? 'fast' : run.empty ? 'clear' : 'safe';
      note(run, '우회전 완료');
    }

  }
  // Distance from the car's nose to the stop line: positive is short of the
  // line, negative is past it.
  function gap(run) {
    return stopLine-(run.x+Math.sin(run.yaw)*noseAhead);
  }
  // Brake fully from the current state, without a pedestrian, until the car
  // comes to rest, and measure the gap there.
  function projectedGap(run) {
    const ghost = {...run, result:undefined, empty:true, events:[], samples:[], stops:[]};
    for (let i = 0; i < 600 && ghost.speed > 0 && !ghost.result; i++) {
      step(ghost, 1/60, {steer:run.steer, brake:1, throttle:0});
    }
    return gap(ghost);
  }
  // Safety score out of 100. A run that passed never scores below the 70
  // point target and a failed one never reaches it, so the score and the
  // pass/fail verdict on the result screen always agree.
  const passMark = 70;
  const reactionTarget = 1;
  function score(run) {
    const pass = run.result === 'safe' || run.result === 'clear';
    const deductions = [];
    const take = (points, label) => deductions.push({points, label});
    if (run.result === 'unsafe') take(40, '보행자 충돌 위험');
    else if (run.result === 'missed') take(40, '우회전 미완료');
    else if (run.result === 'fast') take(35, '횡단보도 과속 통과');
    // Reaction is judged only when a pedestrian actually stepped out.
    // A car that went straight never met the pedestrian on the exit street.
    const judged = !run.empty && run.stepAt !== null && run.result !== 'missed';
    if (judged && run.reaction === null) take(20, '보행자에 반응 없음');
    else if (judged && run.reaction > 2) take(20, '반응 시간 2초 초과');
    else if (judged && run.reaction > reactionTarget) take(10, '반응 시간 1초 초과');
    // A car that never completed the turn never reached the crossing's stop
    // line, so its stop position is not measured.
    const stopGap = run.result === 'missed' ? null : run.stopGap;
    if (stopGap !== null && stopGap < -1) take(20, '정지선 1m 넘게 넘음');
    else if (stopGap !== null && stopGap < 0) take(10, '정지선 넘음');
    if (run.hardBrakes) take(15, '불필요한 급제동');
    if (run.turnSpeed !== undefined && !run.signalAtTurn) take(5, '우회전 전 방향지시등 안 켬');
    const raw = clamp(100-deductions.reduce((sum, d) => sum+d.points, 0), 0, 100);
    return {
      value: pass ? Math.max(passMark, raw) : Math.min(passMark-1, raw),
      pass, passMark, deductions,
      reaction: judged ? run.reaction : null,
      reactionMet: judged && run.reaction !== null && run.reaction <= reactionTarget,
      reactionTarget,
      reactionEarly: judged && run.reactedEarly,
      stopGap,
      stopMet: stopGap !== null && stopGap >= 0,
      stopProjected: run.stopProjected
    };
  }
  function pedestrian(run) {
    if (run.empty) return null;
    if (run.stepAt === null) return {x:run.walkerX,z:kerbside,cue:true,phase:'wait',step:0,heading:[0,1]};
    const z = kerbside+(run.t-run.stepAt)*(run.crossPace||crossPace);
    if (z > farSide) return null;
    return {x:run.walkerX,z,cue:false,phase:'cross',step:(run.t-run.stepAt)*1.05,heading:[0,1]};
  }
  window.Drive = {create,pose,signal,step,pedestrian,score,obstruction,parked,crosswalk,stopLine,
    track:{lane,exitLane,radius,turnStart,turnEnd,crossing,turnZ,cueDistance},
    speeds:{cruise:cruiseSpeed,top:topSpeed,creep:creepSpeed}};
})();
