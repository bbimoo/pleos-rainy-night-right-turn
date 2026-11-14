(() => {
  const signals={OFF:0,LEFT:-1,RIGHT:1};
  const isSignal=value=>Object.hasOwn(signals,value);
  const readable=value=>value==='READ'||value==='READ_WRITE';
  const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
  const keyActions={KeyQ:'leftSignal',KeyE:'rightSignal',KeyW:'wipers',KeyF:'defrost',ArrowLeft:'left',ArrowRight:'right',ArrowUp:'accelerate',Space:'brake'};
  const keyFallbacks={arrowleft:'left',arrowright:'right',arrowup:'accelerate',' ':'brake',spacebar:'brake',q:'leftSignal',e:'rightSignal',w:'wipers',f:'defrost'};
  // Only the held keyboard Up arrow requests acceleration.
  const keyPedal=1;
  // A real steering wheel turns about one and a half turns each way. The
  // game's full steer is a 5 m radius, close to a car's tightest turn, so it
  // maps to the wheel near full lock. A small dead zone keeps a hand resting
  // on the wheel from steering. ?steerLock=<degrees> and ?steerSign=-1 adjust
  // the mapping if a vehicle reports a different range or direction.
  const query=new URLSearchParams(location.search);
  // Only a plausible wheel range is accepted (30-1440 degrees); anything else,
  // including values at or below the dead zone, falls back to 450.
  const requestedLock=Number(query.get('steerLock'));
  const steerLock=Number.isFinite(requestedLock)&&requestedLock>=30&&requestedLock<=1440?requestedLock:450;
  const steerSign=query.get('steerSign')==='-1'?-1:1;
  const steerDeadZone=2;
  function steerFromAngle(deg){
    const magnitude=Math.abs(deg);
    if(magnitude<=steerDeadZone)return 0;
    return Math.sign(deg)*steerSign*clamp((magnitude-steerDeadZone)/(steerLock-steerDeadZone),0,1);
  }
  const capabilities=['turnSignal','steering','brake','accelerator'];
  const accessTypes=['NONE','READ','WRITE','READ_WRITE'];

  function PleosAdapter(host,onChange){
    let parked=host?null:true,requiresDO=false,active=0,reason='';
    const access={turnSignal:'NONE',steering:'NONE',brake:'NONE',accelerator:'NONE'};
    const vehicle={turnSignal:'OFF',steer:0,brake:0,throttle:0};
    const received={turnSignal:false,steering:false,brake:false};
    let rightCancelled=false;
    const bridge={
      receive(message){
        if(typeof message==='string'){
          try{message=JSON.parse(message);}catch{return;}
        }
        if(!message||typeof message!=='object'||Array.isArray(message))return;
        switch(message.type){
          case 'capabilities':
            for(const key of capabilities)access[key]=accessTypes.includes(message[key])?message[key]:'NONE';
            break;
          case 'turnSignal':
            if(!isSignal(message.value))return;
            vehicle.turnSignal=message.value;
            received.turnSignal=true;
            if(message.value!=='RIGHT')rightCancelled=false;
            break;
          case 'steeringAngle':
            if(!Number.isFinite(message.deg))return;
            vehicle.steer=steerFromAngle(message.deg);
            received.steering=true;
            break;
          case 'brakePedal':
            if(typeof message.pressed!=='boolean')return;
            vehicle.brake=Number(message.pressed);
            received.brake=true;
            break;
          case 'acceleratorPedal':
            // Pedal travel as 0..1, as a percentage, or as a plain pressed flag.
            if(typeof message.pressed==='boolean')vehicle.throttle=message.pressed?keyPedal:0;
            else if(Number.isFinite(message.value))vehicle.throttle=clamp(message.value,0,1);
            else if(Number.isFinite(message.percent))vehicle.throttle=clamp(message.percent/100,0,1);
            else return;
            break;
          case 'uxRestrictions':
            if(typeof message.requiresDO!=='boolean')return;
            requiresDO=message.requiresDO;
            active=Number.isInteger(message.active)?message.active:0;
            break;
          case 'parked':
            if(typeof message.parked!=='boolean')return;
            parked=message.parked;
            reason=typeof message.reason==='string'?message.reason:'';
            break;
          default:return;
        }
        bridge.connected=true;
        onChange();
      },
      connected:false
    };
    window.MCER=window.MCER||{};
    window.MCER.Pleos=bridge;
    return {
      start(){
        try{host?.ready?.();}catch(error){console.warn('PleosHost.ready failed',error);}
      },
      blocked(){
        if(requiresDO||parked===false)return 'restricted';
        return parked===null?'checking':null;
      },
      mockPark(){
        if(host)return;
        parked=!parked;
        onChange();
      },
      uses(key){return readable(access[key]);},
      vehicle,
      signal(){return rightCancelled?'OFF':vehicle.turnSignal;},
      cancelRight(){rightCancelled=vehicle.turnSignal==='RIGHT';},
      snapshot(){return {hosted:Boolean(host),connected:bridge.connected,parked,requiresDO,active,reason,capabilities:{...access},received:{...received}};}
    };
  }

  function KeyboardAdapter(hub){
    const held=new Set();
    const continuous=new Set(['left','right','accelerate','brake']);
    // Android WebView may omit code. Resolve both edges using the same map.
    const actionFor=event=>keyActions[event.code]||keyFallbacks[event.key?.toLowerCase()];
    document.addEventListener('keydown',event=>{
      if(event.shiftKey&&event.code==='KeyP'){
        if(!hub.pleos.snapshot().hosted){
          event.preventDefault();
          if(!event.repeat)hub.pleos.mockPark();
        }
        return;
      }
      const action=actionFor(event);
      if(!action||!hub.enabled())return;
      event.preventDefault();
      // Blur/parking clears the held set. Once input is enabled again, a real
      // repeat is evidence that a continuous control is still held. Toggle
      // actions must never fire again just because focus returned.
      if(held.has(action)||(event.repeat&&!continuous.has(action)))return;
      held.add(action);
      hub.press(action,'keyboard');
    });
    document.addEventListener('keyup',event=>{
      const action=actionFor(event);
      if(!held.delete(action))return;
      hub.release(action,'keyboard');
    });
    return {clear(){held.clear();}};
  }

  function TouchAdapter(hub){
    const pointers=new Map();
    for(const button of document.querySelectorAll('[data-action]')){
      button.addEventListener('pointerdown',event=>{
        if(!hub.enabled())return;
        event.preventDefault();
        const source='pointer:'+event.pointerId;
        pointers.set(event.pointerId,button.dataset.action);
        button.setPointerCapture(event.pointerId);
        hub.press(button.dataset.action,source);
      });
      for(const eventName of ['pointerup','pointercancel','lostpointercapture']){
        button.addEventListener(eventName,event=>{
          const action=pointers.get(event.pointerId);
          if(!action)return;
          pointers.delete(event.pointerId);
          hub.release(action,'pointer:'+event.pointerId);
        });
      }
      button.addEventListener('click',event=>{
        if(event.detail===0&&hub.enabled()){
          hub.press(button.dataset.action,'accessible');
          hub.release(button.dataset.action,'accessible');
        }
      });
    }
    return {clear(){pointers.clear();}};
  }

  function create({enabled,command,onChange,host}){
    const pressed=new Map();
    let turnSignal='OFF',wipers=true,brakeAt=null,lastPad=0,padNeedsNeutral=false,keySteer=0,keyThrottle=0,sampledAt=0,keyboardSteerOverride=false,keyboardSignalOverride=false;
    const pleos=PleosAdapter(host,onChange);
    const hub={
      pleos,enabled,
      press(action,source){
        if(!enabled())return;
        if(action==='accelerate'&&source!=='keyboard')return;
        if(action==='leftSignal'||action==='rightSignal'){
          const value=action==='leftSignal'?'LEFT':'RIGHT';
          if(source==='keyboard'){
            // Keep a keyboard-selected signal (including OFF) until the next
            // keyboard choice, auto-cancel or run reset; SDK OFF is not a key release.
            turnSignal=effectiveSignal()===value?'OFF':value;
            keyboardSignalOverride=true;
            command('turnSignal',turnSignal);
          }else if(!pleos.uses('turnSignal'))hub.setTurnSignal(turnSignal===value?'OFF':value);
          return;
        }
        if(action==='defrost'){command('defrost');return;}
        if(action==='wipers'){
          wipers=!wipers;
          command('wipers',wipers);
          return;
        }
        if(action==='brake'&&!isHeld('brake'))brakeAt=performance.now();
        if(!pressed.has(action))pressed.set(action,new Set());
        pressed.get(action).add(source);
      },
      release(action,source){pressed.get(action)?.delete(source);},
      setTurnSignal(value){
        if(!enabled()||!isSignal(value)||pleos.uses('turnSignal'))return;
        turnSignal=value;
        command('turnSignal',value);
      },
      cancelRight(){
        if(turnSignal==='RIGHT')turnSignal='OFF';
        if(pleos.uses('turnSignal'))pleos.cancelRight();
      },
      dispatchRestart(){
        if(!pleos.blocked()&&!document.hidden)command('restart');
      },
      clear(){
        pressed.clear();
        brakeAt=null;
        keySteer=0;
        keyboardSteerOverride=false;
        keyThrottle=0;
        sampledAt=0;
        lastPad=0;
        padNeedsNeutral=true;
        keyboard.clear();
        touch.clear();
      },
      reset(){
        hub.clear();
        padNeedsNeutral=false;
        turnSignal='OFF';
        keyboardSignalOverride=false;
      },
      sample(){
        let pad;
        try{pad=Array.from(navigator.getGamepads?.()??[]).find(Boolean);}catch{}
        const axis=pad?.axes[0]||0;
        const padBrake=pad?.buttons[6]?.value||0;
        const padThrottle=pad?.buttons[7]?.value||0;
        const direction=pad?.buttons[5]?.pressed?1:pad?.buttons[4]?.pressed?-1:0;
        if(padNeedsNeutral&&Math.abs(axis)<=.1&&padBrake<=.06&&padThrottle<=.06&&!direction)padNeedsNeutral=false;
        if(!padNeedsNeutral&&direction&&direction!==lastPad&&!pleos.uses('turnSignal')){
          const value=direction===1?'RIGHT':'LEFT';
          turnSignal=turnSignal===value?'OFF':value;
        }
        lastPad=direction;
        // Digital steering winds on progressively. Without vehicle steering,
        // releasing the key or touch button lets it return to centre.
        const now=performance.now();
        const dt=sampledAt?clamp((now-sampledAt)/1000,0,.05):0;
        sampledAt=now;
        const vehicleSteering=pleos.uses('steering');
        const keyboardLeft=pressed.get('left')?.has('keyboard')??false;
        const keyboardRight=pressed.get('right')?.has('keyboard')??false;
        const keyboardSteering=keyboardLeft||keyboardRight;
        // Begin an override at the current vehicle angle, then use the same
        // interpolation to return to the live SDK angle after key release.
        if(vehicleSteering&&keyboardSteering&&!keyboardSteerOverride)keySteer=pleos.vehicle.steer;
        if(vehicleSteering&&keyboardSteering)keyboardSteerOverride=true;
        if(!vehicleSteering)keyboardSteerOverride=false;
        const wanted=vehicleSteering
          ?Number(keyboardRight)-Number(keyboardLeft)
          :Number(isHeld('right'))-Number(isHeld('left'));
        const target=vehicleSteering&&!keyboardSteering?pleos.vehicle.steer:wanted;
        const rate=wanted===0?3.4:wanted*keySteer<0?5.2:2.6;
        if(vehicleSteering&&!keyboardSteerOverride)keySteer=target;
        else{
          keySteer+=clamp(target-keySteer,-rate*dt,rate*dt);
          if(vehicleSteering&&!keyboardSteering&&Math.abs(target-keySteer)<.001){
            keySteer=target;keyboardSteerOverride=false;
          }
        }
        const localSteer=Math.abs(keySteer)>.001||wanted?keySteer:0;
        // Ramp up only while Up is held; release removes throttle immediately.
        const keyboardThrottle=pressed.get('accelerate')?.has('keyboard')??false;
        keyThrottle=keyboardThrottle?Math.min(keyPedal,keyThrottle+1.5*dt):0;
        const elapsed=brakeAt===null?Infinity:(performance.now()-brakeAt)/1000;
        const localBrake=isHeld('brake')?Math.min(1,.50+elapsed*1.15):0;
        // Braking from any held local control must survive SDK idle updates.
        // A stronger vehicle brake also takes priority over a partial key press.
        const effectiveBrake=Math.max(localBrake,pleos.uses('brake')?pleos.vehicle.brake:0,
          padNeedsNeutral?0:clamp(padBrake,0,1));
        return {
          throttle:effectiveBrake>.06?0:keyThrottle,
          steer:vehicleSteering?keySteer:localSteer||(!padNeedsNeutral&&Math.abs(axis)>.1?clamp(axis,-1,1):0),
          brake:effectiveBrake,
          turnSignal:effectiveSignal(),
          wipers
        };
      }
    };
    const effectiveSignal=()=>keyboardSignalOverride?turnSignal:pleos.uses('turnSignal')?pleos.signal():turnSignal;
    const isHeld=action=>(pressed.get(action)?.size??0)>0;
    const keyboard=KeyboardAdapter(hub),touch=TouchAdapter(hub);
    return hub;
  }
  window.GameInput={create,signals};
})();
