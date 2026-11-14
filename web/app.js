(() => {
  const get=id=>document.getElementById(id), canvas=get('scene'), main=canvas.closest('main');
  const scene=Scene.create(canvas,{hud:false}), params=new URLSearchParams(location.search), host=window.PleosHost;
  const coarse=matchMedia('(pointer: coarse)'), forceTouch=params.get('touch')==='1';
  let attempt=0, run=Drive.create(attempt), state='checking', paused=false, animation=0, frame=null, lastInput=null;
  let cueImage=null, cueCapturedAt=null, checkTimer=null, checked=false;
  let defrost=null,mistShift=null;
  const inputAllowed=()=>state==='play'&&!paused&&!hub.pleos.blocked()&&!document.hidden;
  const hub=GameInput.create({host,enabled:()=>state==='play'&&!paused&&!hub.pleos.blocked()&&!document.hidden,
    onChange:syncLifecycle,command(type,value){
      if(type==='restart'){attempt++;begin();}
      if(type==='turnSignal')applySignal(value);
      if(type==='defrost')defrost?.request();
      if(type==='wipers'){run.wipers=value;updateTouch();}
    }});
  defrost=Defrost.create({host,allowed:inputAllowed,changed:updateDefrost});
  window.MCER.Defroster={receive:defrost.receive};
  function updateDefrost(){
    if(!defrost)return;
    const status=defrost.snapshot();
    get('defrost-interlude').hidden=state!=='play'||!status.active;
    get('windshield-mist').style.opacity=String(status.opacity);
    get('defrost-status').textContent=status.detail;
    get('defrost-button').disabled=!inputAllowed()||!['waiting','error'].includes(status.phase);
    get('defrost-button').textContent=status.phase==='requesting'?'차량 상태 확인 중…':status.phase==='clearing'?'김서림을 제거하고 있어요…':status.phase==='error'?'다시 요청 · F':'앞유리 김서림 제거 · F';
    updateTouch();
  }
  function alignMist(){
    if(!defrost.snapshot().active){mistShift=null;return;}
    // Match cockpit()'s -view * 500 shift in its 1000-unit design space.
    const shift=-scene.composition().view*50;
    if(mistShift===null||Math.abs(shift-mistShift)>.005){
      get('windshield-mist').style.transform='translateX('+shift+'%)';mistShift=shift;
    }
  }
  function advance(dt,input){
    Drive.step(run,dt,input);
    defrost.tick(dt);
  }
  function fit(){
    // innerWidth can include overflowing document content in Android WebView.
    // Measure the actual CSS viewport, independently of the design dimensions.
    const root=document.documentElement;
    const scale=Math.min(root.clientWidth/1700,root.clientHeight/1184);
    root.style.setProperty('--design-unit',scale+'px');
    root.style.setProperty('--ui-scale',String(scale));
  }
  fit();window.addEventListener('resize',fit);
  new ResizeObserver(fit).observe(document.documentElement);
  const outcomes={
    unsafe:['보행자 충돌 위험','정차 차량 앞에서 나온 보행자와 진행 경로가 겹쳤어요.','정차 차량 옆에서는 미리 감속하고, 보행자가 지나간 뒤 출발하세요.'],
    missed:['우회전을 완료하지 못했어요','교차로를 직진하거나 오른쪽 조향을 끝까지 완료하지 못했어요.','우측 방향지시등을 켜고 충분히 감속한 뒤 핸들을 돌려 우회전하세요.'],
    fast:['서행이 필요해요','횡단보도를 지나는 속도가 높았어요.','가려진 구간에서는 보행자가 보이지 않아도 감속한 채 통과하세요.'],
    safe:['안전하게 우회전했어요','보행자의 진행 경로가 비워진 뒤 횡단보도를 통과했어요.','정차한 차 옆을 지날 때는 먼저 속도를 줄이세요.'],
    clear:['횡단보도를 서행으로 통과했어요','가려진 횡단보도에서 속도를 낮춰 통과했어요.','가려진 곳을 천천히 지나며 횡단보도를 확인하세요.']
  };
  const passed=()=>['safe','clear'].includes(run.result);
  function applySignal(value){
    if(!Object.hasOwn(GameInput.signals,value))return;
    const direction=GameInput.signals[value];
    if(direction!==run.signal)Drive.signal(run,direction||run.signal);
  }
  function updateTouch(){
    get('touch').hidden=state!=='play'||paused||Boolean(hub.pleos.blocked())||!(forceTouch||host||coarse.matches);
    for(const b of get('touch').querySelectorAll('[data-capability]'))b.hidden=b.dataset.capability!=='brake'&&hub.pleos.uses(b.dataset.capability);
    get('touch-wipers').setAttribute('aria-pressed',String(run.wipers!==false));
  }
  function screen(next){
    state=next;
    for(const id of ['checking','intro','result','report'])get(id).hidden=id!==next;
    get('driving-ui').hidden=next!=='play';
    try{host?.practiceState?.(next==='play');}catch(error){console.warn(error);}
    updateDefrost();
  }
  function schedule(){if(!animation&&!document.hidden&&!hub.pleos.blocked()&&!paused)animation=requestAnimationFrame(draw);}
  function parkLabel(snapshot){
    if(snapshot.parked===true)return snapshot.hosted?'P · 주차':'P · PC 체험';
    const names={GEAR_DRIVE:'D · 주행',GEAR_REVERSE:'R · 후진',GEAR_NEUTRAL:'N · 중립',GEAR_PARK:'P · 주차'};
    return names[snapshot.reason]||'확인 불가';
  }
  function syncLifecycle(){
    const blocked=hub.pleos.blocked(), snapshot=hub.pleos.snapshot(), gate=get('park-gate');
    const wasVisible=!gate.hidden;
    if(blocked&&state==='play')paused=true;
    get('check-park').textContent=snapshot.parked===true?'확인됨':blocked==='checking'?'확인 중':'확인 필요';
    get('check-park').classList.toggle('confirmed',snapshot.parked===true);
    get('check-park-copy').textContent=snapshot.parked===true?'주차 상태를 확인했어요':'주차 상태를 확인하고 있어요';
    const live=['steering','brake','turnSignal'].every(key=>hub.pleos.uses(key)&&snapshot.received[key]);
    get('check-input').textContent=live?'확인됨':snapshot.hosted?'입력 대기':'PC 체험';
    get('check-input-copy').textContent=live?'차량 신호를 확인했어요':snapshot.hosted?'미수신 신호는 키보드·터치로 조작할 수 있어요':'키보드·터치로 연습할 수 있어요';
    // Unknown gear remains blocked. The checking page is visible during bootstrap.
    gate.hidden=!(paused||blocked==='restricted'||(blocked==='checking'&&state!=='checking'));
    gate.classList.toggle('paused',paused);
    if(get('gate-icon').dataset.mode!==String(paused)){
      get('gate-icon').dataset.mode=String(paused);
      get('gate-icon').replaceChildren();
      if(paused){const icon=document.querySelector('[data-pause-asset]').cloneNode();icon.hidden=false;icon.removeAttribute('data-pause-asset');get('gate-icon').append(icon);}
      else get('gate-icon').textContent='P';
    }
    get('park-message').textContent=paused?'연습을 일시정지했어요':blocked==='checking'?'차량 상태를 확인하고 있어요':snapshot.requiresDO?'주행 중에는 화면을 사용할 수 없어요':'기어를 P단에 두세요';
    get('park-description').textContent=snapshot.requiresDO?'차량의 주행 중 화면 제한이 해제된 후 이어갈 수 있어요.':paused?'정차 후 기어를 P단에 두면 연습을 이어갈 수 있어요.':'정차 후 P단으로 바꾸면 연습을 시작할 수 있어요.';
    get('current-gear').textContent='현재 기어  '+parkLabel(snapshot);
    get('resume').hidden=!paused;get('resume').disabled=Boolean(blocked);
    for(const element of main.children)if(element!==gate)element.inert=!gate.hidden;
    if(!gate.hidden&&!wasVisible)gate.focus({preventScroll:true});
    // Presentation acknowledgement only: the native touch shield and native
    // WebView pause remain active until trusted parking/UX messages clear them.
    if(blocked&&(!gate.hidden||state==='checking')){
      try{host?.gatePresented?.();}catch(error){console.warn(error);}
    }
    updateTouch();
    if(blocked||paused||document.hidden){
      defrost?.suspend();updateDefrost();
      cancelAnimationFrame(animation);animation=0;frame=null;lastInput=null;hub.clear();scene.pause();
    }else{
      if(state==='checking'&&checked)briefing();
      schedule();
    }
  }
  function briefing(){
    screen('intro');scene.draw(run,0);get('preview-image').src=canvas.toDataURL('image/jpeg',.85);
    get('start').focus({preventScroll:true});
  }
  function home(){
    defrost.reset();paused=false;hub.reset();scene.reset();run=Drive.create(attempt);cueImage=null;cueCapturedAt=null;
    checked=false;screen('checking');syncLifecycle();clearTimeout(checkTimer);
    checkTimer=setTimeout(()=>{checked=true;syncLifecycle();},800);
  }
  function begin(){
    if(hub.pleos.blocked()||document.hidden)return;
    defrost.reset();run=Drive.create(attempt);cueImage=null;cueCapturedAt=null;paused=false;hub.reset();scene.reset();frame=null;
    defrost.start(run);
    screen('play');scene.draw(run,0);alignMist();updateHud();syncLifecycle();get('scene').focus({preventScroll:true});
  }
  function updateHud(){
    const left=run.signal<0,right=run.signal>0;
    get('speed').textContent=Math.round(run.speed*3.6);
    get('signal-left').hidden=!left;get('signal-right').hidden=!right;get('braking').hidden=!run.braking;
    get('hint-copy').textContent=left?'우회전 전 오른쪽을 확인하세요':right?'횡단보도 앞에서 속도를 줄이세요':'앞 교차로에서 우회전';
    get('hint-detail').textContent=left?'왼쪽 확인':right?'오른쪽 확인':'오른쪽 방향지시등을 켜세요';
    main.dataset.view=left?'left':right?'right':'front';
  }
  function metric(valueId,targetId,value,unit,target,met){
    const b=get(valueId),small=get(targetId);
    b.replaceChildren(value);
    if(unit){const u=document.createElement('span');u.className='unit';u.textContent=unit;b.append(u);}
    small.replaceChildren();small.className=met===true?'met':met===false?'missed':'';
    if(met===true){const img=document.createElement('img');img.src=document.querySelector('img[data-metric-check-asset]').src;img.alt='달성';small.append(img);}
    else if(met===false){const mark=document.createElement('span');mark.className='mark';mark.textContent='✕';mark.setAttribute('aria-label','미달성');small.append(mark);}
    small.append(target);
  }
  function finish(){
    if(run.samples.at(-1)?.t!==run.t)run.samples.push({t:run.t,speed:run.speed*3.6,brake:run.brakeForce,steer:run.steer,signal:run.signal,x:run.x,z:run.z});
    defrost.suspend();hub.clear();const pass=passed(), [defaultTitle,summary,tip]=outcomes[run.result];
    const title=run.result==='safe'&&run.waited&&run.stops.length?'안전 정지 성공!':defaultTitle;
    get('result').classList.toggle('fail',!pass);
    get('result-title').textContent=title;get('result-summary').textContent=summary;get('result-tip').textContent=tip;
    get('result-icon').replaceChildren();
    if(pass){const img=document.createElement('img');img.src=document.querySelector('img[data-check-asset]').src;img.alt='성공';get('result-icon').append(img);}else get('result-icon').textContent='!';
    get('result-kicker').textContent='시나리오 A / '+(pass?'주행 성공':'주행 실패');
    const score=Drive.score(run),gap=score.stopGap;
    // met: true shows the check, false marks a missed target, null means the
    // metric does not apply to this run.
    // The large value is always a number or a dash; the caption says why.
    metric('score-value','score-target',String(score.value),'점','기준 '+score.passMark+'점 이상',score.pass);
    const reactionTarget='목표 '+score.reactionTarget.toFixed(1)+'초 이내';
    if(run.empty)metric('reaction-value','reaction-target','–','','보행자 없는 회차',null);
    else if(run.result==='missed')metric('reaction-value','reaction-target','–','','우회전 미완료로 측정 안 함',null);
    else if(run.stepAt===null)metric('reaction-value','reaction-target','–','','보행자 등장 전 종료',null);
    else if(score.reaction===null)metric('reaction-value','reaction-target','–','',run.result==='unsafe'?'브레이크 없이 충돌':'브레이크 반응 없음',false);
    else if(score.reactionEarly)metric('reaction-value','reaction-target','0.0','초','미리 감속함',true);
    else metric('reaction-value','reaction-target',score.reaction.toFixed(1),'초',reactionTarget,score.reactionMet);
    if(run.result==='missed')metric('stop-value','stop-reference','–','','우회전 미완료로 측정 안 함',null);
    else if(gap===null)metric('stop-value','stop-reference','–','',run.empty?'보행자 없음 · 서행 통과가 정답':'완전히 멈추지 않고 통과',null);
    else metric('stop-value','stop-reference',Math.abs(gap).toFixed(1),gap<0?'m 넘음':'m 앞',
      score.stopProjected?'충돌 순간 급제동 기준':'목표 정지선 앞',score.stopMet);
    get('result-record').textContent='실제 주행 '+run.t.toFixed(1)+'초 · 횡단보도 진입 '+(run.speedAtCross===undefined?'기록 없음':(run.speedAtCross*3.6).toFixed(1)+' km/h')+' · 완전 정지 '+run.stops.length+'회';
    get('result-next').textContent=pass?'다음 시나리오':'다시 도전';
    get('result-next').disabled=pass;get('next-note').hidden=!pass;
    screen('result');get('show-report').focus({preventScroll:true});
  }
  function chart(){
    const c=get('record-chart'),ctx=c.getContext('2d'),w=c.width,h=c.height,left=55,top=25,bottom=h-95,right=w-15;
    ctx.clearRect(0,0,w,h);ctx.font='20px system-ui';ctx.fillStyle='#ddd';
    const maxT=Math.max(1,run.t),x=t=>left+t/maxT*(right-left),y=v=>bottom-v/30*(bottom-top);
    for(let v=0;v<=30;v+=10){ctx.strokeStyle='#ffffff1a';ctx.beginPath();ctx.moveTo(left,y(v));ctx.lineTo(right,y(v));ctx.stroke();ctx.fillText(String(v),5,y(v)+6);}
    for(let i=0;i<=5;i++)ctx.fillText((maxT*i/5).toFixed(1)+'초',Math.min(right-50,x(maxT*i/5)),h-8);
    for(const e of run.events){ctx.strokeStyle='#ffffff25';ctx.beginPath();ctx.moveTo(x(e.t),top);ctx.lineTo(x(e.t),bottom);ctx.stroke();}
    function line(color,value){ctx.strokeStyle=color;ctx.lineWidth=4;ctx.beginPath();run.samples.forEach((s,i)=>{const px=x(s.t),py=y(value(s));i?ctx.lineTo(px,py):ctx.moveTo(px,py);});ctx.stroke();}
    line('#0082ff',s=>s.speed);
    // Control bands have their own normalized scale, separate from km/h.
    for(const [band,color,value] of [[0,'#ff8a00',s=>s.brake],[1,'#02c265',s=>Math.abs(s.signal)],[2,'#b99aff',s=>Math.abs(s.steer)]]){
      const base=bottom+20+band*16;ctx.strokeStyle=color;ctx.lineWidth=3;ctx.beginPath();
      run.samples.forEach((s,i)=>{const px=x(s.t),py=base-value(s)*10;i?ctx.lineTo(px,py):ctx.moveTo(px,py);});ctx.stroke();
    }
    // The report is static. Present its actual Canvas output as an image so
    // Android WebView does not lose the chart's composited canvas surface when
    // the hidden report is revealed or its sibling event list scrolls.
    get('record-chart-image').src=c.toDataURL('image/png');
    document.querySelector('.chart-legend').textContent='파랑 속도 · 하단 조작량 0–1: 주황 브레이크 / 초록 방향지시등 / 보라 조향';
  }
  function report(){
    const pass=passed(),[title,,tip]=outcomes[run.result];
    get('report-title').textContent=run.result==='safe'&&run.waited&&run.stops.length?'안전 정지 성공!':title;
    get('badge').textContent=(pass?'성공':'실패')+' · 이번 주행 기록';get('badge').classList.toggle('fail',!pass);
    get('feedback').textContent=tip;
    get('entry-speed').textContent=run.speedAtCross===undefined?'미진입':(run.speedAtCross*3.6).toFixed(1)+' km/h';
    const after=run.cueAt===null?[]:run.samples.filter(s=>s.t>=run.cueAt);
    get('cue-brake').textContent=run.empty||!after.length?'단서 없음':after.some(s=>s.speed<run.cueSpeed*3.6-.1)?'속도 감소 기록':'감소 기록 없음';
    get('report-signal').textContent=run.events.some(e=>e.label==='우측 방향지시등 켬')?'우측 켬':'우측 기록 없음';
    get('events').replaceChildren();
    const events=[...run.events,{t:run.t,label:'연습 종료 · '+title}].sort((a,b)=>a.t-b.t);
    for(const e of events){const li=document.createElement('li'),label=document.createElement('span'),time=document.createElement('time');label.textContent=e.label;time.textContent=e.t.toFixed(1)+'초';li.append(label,time);get('events').append(li);}
    get('cue-image').hidden=!cueImage;if(cueImage)get('cue-image').src=cueImage;else get('cue-image').removeAttribute('src');
    get('cue-label').textContent=cueImage?'가려진 횡단보도 접근 순간 · '+cueCapturedAt.toFixed(1)+'초':'단서 장면 기록 없음';
    get('cue-text').textContent=run.empty?'이번 회차에는 정차 차량 앞으로 나오는 보행자가 없었어요.':run.cueAt===null?'보행자 단서가 나타나기 전에 주행이 끝났어요.':'보행자가 기다리는 가려진 횡단보도에 접근했어요. 당시 속도는 '+(run.cueSpeed*3.6).toFixed(1)+' km/h였고 브레이크는 '+(run.cueBraking?'밟고 있었어요.':'밟지 않았어요.');
    get('report-home').textContent=pass?'다른 시나리오':'처음으로';get('report-home').disabled=pass;get('report-next-note').hidden=!pass;
    screen('report');get('events').scrollTop=0;chart();get('retry').focus({preventScroll:true});
  }
  get('start').addEventListener('click',begin);
  for(const id of ['show-report','result-close'])get(id).addEventListener('click',()=>{if(!hub.pleos.blocked())report();});
  get('report-back').addEventListener('click',()=>screen('result'));
  get('retry').addEventListener('click',hub.dispatchRestart);
  get('result-next').addEventListener('click',()=>{if(!passed())hub.dispatchRestart();});
  for(const b of document.querySelectorAll('.home'))b.addEventListener('click',home);
  get('report-home').addEventListener('click',()=>{if(!passed())home();});get('gate-home').addEventListener('click',home);
  get('pause').addEventListener('click',()=>{paused=true;syncLifecycle();});
  get('resume').addEventListener('click',()=>{if(!hub.pleos.blocked()&&!document.hidden){paused=false;frame=null;syncLifecycle();get('scene').focus({preventScroll:true});updateDefrost();}});
  document.addEventListener('visibilitychange',syncLifecycle);window.addEventListener('blur',hub.clear);coarse.addEventListener('change',updateTouch);
  function stats(){return {...scene.stats(),window:{width:innerWidth,height:innerHeight},engine:'Canvas 2D'};}
  if(!host||params.get('hooks')==='1')window.__game={
    getState:()=>({phase:state,paused:Boolean(paused||hub.pleos.blocked()||document.hidden),gate:hub.pleos.blocked(),...run,defrost:defrost.snapshot(),events:run.events.map(e=>({...e})),input:lastInput?{...lastInput}:null,pleos:hub.pleos.snapshot()}),
    setTurnSignal:hub.setTurnSignal,pleos:window.MCER.Pleos.receive,composition:()=>scene.composition(),stats,
    simulate(seconds,input={}){for(let t=0;state==='play'&&!paused&&!hub.pleos.blocked()&&!document.hidden&&!run.result&&t<seconds;t+=1/60)advance(1/60,{steer:0,brake:0,throttle:0,...input});}
  };
  function draw(now){
    animation=0;if(document.hidden||hub.pleos.blocked()||paused)return;
    const dt=frame===null?0:Math.min(.05,(now-frame)/1000);frame=now;
    if(state==='play'){
      lastInput=hub.sample();applySignal(lastInput.turnSignal);run.wipers=lastInput.wipers;
      const right=run.signal===1;if(dt>0)advance(dt,lastInput);
      if(right&&run.signal===0){hub.cancelRight();lastInput.turnSignal='OFF';}updateHud();
    }
    // Keep driving/rendering normally under the single translucent layer.
    // Clearing changes only opacity, with no extra blur or image generation.
    if(state!=='report'){scene.draw(run,dt);alignMist();}
    if(state==='play'&&run.cueAt!==null&&!run.empty&&!cueImage){cueImage=canvas.toDataURL('image/jpeg',.85);cueCapturedAt=run.t;}
    if(state==='play'&&run.result)finish();
    if(!get('diag').hidden)get('diag').textContent=JSON.stringify(stats());schedule();
  }
  get('diag').hidden=params.get('diag')!=='1';
  home();hub.pleos.start();
})();
