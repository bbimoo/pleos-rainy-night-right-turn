(() => {
  const clearingSeconds=1.6;
  // No simulation clock runs while this interlude is active. Only the opacity
  // clock advances after a confirmed ON response, and only while safety allows.
  function create({host,allowed,changed=()=>{}}){
    let phase='idle',used=false,opacity=0,elapsed=0,requestId=null,timer=null,serial=0,run=null;
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
      if(message.status==='on'){
        // A set callback alone is insufficient. The host must have read ON.
        if(message.confirmed!==true||!['sdk','mock-debug','mock-browser'].includes(message.source))return;
        clearTimeout(timer);timer=null;requestId=null;
        source=message.source;phase='clearing';elapsed=0;
        detail=source==='sdk'?'차량에서 앞유리 기능 ON을 확인했어요.':'모의 상태 ON · 실제 차량 제어 아님';
        record(source==='sdk'?'SDK 앞유리 ON 확인':'앞유리 ON 모의 확인');
      }else if(['permission','unsupported','error','timeout','blocked','cancelled'].includes(message.status)){
        error(message.message||'앞유리 상태를 확인하지 못했어요. F 키나 버튼으로 다시 요청하세요.');return;
      }else if(typeof message.message==='string')detail=message.message;
      changed();
    }
    function request(){
      if(!allowed()||!['waiting','error'].includes(phase))return;
      requestId=session+'-'+(++serial);phase='requesting';detail='앞유리 지원 여부와 현재 상태를 확인하고 있어요.';changed();
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
      begin(current){
        if(used)return;
        run=current;used=true;phase='waiting';opacity=.82;elapsed=0;source='';
        detail=host?'F 키나 버튼으로 앞유리 기능을 켜세요. 차량의 ON 상태를 확인한 뒤 이어가요.':'PC 모의 연습 · F 키나 버튼으로 김서림을 제거하세요.';
        run.speed=0;run.throttle=0;
        record('앞유리 김서림 · 주행과 시나리오 시간 정지');changed();
      },
      tick(dt){
        if(phase!=='clearing'||!allowed())return;
        elapsed=Math.min(clearingSeconds,elapsed+Math.max(0,dt));
        opacity=.82*(1-elapsed/clearingSeconds);
        if(elapsed>=clearingSeconds){phase='done';opacity=0;record('앞유리 김서림 제거 완료 · 같은 위치에서 재개');}
        changed();
      },
      reset(){cancel();phase='idle';used=false;opacity=0;elapsed=0;source='';detail='';run=null;changed();},
      snapshot:()=>({phase,used,active:active(),opacity,source,detail,requestId})
    };
  }
  window.Defrost={create,clearingSeconds};
})();
