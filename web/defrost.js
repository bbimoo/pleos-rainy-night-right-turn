(() => {
  const clearingSeconds=1.6,occurrenceChance=.5;
  // Decide once at departure, independently of the pedestrian variant.
  // Condensation affects visibility, never the driving/scenario clock.
  function create({host,allowed,changed=()=>{}}){
    let phase='idle',used=false,selected=false,opacity=0,elapsed=0,requestId=null,timer=null,serial=0,run=null;
    let source='',detail='';
    const session=Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
    const active=()=>!['idle','done'].includes(phase);
    const record=label=>run?.events.push({t:run.t,label,speed:run.speed*3.6,steer:run.steer,brake:run.brakeForce,signal:run.signal,x:run.x,z:run.z});
    function cancel(){
      clearTimeout(timer);timer=null;
      if(requestId){try{host?.cancelDefroster?.(requestId);}catch(error){console.warn(error);}}
      requestId=null;
    }
    function error(message){cancel();phase='error';detail=message;changed();}
    function receive(message){
      if(typeof message==='string'){try{message=JSON.parse(message);}catch{return;}}
      if(!message||message.type!=='defroster'||!requestId||message.requestId!==requestId)return;
      if(!allowed()){suspend();return;}
      const confirmedOn=message.status==='on'&&message.confirmed===true&&['sdk','mock-debug','mock-browser'].includes(message.source);
      const emulatorAccepted=message.status==='accepted'&&message.accepted===true&&message.confirmed===false&&message.source==='sdk-emulator';
      if(confirmedOn||emulatorAccepted){
        // Emulator practice is explicit and is never recorded as SDK ON.
        clearTimeout(timer);timer=null;requestId=null;
        source=message.source;phase='clearing';elapsed=0;
        detail=source==='sdk'?'차량의 앞유리 기능이 켜졌어요.':emulatorAccepted?'에뮬레이터에서 김서림 제거를 연습하고 있어요.':'모의 연습 · 앞유리 김서림을 제거하고 있어요.';
        record(source==='sdk'?'SDK 앞유리 ON 확인':emulatorAccepted?'SDK 요청 수락 · 에뮬레이터 김서림 제거 연습':'앞유리 ON 모의 확인');
      }else if(['permission','unsupported','error','timeout','blocked','cancelled'].includes(message.status)){
        error(message.message||'앞유리 상태를 확인하지 못했어요. F 키나 버튼으로 다시 요청하세요.');return;
      }else if(typeof message.message==='string')detail=message.message;
      changed();
    }
    function request(){
      if(!allowed()||!['waiting','error'].includes(phase))return;
      requestId=session+'-'+(++serial);phase='requesting';detail='앞유리 김서림 제거를 요청하고 있어요.';changed();
      timer=setTimeout(()=>error('응답 시간이 초과됐어요. P단에서 F 키나 버튼으로 다시 요청하세요.'),10000);
      try{
        if(host){
          if(typeof host.defrostFront!=='function')throw Error('호스트가 앞유리 제어를 지원하지 않아요. 앱을 업데이트한 뒤 다시 시도하세요.');
          host.defrostFront(requestId);
        }else receive({type:'defroster',requestId,status:'on',confirmed:true,source:'mock-browser'});
      }catch(e){error(e.message||'앞유리 요청에 실패했어요. F 키나 버튼으로 다시 요청하세요.');}
    }
    function suspend(){
      if(phase==='requesting'){cancel();phase='error';detail='요청이 중단됐어요. P단에서 이어하기 후 F 키나 버튼으로 다시 확인하세요.';changed();}
    }
    return {
      receive,request,suspend,
      start(current,random=Math.random){
        if(used)return;
        run=current;used=true;selected=random()<occurrenceChance;
        phase=selected?'waiting':'idle';opacity=selected?.82:0;elapsed=0;source='';
        detail=selected?'앞유리 시야가 흐리면 김서림 제거 버튼을 눌러 주세요.':'';
        record(selected?'출발 시 앞유리 김서림 있음':'출발 시 앞유리 김서림 없음');changed();
      },
      tick(dt){
        if(phase!=='clearing'||!allowed())return;
        elapsed=Math.min(clearingSeconds,elapsed+Math.max(0,dt));
        opacity=.82*(1-elapsed/clearingSeconds);
        if(elapsed>=clearingSeconds){phase='done';opacity=0;record('앞유리 김서림 제거 완료');}
        changed();
      },
      reset(){cancel();phase='idle';used=false;selected=false;opacity=0;elapsed=0;source='';detail='';run=null;changed();},
      snapshot:()=>({phase,used,selected,active:active(),opacity,source,detail,requestId})
    };
  }
  window.Defrost={create,clearingSeconds,occurrenceChance};
})();
