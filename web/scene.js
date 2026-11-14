(() => {
  const tau = Math.PI*2;
  const lerp = (a,b,t) => a+(b-a)*t;
  let seed=91;
  function rng() { seed=(seed*1664525+1013904223)>>>0; return seed/4294967296; }
  const blocks=[];
  const city=[], glow=[], paint=[], labels=[], trees=[], sidewalks=[];
  const tiers=[
    {pixels:1550000,rain:1},
    {pixels:1050000,rain:.8},
    {pixels:650000,rain:.63}
  ];
  const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
  const wrap=(n,length)=>((n%length)+length)%length;
  const images={};
  for(const key of ['cockpit','wheel','pedestrian']){
    const img=new Image();
    img.src=document.querySelector('meta[name="'+key+'-asset"]')?.content || key+'.webp';
    images[key]=img;
  }
  const ready=image=>image.complete && image.naturalWidth>0;
  // Fog: distant geometry fades into this grey. FOG is the density per metre;
  // raise it for thicker fog. Colours are cached per fade level, so thicker
  // fog costs nothing per frame. Keep the pedestrian findable (see drawWalker).
  const haze=[104,111,115];
  const FOG=.034;
  const parsed=new Map(), hazed=new Map();
  function channels(color){
    let value=parsed.get(color);
    if(value===undefined){
      const hex=/^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(color);
      value=hex?[parseInt(hex[1].slice(0,2),16),parseInt(hex[1].slice(2,4),16),parseInt(hex[1].slice(4,6),16),hex[2]?parseInt(hex[2],16)/255:1]:null;
      parsed.set(color,value);
    }
    return value;
  }
  // Rainy-night grade: a little darker, less saturated, lower contrast and
  // cooler. It is applied once per colour and cached, so it costs nothing per
  // frame (no canvas filter or full-screen tint pass).
  function grade(r,g,b){
    const luma=.3*r+.59*g+.11*b;
    const sat=c=>luma+(c-luma)*.7;
    const tone=c=>c*.86+9;
    return [tone(sat(r))*.94,tone(sat(g))*.98,tone(sat(b))*1.07+5].map(c=>Math.round(clamp(c,0,255)));
  }
  const graded=new Map();
  function gradedColor(color){
    let value=graded.get(color);
    if(value===undefined){
      const rgb=channels(color);
      if(!rgb)value=color;
      else{
        const [r,g,b]=grade(rgb[0],rgb[1],rgb[2]);
        value=rgb[3]<1?'rgba('+r+','+g+','+b+','+rgb[3].toFixed(3)+')':'rgb('+r+','+g+','+b+')';
      }
      graded.set(color,value);
    }
    return value;
  }
  function hazedColor(color,visibility){
    const rgb=channels(color);
    if(!rgb||rgb[3]<1)return null;
    const level=Math.round((1-visibility)*40);
    const key=color+level;
    let value=hazed.get(key);
    if(!value){
      const t=level/40;
      const [r,g,b]=grade(lerp(rgb[0],haze[0],t),lerp(rgb[1],haze[1],t),lerp(rgb[2],haze[2],t));
      value='rgb('+r+','+g+','+b+')';
      hazed.set(key,value);
    }
    return value;
  }
  const point = (x,y,z) => ({x,y,z});
  function face(set, color, ...v) { set.push({color,v}); }
  function ground(set,x,z,w,d,y,color) {
    face(set,color,point(x-w/2,y,z-d/2),point(x+w/2,y,z-d/2),point(x+w/2,y,z+d/2),point(x-w/2,y,z+d/2));
  }
  function box(set,x,z,w,d,b,h,c) {
    const a=point(x-w/2,b,z-d/2), j=point(x+w/2,b,z-d/2), k=point(x+w/2,b,z+d/2), l=point(x-w/2,b,z+d/2);
    const top=p=>point(p.x,b+h,p.z);
    const [A,J,K,L]=[a,j,k,l].map(top);
        const first=set.length;
    face(set,c[0],a,j,J,A);face(set,c[1],j,k,K,J);face(set,c[2]||c[0],k,l,L,K);face(set,c[1],l,a,A,L);face(set,c[3]||c[1],A,J,K,L);
    const normals=[[0,0,1],[-1,0,0],[0,0,-1],[1,0,0],[0,-1,0]];
    for(let i=0;i<5;i++)set[first+i].inward=normals[i];
    return first;
  }
  const curb=['#555955','#4c5050','#5e625c','#45474a'];
  const poles=['#3d4b51','#1c272c','#2a363a','#6f7c7c'];
  for (const x of [-30,30]) for(const z of [-34,34]) {
    box(sidewalks,x,z,47,55,0,.18,curb);
    for(let row=0;row<3;row++) for(let col=0;col<3;col++) {
      const bx=x+Math.sign(x)*(row-1)*15, bz=z+Math.sign(z)*(col-1)*17;
      const bw=9+rng()*4, bd=11+rng()*4, h=7+rng()*17;
      const style=[['#313a41','#243139','#384248','#454c51'],['#39383d','#2b333a','#333c42','#414b52'],['#273944','#263039','#31414b','#3a4249']][Math.floor(rng()*3)];
      box(city,bx,bz,bw,bd,.18,h,style);
      if(x>0&&z<0)blocks.push({x0:bx-bw/2,x1:bx+bw/2,z0:bz-bd/2,z1:bz+bd/2,top:.18+h,under:0});
      const nearShops=row<=1&&col<=1;
      if(nearShops){
        const tile=(row+col+(x>0?1:0))%2;
        if(row===0){
          const shopX=bx-Math.sign(x)*(bw/2+.025);
          labels.push({x:shopX,y:3.25,z:bz,axis:'z',width:2.5,text:['편의점','카페','약국','의원','치킨','학원'][(col+row+(x>0?2:0)+(z>0?3:0))%6],color:tile?'#ebdec7':'#e4ede9'});
        }
      }
      if(!nearShops&&(row===0||col===0)) {
        const colors=['#131e26','#202d35','#7e7964','#495e69','#a38c64','#394b54'];
        for(let y=2.6;y<h-.6;y+=2.65) for(let i=-1;i<=1;i++){
          const zz=bz-Math.sign(z)*(bd/2+.018), xx=bx-Math.sign(x)*(bw/2+.018);
          const wx=bx+i*bw*.26, wz=bz+i*bd*.26;
          const c=()=>colors[Math.floor(Math.pow(rng(),2)*colors.length)];
          face(city,c(),point(wx-1,y,zz),point(wx+1,y,zz),point(wx+1,y+1.15,zz),point(wx-1,y+1.15,zz));
          face(city,c(),point(xx,y,wz-1),point(xx,y,wz+1),point(xx,y+1.15,wz+1),point(xx,y+1.15,wz-1));
        }
      }
      if(!nearShops&&row===0&&col===0) {
        const xx=bx-Math.sign(x)*(bw/2+.07);
        face(city,'#607b83',point(xx,.5,bz-4),point(xx,.5,bz+4),point(xx,2.6,bz+4),point(xx,2.6,bz-4));
        for(let i=-3;i<=3;i+=1.5)box(city,xx,bz+i,.04,.06,.5,2.1,poles);
      }
    }
  }
  for(const side of [-1,1]){
    const center=side*49;
    for(const offset of [-.12,.12]){
      ground(paint,offset,center,.105,79,.013,'#c19c56');
      ground(paint,center,offset,79,.105,.013,'#c19c56');
    }
    for(const offset of [-6.02,6.02]){
      ground(paint,offset,center,.10,79,.014,'#838d8d');
      ground(paint,center,offset,79,.10,.014,'#838d8d');
    }
  }
  for (let i=0;i<10;i++){
    ground(paint,(Drive.crosswalk.from+Drive.crosswalk.to)/2,-5.42+i*1.18,Drive.crosswalk.to-Drive.crosswalk.from,.50,.016,'#c7d0cd');
    ground(paint,-10.25,-5.42+i*1.18,3.05,.50,.016,'#b4c1c0');
    ground(paint,-5.42+i*1.18,10.25,.50,3.05,.016,'#b4c1c0');
    ground(paint,-5.42+i*1.18,-9.1,.50,2.25,.016,'#b4c1c0');
  }
  ground(paint,3.03,-11.04,5.96,.45,.018,'#e0e5e1');
  ground(paint,Drive.crosswalk.from-.62,-2.04,.45,3.92,.018,'#d5ded9');
  ground(paint,Drive.crosswalk.to+.62,3.04,.45,5.92,.018,'#d5ded9');
  for(const z of [-27,-18.5]){
    const x=2.35,y=.017;
    const v=(dx,dz)=>point(x+dx,y,z+dz);
    face(paint,'#b8c4c1',v(-.14,-1.65),v(.14,-1.65),v(.14,.32),v(.73,.32),v(.73,-.03),v(1.36,.47),v(.73,.97),v(.73,.62),v(-.14,.62));
  }
  for(const side of [-1,1]){
    for(let p=43;p<99;p+=8){
      ground(paint,side*4.25,side*p,.105,3,.017,'#aab0a9');
      ground(paint,side*p,side*4.25,3,.105,.017,'#aab0a9');
    }
    ground(paint,side*4.25,side*27,.095,29,.017,'#aab0a9');
    ground(paint,side*27,side*4.25,29,.095,.017,'#aab0a9');
  }
  for(const z of [-34,-23]){
    const diamond=(x,dz)=>point(2.35+x,.016,z+dz);
    face(paint,'#bfc5bc',diamond(0,-1.45),diamond(.58,0),diamond(0,1.45),diamond(-.58,0));
    face(paint,'#343535',diamond(0,-1.15),diamond(.44,0),diamond(0,1.15),diamond(-.44,0));
  }
  for(const side of [-1,1]) for(let z=-79+(side>0?16:0);z<=86;z+=32){
    const x=side*6.75;
    box(city,x,z,.145,.145,.18,9,poles);
    box(city,x-side*1.02,z,2.04,.10,8.89,.095,poles);
    box(city,x-side*1.94,z,.61,.28,8.84,.13,['#c8d1cd','#fff0d7']);
    glow.push({x:x-side*1.94,y:8.88,z,c:'255,217,175',size:.65});
  }
  for(const side of [-1,1]) for(let x=-79+(side>0?16:0);x<=86;x+=32){
    if(Math.abs(x)<9)continue;
    const z=side*6.75;
    box(city,x,z,.145,.145,.18,9,poles);
    box(city,x,z-side*1.02,.10,2.04,8.89,.095,poles);
    box(city,x,z-side*1.94,.28,.61,8.84,.13,['#fff0d7','#c8d1cd']);
    glow.push({x,y:8.88,z:z-side*1.94,c:'255,217,175',size:.65});
  }
  for(const z of [-19.7,12.5]){
    const side=z<0?-1:1,x=6.68*side;
    box(city,x,z,.17,.17,.18,5.5,poles);
    box(city,x-side*3.4,z,6.85,.105,5.52,.12,poles);
    box(city,x-side*5.3,z,1.46,.26,5.23,.37,['#1c2120','#161b1c','#282b28']);
    for(let i=0;i<4;i++){
      const xx=x-side*5.3+(i-1.5)*.31;
      const color=['98,32,29','117,85,34','31,71,58','103,224,168'][i];
      glow.push({x:xx,y:5.405,z:z-side*.14,c:color,size:i===3?.23:.08,signal:true});
    }
  }
  for(const side of [-1,1]){
    for(let i=0;i<5;i++)box(city,side*(8.65+i*.72),6.68,.19,.19,.18,.62,['#878784','#646b69','#9da09a']);
    for(let z=28;z<61;z+=2){
      box(city,0,z,.08,.08,.03,.94,poles);
      box(city,0,z,.08,2,.72,.045,poles);
      box(city,.045,z,.018,.11,.71,.057,['#c8a65b','#ab8843']);
    }
  }
  box(city,-6.91,14,.16,.16,.18,5.9,poles);
  box(city,-4.8,14,4.15,.12,5.8,.085,poles);
  box(city,-3.7,14,2.3,.16,5.08,.68,['#335f81','#294659','#335f81']);
  labels.push({x:-3.7,y:5.41,z:13.89,axis:'x',width:2,text:'시청 ↑',color:'#f2f6ef'});
  for(const x of [7.14,8.2])for(const z of [18,21.25])box(city,x,z,.07,.07,.18,2.3,poles);
  box(city,7.65,19.63,1.41,3.6,2.42,.12,['#555954','#3b4648','#62635c']);
  box(city,8.17,21.16,.09,.74,.69,1.39,['#9caeab','#a1b3ae','#a8bab6']);
  labels.push({x:8.11,y:1.68,z:21.16,axis:'z',width:.65,text:'버스',color:'#243d49'});
  for(const x of [-13.55,Drive.crosswalk.to+.55]) for(const z of [-6.7,6.7]){
    box(city,x,z,.13,.13,.18,3.1,poles);
    box(city,x,z,.43,.35,2.48,.64,['#152329','#11191d']);
  }
  for(const [x,z] of [[-7.65,-33],[-7.65,-23],[-7.65,-13],[-7.65,19],[7.65,14],[7.65,33]]){
    box(city,x,z,.17,.17,.18,2.63,['#473d34','#322e29','#55473a']);
    trees.push({x,z,height:4.8});
  }
  for(const x of [-23,24]){
    box(city,x,87,9,9,.12,29,['#333e46','#2b363c','#3e4951']);
    labels.push({x,y:22,z:82.48,axis:'x',width:4,text:x<0?'101':'102',color:'#c1c4bf'});
    for(let floor=3;floor<26;floor+=3)for(const dx of [-2.6,0,2.6]){
      const zz=82.47,y=floor;
      face(city,(floor+dx)%3===0?'#a18d6a':'#28333b',point(x+dx-.6,y,zz),point(x+dx+.6,y,zz),point(x+dx+.6,y+.78,zz),point(x+dx-.6,y+.78,zz));
    }
  }
  const drops=Array.from({length:480},()=>[rng(),rng(),.45+rng(),rng()]);
  const puddles=Array.from({length:220},()=>{
    const x=(rng()-.5)*13,z=(rng()-.5)*160;
    return [rng()>.5?x:z,rng()>.5?z:x,.14+rng()*.55,.08+rng()*1.8,.015+rng()*.12];
  }).filter(([x,z])=>Math.abs(x)<6.4||Math.abs(z)<6.4);

  function create(canvas, {hud=true} = {}) {
    const ctx=canvas.getContext('2d',{alpha:false});
    // Demo rendering has one world pass: no scene copies, refraction masks,
    // reflection targets, bloom buffers, or rear-view scene renders.
    let wipeWasEnabled=false, wipeStartedAt=0;
    // Fog look is built from cached colours and small sprites made once: soft
    // halos around lights and their streaks on the damp road. Nothing samples
    // or re-renders the scene.
    const haloSprites=new Map(), streakSprites=new Map();
    let dimPedestrian=null;
    function pedestrianSprite(){
      if(dimPedestrian)return dimPedestrian;
      const image=images.pedestrian;
      if(!ready(image))return null;
      const sprite=Object.assign(document.createElement('canvas'),{width:image.naturalWidth,height:image.naturalHeight});
      const g=sprite.getContext('2d');
      g.drawImage(image,0,0);
      // Bake a subtle cool shadow into the sprite once, preserving its alpha.
      // Avoid a per-frame Canvas filter on the emulator.
      g.globalCompositeOperation='source-atop';
      g.fillStyle='rgba(8,17,24,.22)';
      g.fillRect(0,0,sprite.width,sprite.height);
      dimPedestrian=sprite;
      return sprite;
    }
    function sprite(cache,color,build){
      let image=cache.get(color);
      if(!image){image=build(color);cache.set(color,image);}
      return image;
    }
    function haloSprite(color){
      return sprite(haloSprites,color,c=>{
        const size=64,image=Object.assign(document.createElement('canvas'),{width:size,height:size});
        const g=image.getContext('2d'),fill=g.createRadialGradient(32,32,0,32,32,32);
        fill.addColorStop(0,'rgba('+c+',.55)');fill.addColorStop(.25,'rgba('+c+',.22)');
        fill.addColorStop(.6,'rgba('+c+',.06)');fill.addColorStop(1,'rgba('+c+',0)');
        g.fillStyle=fill;g.fillRect(0,0,size,size);
        return image;
      });
    }
    function streakSprite(color){
      return sprite(streakSprites,color,c=>{
        const image=Object.assign(document.createElement('canvas'),{width:16,height:96});
        const g=image.getContext('2d'),fill=g.createLinearGradient(0,0,0,96);
        fill.addColorStop(0,'rgba('+c+',0)');fill.addColorStop(.12,'rgba('+c+',.32)');
        fill.addColorStop(.5,'rgba('+c+',.14)');fill.addColorStop(1,'rgba('+c+',0)');
        g.fillStyle=fill;
        g.beginPath();g.ellipse(8,48,6,48,0,0,tau);g.fill();
        return image;
      });
    }
    const aggregate=document.createElement('canvas');
    aggregate.width=aggregate.height=128;
    const foliage=document.createElement('canvas');
    foliage.width=144;foliage.height=160;
    const leaves=foliage.getContext('2d');
    const colors=['#5d542e','#756343','#8b713d','#6f5d38','#82794b','#3d4832'];
    for(let i=0;i<1000;i++){
      const x=13+rng()*118,y=8+rng()*138;
      const ellipse=((x-71)/60)**2+((y-71)/67)**2;
      if(ellipse>.83+.13*Math.sin(x*.16)*Math.sin(y*.10))continue;
      const radius=1.3+rng()*4.0;
      leaves.fillStyle=colors[Math.floor(rng()*colors.length)];
      leaves.beginPath();leaves.ellipse(x,y,radius,radius*.64,rng()*Math.PI,0,tau);leaves.fill();
    }
    const textureContext=aggregate.getContext('2d');
    const pixels=textureContext.createImageData(128,128);
    for(let i=0;i<pixels.data.length;i+=4){
      const value=rng();
      pixels.data.set([value>.61?191:11,value>.61?191:13,value>.61?181:16,Math.round(value*18)],i);
    }
    textureContext.putImageData(pixels,0,0);
    let asphalt;
    const requested=new URLSearchParams(location.search).get('quality');
    let quality=Math.max(0,['high','medium','low'].indexOf(requested));
    let frameNumber=0, slowFrames=0, frameAverage=16.7, lastFrame=0, observedTime=0, weatherTime=0;
    let w=1,h=1,f=1,cx=0,cy=0,camera={},displayYaw=0,cornerYaw=0,view=0;
    // Camera moves are critically damped so the view eases in and settles
    // without the snap of a plain exponential follow.
    const motion={aim:{value:0,rate:0},look:{value:0,rate:0},corner:{value:0,rate:0},lead:{value:0,rate:0},pitch:{value:0,rate:0},hazard:{value:0,rate:0}};
    let lastSpeed=null;
    // Switching an indicator on turns the head that way for a moment, then the
    // view returns to the road and keeps only a slight bias toward that side.
    const glanceTime=1.9, glanceRest=.2;
    let glanceSignal=0, glanceAt=-Infinity;
    function ease(state,target,dt,omega){
      const step=Math.min(dt,.05);
      state.rate+=(omega*omega*(target-state.value)-2*omega*state.rate)*step;
      state.value+=state.rate*step;
      return state.value;
    }
    let viewWidth=0,viewHeight=0,resizeDirty=true,lastDpr=0,lastQuality=-1;
    let skyGradient=null;
    const roadStops=[[0,'#666b6e'],[.22,'#3f4446'],[.64,'#23292a'],[1,'#131a20']].map(([t,c])=>[t,gradedColor(c)]);
    function measure(){
      const width=canvas.clientWidth,height=canvas.clientHeight;
      if(width!==viewWidth||height!==viewHeight)resizeDirty=true;
      viewWidth=width;viewHeight=height;
    }
    new ResizeObserver(measure).observe(canvas);
    window.addEventListener('resize',measure);
    measure();
    function resize() {
      const dpr=devicePixelRatio||1;
      if(!resizeDirty&&dpr===lastDpr&&quality===lastQuality)return;
      resizeDirty=false;lastDpr=dpr;lastQuality=quality;
      const scale=Math.min(dpr,1.35,1440/Math.max(viewWidth,1),Math.sqrt(tiers[quality].pixels/Math.max(1,viewWidth*viewHeight)));
      const width=Math.max(1,Math.round(viewWidth*scale)),height=Math.max(1,Math.round(viewHeight*scale));
      if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;asphalt=ctx.createPattern(aggregate,'repeat');}
      w=width;h=height;
      skyGradient=gradient(0,0,0,h,[[0,'#2a3036'],[.25,'#4d5357'],[.43,'#6b7175'],[.6,'#595f63'],[1,'#2d3438']].map(([t,c])=>[t,gradedColor(c)]));
    }
    function cam(p) {
      const x=p.x-camera.x,z=p.z-camera.z;
      return {x:x*camera.cos-z*camera.sin,y:p.y-camera.y,z:x*camera.sin+z*camera.cos};
    }
    function screen(p) {return [cx+f*p.x/p.z,cy-f*p.y/p.z];}
    function clip(v){
      const clipped=[];
      for(let i=0;i<v.length;i++){
        const a=v[i],b=v[(i+1)%v.length];
        if(a.z>=.22)clipped.push(a);
        if((a.z>=.22)!==(b.z>=.22)){
          const t=(.22-a.z)/(b.z-a.z);
          clipped.push({x:lerp(a.x,b.x,t),y:lerp(a.y,b.y,t),z:.22});
        }
      }
      return clipped;
    }
    function poly(points, fill, stroke, width=1) {
      ctx.beginPath();ctx.moveTo(points[0][0],points[0][1]);
      for(let i=1;i<points.length;i++)ctx.lineTo(points[i][0],points[i][1]);
      ctx.closePath();
      if(fill){ctx.fillStyle=fill;ctx.fill();}if(stroke){ctx.lineWidth=width;ctx.strokeStyle=stroke;ctx.stroke();}
    }
    let pass=0;
    const faceQueue=[],byDepth=(a,b)=>b.depth-a.depth,batchCache=new WeakMap();
    function batchesFor(faces){
      let batches=faces.batches||batchCache.get(faces);
      if(batches)return batches;
      batches=[];
      let batch=null;
      for(let i=0;i<faces.length;i++){
        const item=faces[i],origin=item.v[0];
        const cellX=Math.floor(origin.x/16),cellZ=Math.floor(origin.z/16);
        if(!batch||batch.cellX!==cellX||batch.cellZ!==cellZ){
          batch={faces,start:i,end:i,cellX,cellZ,origin,x0:Infinity,y0:Infinity,z0:Infinity,x1:-Infinity,y1:-Infinity,z1:-Infinity,details:false};
          batches.push(batch);
        }
        batch.end=i+1;batch.details ||= Boolean(item.details||item.anchor);
        for(const p of item.v){
          batch.x0=Math.min(batch.x0,p.x);batch.x1=Math.max(batch.x1,p.x);
          batch.y0=Math.min(batch.y0,p.y);batch.y1=Math.max(batch.y1,p.y);
          batch.z0=Math.min(batch.z0,p.z);batch.z1=Math.max(batch.z1,p.z);
        }
      }
      for(const batch of batches){
        batch.ox=(batch.x0+batch.x1)/2-batch.origin.x;
        batch.oy=(batch.y0+batch.y1)/2-batch.origin.y;
        batch.oz=(batch.z0+batch.z1)/2-batch.origin.z;
        batch.radius=Math.hypot(batch.x1-batch.x0,batch.y1-batch.y0,batch.z1-batch.z0)/2;
      }
      batchCache.set(faces,batches);
      return batches;
    }
    function renderFaces(faces, sort, fog=true){
      const queue=faceQueue;
      queue.length=0;
      pass++;
      const leftPlane=Math.hypot(f,cx),rightPlane=Math.hypot(f,w-cx);
      const topPlane=Math.hypot(f,cy),bottomPlane=Math.hypot(f,h-cy);
      for(const batch of batchesFor(faces)){
        if(!batch.details){
          const dx=batch.origin.x+batch.ox-camera.x,dz=batch.origin.z+batch.oz-camera.z,r=batch.radius;
          const depth=dx*camera.sin+dz*camera.cos,lateral=dx*camera.cos-dz*camera.sin,vertical=batch.origin.y+batch.oy-camera.y;
          if(depth+r<.22||depth-r>100||
              f*lateral+cx*depth < -r*leftPlane||(w-cx)*depth-f*lateral < -r*rightPlane||
              cy*depth-f*vertical < -r*topPlane||(h-cy)*depth+f*vertical < -r*bottomPlane)continue;
        }
        for(let faceIndex=batch.start;faceIndex<batch.end;faceIndex++){
          const item=batch.faces[faceIndex];
          const {v,color,inward,anchor}=item;
          if(anchor){
            // Surface details follow the visibility and depth of their parent.
            if(anchor.seen!==pass)continue;
          }else if(inward){
            const p=v[0];
            if((camera.x-p.x)*inward[0]+(camera.y-p.y)*inward[1]+(camera.z-p.z)*inward[2]>0)continue;
          }
          // Each face keeps its small work buffers across frames and passes.
          // This avoids per-corner allocation without per-vertex cache lookups.
          let projected=item.projection;
          if(!projected){
            const vs=v.map(()=>({x:0,y:0,z:0})),screenVertices=v.map(()=>[0,0]);
            projected=item.projection={vs,screenVertices,ps:screenVertices,color,fogDepth:0,depth:0};
          }
          const vs=projected.vs;
          let near=Infinity,far=-Infinity,own=0;
          for(let i=0;i<v.length;i++){
            const source=v[i],p=vs[i],dx=source.x-camera.x,dz=source.z-camera.z;
            p.x=dx*camera.cos-dz*camera.sin;p.y=source.y-camera.y;p.z=dx*camera.sin+dz*camera.cos;
            near=Math.min(near,p.z);far=Math.max(far,p.z);own+=p.z;
          }
          if(far<.22||near>100)continue;
          own/=vs.length;
          let ps=projected.screenVertices;
          if(near<.22)ps=clip(vs).map(screen);
          else for(let i=0;i<vs.length;i++){
            const p=vs[i],out=ps[i];
            out[0]=cx+f*p.x/p.z;out[1]=cy-f*p.y/p.z;
          }
          if(item.details){item.seen=pass;item.depth=own;}
          if(ps.every(p=>p[0]<0)||ps.every(p=>p[0]>w)||ps.every(p=>p[1]<0)||ps.every(p=>p[1]>h))continue;
          projected.ps=ps;projected.fogDepth=own;
          projected.depth=anchor?anchor.depth-.0005*(item.order||1):own;
          queue.push(projected);
        }
      }
      if(sort)queue.sort(byDepth);
      for(const o of queue){
        const visibility=fog?Math.exp(-FOG*Math.max(0,o.fogDepth)) : 1;
        const solid=hazedColor(o.color,visibility);
        if(solid){ctx.globalAlpha=1;poly(o.ps,solid);}
        else{ctx.globalAlpha=visibility;poly(o.ps,gradedColor(o.color));}
      }
      ctx.globalAlpha=1;
    }
    function gradient(x0,y0,x1,y1,stops){
      const g=ctx.createLinearGradient(x0,y0,x1,y1);
      for(const [a,b] of stops)g.addColorStop(a,b);
      return g;
    }
    function light(x,y,r,c,a=.24){
      // A small solid bulb replaces wide gradients, blur and additive bloom.
      r=Math.min(r,3);
      if(r<1||x+r<0||x-r>w||y+r<0||y-r>h)return;
      const alpha=ctx.globalAlpha;
      ctx.globalAlpha=alpha*a;ctx.fillStyle='rgb('+c+')';
      ctx.beginPath();ctx.arc(x,y,r,0,tau);ctx.fill();
      ctx.globalAlpha=alpha;
    }
    const vehicleBodies=[];
    function parkedVehicle(run){
      if(vehicleBodies[run.vehicle])return vehicleBodies[run.vehicle];
      const kinds=[
        {size:[6.1,2.35,2.64],cab:'#566872',body:['#69747a','#3d5059','#7a8789','#858f91']},
        {size:[7,2.37,2.75],cab:'#536268',body:['#696e61','#4f5854','#73796d','#818679']},
        {size:[4.3,1.82,1.22],cab:'#565c6a',body:['#53616b','#36464f','#5d6770','#808995']}
      ];
      const v=kinds[run.vehicle], [length,width,height]=v.size;
      const {rear,front,edge}=Drive.parked(run.vehicle);
      const x=rear+length/2,z=edge-width/2;
      return vehicleBodies[run.vehicle]={length,width,height,x,z,cab:v.cab,body:v.body,rear,front,
        box:{x0:rear,x1:front,z0:edge-width,z1:edge,top:height+.36,under:.5}};
    }
    function taxi(set,z){
      const x=-2.38;
      const profile=[
        [-1.94,.63,.78,.37],[-1.65,.76,.88,.33],[-.85,.83,.89,.31],
        [-.35,1.31,.73,.31],[.58,1.37,.71,.31],[1.10,.91,.86,.31],
        [1.64,.82,.86,.33],[1.91,.65,.76,.39]
      ];
      const sections=profile.map(([dz,top,width,bottom])=>[
        point(x-width*.96,bottom,z+dz),point(x-width,.65,z+dz),point(x-width*.77,top,z+dz),
        point(x+width*.77,top,z+dz),point(x+width,.65,z+dz),point(x+width*.96,bottom,z+dz)
      ]);
      const amber=['#995223','#a75d2c','#c5874b','#9a562d','#774322'];
      for(let i=0;i<sections.length-1;i++){
        const a=sections[i],b=sections[i+1];
        for(let j=0;j<5;j++){
          const glass=i>=2&&i<=4&&j>=1&&j<=3&&!(i===3&&j===2);
          face(set,glass?'#273e47':amber[j],a[j],b[j],b[j+1],a[j+1]);
        }
      }
      face(set,'#8c4e2a',...sections[0]);face(set,'#7a472e',...sections.at(-1));
      for(const side of [-1,1])for(const dz of [-1.12,1.14]){
        for(const [r,color,offset] of [[.31,'#171d20',.85],[.17,'#646b6a',.856],[.075,'#3c4548',.861]]){
          const vertices=Array.from({length:12},(_,i)=>point(x+side*offset,.32+Math.sin(i*tau/12)*r,z+dz+Math.cos(i*tau/12)*r));
          face(set,color,...vertices);
        }
      }
      for(const xx of [x-.6,x+.6]){
        box(set,xx,z-1.948,.38,.028,.56,.10,['#f3f6e9','#dbefe9']);
        box(set,xx,z+1.922,.34,.025,.53,.10,['#df5146','#a82b24']);
      }
      box(set,x,z-1.952,.40,.021,.419,.092,['#c4c9bd','#bec1bb']);
      box(set,x,z+.23,.49,.22,1.35,.105,['#e5dfae','#98966b','#e3dca6','#f4eabb']);
    }
    function decal(set,parent,color,points,order=1){
      parent.details=true;
      set.push({color,v:points,anchor:parent,order});
    }
    function wheel(list,xx,wheelZ,side,radius){
      const ring=(depth,r)=>Array.from({length:16},(_,i)=>{
        const angle=i*tau/16;
        return point(xx+Math.cos(angle)*r,radius+Math.sin(angle)*r,wheelZ+side*depth);
      });
      const outer=ring(.17,radius),inner=ring(-.15,radius);
      for(let i=0;i<outer.length;i++){
        const next=(i+1)%outer.length;
        face(list,i%4===0?'#22282b':'#15191c',outer[i],outer[next],inner[next],inner[i]);
      }
      face(list,'#1b2022',...outer);
      const tyre=list.at(-1);
      decal(list,tyre,'#0f1214',ring(.171,radius*.80),1);
      decal(list,tyre,'#565f62',ring(.172,radius*.56),2);
      decal(list,tyre,'#343c40',ring(.173,radius*.44),3);
      decal(list,tyre,'#7b8483',ring(.174,radius*.21),4);
      for(let i=0;i<6;i++){
        const angle=i*tau/6,r=radius*.34,size=radius*.05;
        const bx=xx+Math.cos(angle)*r,by=radius+Math.sin(angle)*r,bz=wheelZ+side*.175;
        decal(list,tyre,'#aeb4b1',[point(bx-size,by-size,bz),point(bx+size,by-size,bz),point(bx+size,by+size,bz),point(bx-size,by+size,bz)],5);
      }
    }
    // A delivery box truck with enough surface detail to read as a real
    // vehicle when the driver pulls up behind it and then passes alongside.
    function boxTruck(list,{length,width,x,z,cab}){
      const rear=x-length/2,front=x+length/2,kerb=z-width/2,roadside=z+width/2;
      const deck=.86,top=3.0;
      const first=box(list,x,z,length,width,deck,top-deck,['#556168','#636f76','#515e65','#727d82']);
      const back=list[first+3],flank=list[first+2];
      const R=(z0,y0,z1,y1,color,order=1)=>decal(list,back,color,[point(rear-.012,y0,z0),point(rear-.012,y0,z1),point(rear-.012,y1,z1),point(rear-.012,y1,z0)],order);
      const S=(x0,y0,x1,y1,color,order=1)=>decal(list,flank,color,[point(x0,y0,roadside+.012),point(x1,y0,roadside+.012),point(x1,y1,roadside+.012),point(x0,y1,roadside+.012)],order);
      // Rear doors: shaded panels, frame, seam, lock rods, hinges and marker tape.
      const inner0=kerb+.10,inner1=roadside-.10;
      R(inner0,deck+.10,inner1,deck+.78,'#566268',1);
      R(inner0,deck+.78,inner1,top-1.0,'#606c73',1);
      R(inner0,top-1.0,inner1,top-.11,'#69757b',1);
      R(kerb,top-.11,roadside,top,'#8f9a9b',2);
      R(kerb,deck,roadside,deck+.10,'#2a3236',2);
      R(kerb,deck,inner0,top,'#838e90',2);R(inner1,deck,roadside,top,'#838e90',2);
      R(z-.022,deck+.10,z+.022,top-.11,'#333d41',3);
      for(const offset of [-.80,-.30,.30,.80]){
        const zz=z+offset;
        R(zz-.02,deck+.03,zz+.02,top-.05,'#a4adab',4);
        R(zz-.012,deck+.03,zz-.004,top-.05,'#6d787b',5);
        for(const y of [deck+.34,(deck+top)/2,top-.38])R(zz-.07,y,zz+.07,y+.055,'#5c676b',5);
      }
      for(const offset of [-.30,.30]){
        const zz=z+offset,toward=Math.sign(offset);
        R(zz-toward*.02,1.38,zz-toward*.27,1.44,'#b5bdb9',6);
        R(zz-toward*.25,1.33,zz-toward*.29,1.49,'#2f383c',7);
      }
      for(const y of [deck+.22,deck+.82,top-.86,top-.28]){
        R(kerb+.015,y,kerb+.17,y+.075,'#566165',5);
        R(roadside-.17,y,roadside-.015,y+.075,'#566165',5);
      }
      for(let i=0;i<12;i++){
        const z0=kerb+.05+i*(width-.10)/12;
        R(z0,deck+.014,z0+(width-.10)/12,deck+.086,i%2?'#d8d6c8':'#b83428',4);
      }
      R(kerb+.2,top-.42,kerb+.62,top-.25,'#bcc3bc',4);
      for(let i=0;i<3;i++)R(kerb+.24+i*.12,top-.385,kerb+.32+i*.12,top-.285,'#3b4549',5);
      // Roadside flank: rails, panel seams, a livery band and road grime.
      S(rear,deck+.12,front,deck+.64,'#48545b',1);
      S(rear,deck+.64,front,deck+1.02,'#4e5a61',1);
      S(rear,1.86,front,2.16,'#236870',2);
      S(rear,2.16,front,2.205,'#aeb7b3',2);
      S(rear,1.815,front,1.86,'#184a51',2);
      S(rear,top-.10,front,top,'#8a9596',3);
      S(rear,deck,front,deck+.12,'#2c3438',3);
      S(rear,deck,rear+.10,top,'#7d898b',3);S(front-.10,deck,front,top,'#7d898b',3);
      for(let i=1;i<10;i++){
        const xx=rear+i*length/10;
        S(xx-.012,deck+.12,xx+.012,top-.10,'#434e55',4);
        S(xx+.012,deck+.12,xx+.03,top-.10,'#67737a',4);
      }
      for(const dx of [.5,length*.5,length-.5])S(rear+dx-.07,deck+.03,rear+dx+.07,deck+.09,'#dd9c47',5);
      S(front-1.75,2.34,front-.55,2.74,'#b9c0ba',4);
      for(let i=0;i<4;i++)S(front-1.62+i*.27,2.44,front-1.44+i*.27,2.64,i===3?'#236870':'#3b4549',5);
      // Chassis, tail beam with lamp clusters, plate, under-run bar and mud flaps.
      box(list,x-.2,z,length-.9,width-.5,.52,deck-.52,['#1b2226','#161c1f']);
      const beam=box(list,rear+.08,z,.14,width-.04,.52,deck-.52,['#20272b','#262e32']);
      const tail=list[beam+3];
      const T=(z0,y0,z1,y1,color,order=1)=>decal(list,tail,color,[point(rear,y0,z0),point(rear,y0,z1),point(rear,y1,z1),point(rear,y1,z0)],order);
      for(const side of [-1,1]){
        const edge=z+side*(width/2-.08);
        T(edge,.575,edge-side*.50,.79,'#0e1214',1);
        T(edge-side*.02,.60,edge-side*.24,.765,'#e2443a',2);
        T(edge-side*.26,.60,edge-side*.37,.765,'#b77a2c',2);
        T(edge-side*.39,.60,edge-side*.48,.765,'#a3a89e',2);
        box(list,rear+.28,z+side*width*.36,.03,.44,.13,.47,['#14181a','#101315']);
      }
      T(z-.26,.60,z+.26,.735,'#b39c3d',2);
      T(z-.245,.612,z+.245,.723,'#c2ac4c',3);
      for(let i=0;i<7;i++)T(z-.20+i*.062,.635,z-.165+i*.062,.70,'#2e3024',4);
      box(list,rear+.05,z,.07,width-.16,.31,.10,['#3a4246','#434c50','#3a4246','#525b5e']);
      for(const side of [-1,1])box(list,rear+.06,z+side*width*.27,.06,.06,.41,.12,['#2d3539','#333b3f']);
      for(const side of [-1,1])box(list,x+.25,z+side*(width/2-.03),length*.36,.04,.42,.10,['#2a3236','#30383c']);
      // Cab ahead of the cargo box.
      const cabX=front+1.02;
      const cabFirst=box(list,cabX,z,1.80,width-.06,.50,1.98,[cab,'#3c4d57','#5f727c','#74838a']);
      const door=list[cabFirst+2];
      const C=(x0,y0,x1,y1,color,order=1)=>decal(list,door,color,[point(x0,y0,roadside-.018),point(x1,y0,roadside-.018),point(x1,y1,roadside-.018),point(x0,y1,roadside-.018)],order);
      C(cabX-.62,1.52,cabX+.60,2.26,'#17242c',1);
      C(cabX-.62,1.52,cabX+.60,1.56,'#67737a',2);
      C(cabX-.70,.70,cabX-.68,2.30,'#34434c',2);
      C(cabX-.50,1.30,cabX-.30,1.35,'#c5ccca',2);
      C(cabX-.86,.50,cabX+.86,.66,'#20282c',2);
      box(list,front+.10,z,.16,width-.2,1.0,1.95,['#263036','#2c373d']);
      box(list,cabX+.93,z,.08,width-.3,.42,.22,['#2a3236','#353e42']);
      for(const side of [-1,1]){
        const wheelZ=z+side*width*.43;
        wheel(list,rear+1.38,wheelZ,side,.42);
        wheel(list,cabX+.12,wheelZ,side,.42);
      }
    }
    const parkedFaces=new Map(), trafficFaces=new Map();
    const taxiFaces=[];
    taxi(taxiFaces,0);
    const taxiVertices=Array.from(new Set(taxiFaces.flatMap(item=>item.v)));
    const taxiZ=taxiVertices.map(vertex=>vertex.z);
    const worldFaces=[],worldBatches=new WeakMap();
    function parkedGeometry(run){
      const list=[];
      const {length,width,height,x,z,cab,body}=parkedVehicle(run);
      box(list,x,z,length,width,.59,height-.24,body);
      box(list,x,z,length,width-.29,.37,.19,['#222d34','#1a2227']);
      box(list,x-length*.505,z,length*.02,width,.42,.13,['#45535b','#3a464d']);
      for(const offset of [-.32,.32]){
        const zz=z+offset*width;
        box(list,x-length*.508,zz,.025,.31,.42,.18,['#ef6c55','#9e382e']);
      }
      if(run.vehicle!==0)box(list,x-length*.511,z,.015,.44,.80,.14,['#c4c5b5','#b9bdaf']);
      if(run.vehicle===0){
        for(const zPart of [-.48,-.23,0,.23,.48]){
          box(list,x-length*.504,z+width*zPart,.023,.025,.8,1.82,['#9ba3a3','#58646d']);
        }
        const rear=x-length*.5;
        box(list,rear-.025,z,.049,width-.10,2.45,.045,['#a5afac','#7f898c']);
        box(list,rear-.030,z,.048,.037,.69,1.76,['#3f494c','#596162']);
        for(const side of [-1,1]){
          const zz=z+side*width*.26;
          box(list,rear-.034,zz,.052,.028,.84,1.50,['#b7bbb3','#737d7f']);
          box(list,rear-.062,zz,.055,.24,1.03,.055,['#c6c8be','#687378']);
          for(const y of [.82,1.57,2.28]){
            box(list,rear-.037,z+side*width*.44,.065,.15,y,.055,['#aab1ad','#717b7e']);
          }
          for(let i=0;i<4;i++){
            box(list,rear-.05,z+side*(.47+i*.11),.034,.10,.64,.045,[i%2?'#c6c1a0':'#a74636','#704336']);
          }
        }
        box(list,rear-.05,z, .07,.52,.77,.165,['#191f23','#2a3438']);
        box(list,rear-.092,z,.011,.39,.80,.10,['#d8dac8','#b8bfaf']);
        for(let i=0;i<6;i++)box(list,rear-.10,z-.13+i*.047,.012,.021,.825,.042,['#383f42','#3f484a']);
      }
      box(list,x-1.05,z,length*.52,width+.025,.51,.16,['#182025','#141b20']);
      if(run.vehicle===0)box(list,x+length*.52,z,1.42,width,.48,1.92,[cab,'#31434e','#52656f','#77858a']);
      if(run.vehicle!==0 || length>5){
        const count=run.vehicle===1?5:run.vehicle===2?2:1;
        for(let i=0;i<count;i++)box(list,x+(run.vehicle===0?length*.55:-length*.30+i*length*.15),z+width*.502,run.vehicle===0?.7:length*.115,.025,run.vehicle===2?1.38:1.72,run.vehicle===2?.32:.55,['#203442','#1e303a','#3b4c54']);
      }
      if(run.vehicle===0){
        for(let i=0;i<9;i++)box(list,x-length*.46+i*.48,z+width*.503,.037,.024,.8,height-.64,['#829399','#607079']);
      }
      for(const xx of [x-length*.33,x+length*.32])for(const side of [-1,1]){
        const wheelZ=z+side*width*.43;
        const radius=run.vehicle===2?.32:.40;
        const ring=(depth,r)=>Array.from({length:16},(_,i)=>{
          const angle=i*tau/16;
          return point(xx+Math.cos(angle)*r,radius+Math.sin(angle)*r,wheelZ+side*depth);
        });
        const outer=ring(.17,radius),inner=ring(-.15,radius);
        for(let i=0;i<outer.length;i++){
          const next=(i+1)%outer.length;
          face(list,i%4===0?'#293034':'#1b2124',outer[i],outer[next],inner[next],inner[i]);
        }
        face(list,'#252b2d',...outer);
        face(list,'#8a9190',...ring(.187,radius*.54));
        face(list,'#40494d',...ring(.20,radius*.42));
        face(list,'#b4bab7',...ring(.208,radius*.22));
        for(let i=0;i<5;i++){
          const angle=i*tau/5;
          const boltX=xx+Math.cos(angle)*radius*.34;
          const boltY=radius+Math.sin(angle)*radius*.34;
          box(list,boltX,wheelZ+side*.212,.026,.014,boltY,.026,['#9ba2a0','#a8afad']);
        }
      }
      for(const zz of [z-width*.36,z+width*.36])box(list,x-length*.505,zz,.035,.31,.61,.18,['#db5148','#862822']);
      return list;
    }
    function traffic(run){
      let parked=parkedFaces.get(run.vehicle);
      if(!parked){
        const body=parkedVehicle(run);
        if(run.vehicle===0){parked=[];boxTruck(parked,body);}
        else parked=parkedGeometry(run);
        parkedFaces.set(run.vehicle,parked);
      }
      const passingZ=17-run.t*5.9;
      if(passingZ<=-52)return parked;
      for(let i=0;i<taxiVertices.length;i++)taxiVertices[i].z=taxiZ[i]+passingZ;
      let list=trafficFaces.get(run.vehicle);
      if(!list){
        list=parked.concat(taxiFaces);
        list.batches=batchesFor(parked).concat(batchesFor(taxiFaces));
        trafficFaces.set(run.vehicle,list);
      }
      return list;
    }
    function occludingDepth(screenX,box){
      const lateral=(screenX-cx)/f;
      const dx=camera.sin+lateral*camera.cos,dz=camera.cos-lateral*camera.sin;
      const xMin=box.x0-camera.x,xMax=box.x1-camera.x;
      const zMin=box.z0-camera.z,zMax=box.z1-camera.z;
      if(Math.abs(dx)<1e-6&&(xMin>0||xMax<0))return null;
      if(Math.abs(dz)<1e-6&&(zMin>0||zMax<0))return null;
      const x0=Math.abs(dx)<1e-6?-Infinity:Math.min(xMin/dx,xMax/dx);
      const x1=Math.abs(dx)<1e-6?Infinity:Math.max(xMin/dx,xMax/dx);
      const z0=Math.abs(dz)<1e-6?-Infinity:Math.min(zMin/dz,zMax/dz);
      const z1=Math.abs(dz)<1e-6?Infinity:Math.max(zMin/dz,zMax/dz);
      const near=Math.max(.22,x0,z0),far=Math.min(x1,z1);
      return far>near?[near,far]:null;
    }
    // The band of screen rows a box hides at one column, for a subject at the given depth.
    function hiddenRows(screenX,box,depth){
      const interval=occludingDepth(screenX,box);
      if(!interval||interval[0]>=depth)return null;
      const near=interval[0],far=Math.min(interval[1],depth);
      const top=cy-f*(box.top-camera.y)/near;
      const bottom=box.under?Math.max(cy+f*(camera.y-box.under)/near,cy+f*(camera.y-box.under)/far):Infinity;
      return [top,bottom];
    }
    function behindVehicle(p,sx,sy,truck){
      const rows=hiddenRows(sx,truck.box,p.z);
      return Boolean(rows)&&sy>rows[0]&&sy<rows[1];
    }
    function walkerPlace(ped){
      const p=cam(point(ped.x,ped.z<Drive.obstruction.kerb?.185:.035,ped.z));
      if(p.z<.4)return null;
      const [x,y]=screen(p),image=images.pedestrian;
      const height=1.97*f/p.z,width=height*image.naturalWidth/image.naturalHeight;
      return {p,x,y,height,width};
    }
    // The visible parts of one sprite column once the parked vehicle and the
    // buildings on that corner have been taken out of it.
    function visibleRows(screenX,depth,top,bottom,truck){
      let spans=[[top,bottom]];
      for(let index=-1;index<blocks.length;index++){
        const box=index<0?truck.box:blocks[index];
        const rows=hiddenRows(screenX,box,depth);
        if(!rows)continue;
        const next=[];
        for(const [from,to] of spans){
          const before=Math.min(to,rows[0]),after=Math.max(from,rows[1]);
          if(rows[0]>from&&before-from>.5)next.push([from,before]);
          if(rows[1]<to&&to-after>.5)next.push([after,to]);
        }
        spans=next;
        if(!spans.length)break;
      }
      return spans;
    }
    // A long shadow thrown across the road by the lit shopfronts behind the
    // pedestrian. It reaches the crossing before the pedestrian does.
    function walkerShadow(run){
      const ped=Drive.pedestrian(run);
      if(!ped||ped.z>1)return;
      // Low shop lighting stretches the shadow well past the kerb line.
      const strength=clamp((1-ped.z)/6,0,1),reach=1.2+3.6*clamp((-1.5-ped.z)/5,0,1);
      const ground=(dx,dz)=>cam(point(ped.x+dx,.022,ped.z+dz));
      const lean=-.11*reach;
      const outline=[ground(-.2,.05),ground(.2,.05),ground(.34+lean,reach*.8),ground(.62+lean,reach*.86),
        ground(.5+lean,reach),ground(-.5+lean,reach),ground(-.62+lean,reach*.86),ground(-.34+lean,reach*.8)];
      if(outline.some(p=>p.z<.5))return;
      const points=outline.map(screen);
      const fade=ctx.createLinearGradient(...points[0],...points[4]);
      fade.addColorStop(0,'rgba(2,5,7,'+(.5*strength)+')');
      fade.addColorStop(.75,'rgba(2,5,7,'+(.36*strength)+')');
      fade.addColorStop(1,'rgba(2,5,7,'+(.2*strength)+')');
      poly(points,fade);
    }
    function crossingLight(){
      const spot=cam(point(Drive.crosswalk.from+1.1,.022,-4.2));
      if(spot.z<1.2||spot.z>45)return;
      const [sx,sy]=screen(spot);
      ctx.save();ctx.translate(sx,sy);ctx.scale(1,.24);
      light(0,0,f*3.8/spot.z,'255,214,160',.24*Math.exp(-spot.z*.02));
      ctx.restore();
    }
    function drawWalker(run,truck){
      const ped=Drive.pedestrian(run);
      if(!ped)return;
      const image=pedestrianSprite();
      if(!image)return;
      const place=walkerPlace(ped);
      if(!place)return;
      const {p,x,y,height,width}=place;
      const step=Math.sin(ped.step*10),sway=run.result?0:step*width*.024;
      const left=x-width/2+sway,top=y-height+Math.abs(step)*height*.009;
      const start=Math.max(0,left),end=Math.min(w,left+width);
      if(end<=start)return;
      const open=visibleRows(x,p.z,y-height*.2,y,truck).length>0;
      if(!ped.cue&&open){
        ctx.save();ctx.translate(x,y);ctx.scale(1,.2);
        const shade=ctx.createRadialGradient(0,0,0,0,0,width*.5);
        shade.addColorStop(0,'rgba(3,7,9,.6)');shade.addColorStop(1,'rgba(3,7,9,0)');
        ctx.fillStyle=shade;ctx.fillRect(-width*.5,-width*.5,width,width);
        ctx.restore();
      }
      ctx.save();
      ctx.beginPath();
      // Draw only the parts of the pedestrian whose sightline clears the
      // parked vehicle and the corner buildings.
      let any=false;
      for(let column=start;column<end;column+=2){
        const stripe=Math.min(2,end-column);
        for(const [from,to] of visibleRows(column+stripe/2,p.z,top,top+height,truck)){
          ctx.rect(column,from,stripe,to-from);any=true;
        }
      }
      if(!any){ctx.restore();return;}
      ctx.clip();
      // The sprite walks toward screen-left: mirror it when heading the other way.
      if(ped.heading[0]*camera.cos-ped.heading[1]*camera.sin>.05){
        ctx.translate(x,0);ctx.scale(-1,1);ctx.translate(-x,0);
      }
      ctx.globalAlpha=clamp(Math.exp(-FOG*.8*p.z),.32,1);
      ctx.drawImage(image,left,top,width,height);
      ctx.restore();
    }
    function wetHighlights() {
      // Fixed world-space marks suggest wet asphalt without another world pass.
      for(let i=0;i<puddles.length;i+=4){
        const [x,z,sx,sz,alpha]=puddles[i],p=cam(point(x,.02,z));
        if(p.z<1||p.z>57)continue;
        const [xx,yy]=screen(p);if(xx<0||xx>w||yy>h)continue;
        ctx.fillStyle='rgba(158,188,197,'+alpha+')';
        ctx.fillRect(xx,yy,Math.max(.5,f*sx/p.z),Math.max(.5,f*sz/p.z/p.z));
      }
    }
    function drawLabels(){
      for(const label of labels){
        const p=cam(label);
        if(p.z<2||p.z>41)continue;
        const [x,y]=screen(p),size=clamp(f*.34/p.z,4,32);
        if(x<0||x>w||y<0||y>h)continue;
        ctx.globalAlpha=Math.exp(-FOG*1.2*p.z)*.88;
        ctx.font='600 '+size+'px system-ui,sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
        const bw=Math.min(f*label.width/p.z,ctx.measureText(label.text).width+size);
        ctx.fillStyle='#263132d9';ctx.fillRect(x-bw/2,y-size*.69,bw,size*1.38);
        ctx.fillStyle=label.color;ctx.fillText(label.text,x,y,bw*.94);
      }
      ctx.globalAlpha=1;
    }
    function drawTrees(){
      for(const tree of trees){
        const p=cam(point(tree.x,tree.height,tree.z));
        if(p.z<1.3||p.z>51)continue;
        const [x,y]=screen(p),size=f*3.3/p.z;
        if(x+size<0||x-size>w||y+size<0||y>h)continue;
        ctx.globalAlpha=Math.exp(-p.z*FOG)*.83;
        ctx.drawImage(foliage,x-size*.47,y,size,size*1.04);
      }
      ctx.globalAlpha=1;
    }
    function halo(x,y,r,c,a){
      if(r<2||a<.02||x+r<0||x-r>w||y+r<0||y-r>h)return;
      ctx.globalAlpha=a;ctx.drawImage(haloSprite(c),x-r,y-r,r*2,r*2);ctx.globalAlpha=1;
    }
    function roadStreak(x,z,width,c,a){
      // Reflection of a light on the wet road: a soft vertical smear.
      const p=cam(point(x,.02,z));if(p.z<1.5||p.z>60)return;
      const [sx,sy]=screen(p),sw=Math.max(2,f*width/p.z),sh=Math.min(h*.45,sw*7);
      if(sx+sw<0||sx-sw>w||sy>h)return;
      ctx.globalAlpha=a*Math.exp(-p.z*.02);
      ctx.drawImage(streakSprite(c),sx-sw/2,sy-sh*.12,sw,sh);
      ctx.globalAlpha=1;
    }
    function lampHalos(truck){
      for(const {x,y,z,c,size,signal} of glow){
        const p=cam(point(x,y,z));if(p.z<.5||p.z>86)continue;
        const [sx,sy]=screen(p),r=Math.min(w*.09,f*size*4/p.z);
        if(truck&&behindVehicle(p,sx,sy,truck))continue;
        halo(sx,sy,Math.min(w*.07,r*2),c,(signal?.75:.62)*Math.exp(-p.z*.009));
        if(!signal||size>.2)roadStreak(x,z,signal?.35:.55,c,signal?.55:.45);
        light(sx,sy,Math.max(1,r*.21),c,signal?.79:.86);
      }
    }
    function vehicleLights(run,truck){
      const passingZ=17-run.t*5.9;
      for(const x of [-2.98,-1.78]){
        const p=cam(point(x,.64,passingZ-1.96));
        if(camera.z<passingZ-1.96&&p.z>1&&p.z<50){
          const [sx,sy]=screen(p);halo(sx,sy,Math.min(w*.05,f*.5/p.z),'183,237,252',.5);light(sx,sy,f*.10/p.z,'183,237,252',.8);
        }
      }
      const lampY=run.vehicle===0?.68:.51,lampZ=run.vehicle===0?truck.width/2-.20:truck.width*.32;
      for(const side of [-1,1]){
        const p=cam(point(truck.rear-.04,lampY,truck.z+side*lampZ));
        if(camera.x<truck.rear&&p.z>1.3&&p.z<43){
          const [sx,sy]=screen(p);halo(sx,sy,Math.min(w*.05,f*.45/p.z),'248,73,47',.55);light(sx,sy,f*.10/p.z,'248,73,47',.8);
        }
      }
    }
    function road(run){
      const phase=run.result?run.t:weatherTime;
      ctx.fillStyle=skyGradient;ctx.fillRect(0,0,w,h);
      ctx.fillStyle=gradient(0,cy,0,h,roadStops);ctx.fillRect(0,cy,w,h-cy);
      if(asphalt){ctx.fillStyle=asphalt;ctx.fillRect(0,cy,w,h-cy);}
      const cars=traffic(run),truck=parkedVehicle(run);
      let batches=worldBatches.get(cars);
      if(!batches){batches=batchesFor(city).concat(batchesFor(cars));worldBatches.set(cars,batches);}
      worldFaces.batches=batches;
      wetHighlights();
      renderFaces(paint,false);
      crossingLight();
      walkerShadow(run);
      renderFaces(sidewalks,true);
      renderFaces(worldFaces,true);
      drawTrees();
      drawLabels();
      const ped=Drive.pedestrian(run);
      if(ped?.cue){
        const spot=cam(point(ped.x,.2,ped.z));
        if(spot.z>1){
          const [sx,sy]=screen(spot);
          if(!behindVehicle(spot,sx,sy,truck)){
            ctx.save();ctx.translate(sx,sy);ctx.scale(1,.25);
            light(0,0,f*.62/spot.z,'241,228,190',.14);ctx.restore();
          }
        }
      }
      drawWalker(run,truck);
      vehicleLights(run,truck);
      lampHalos(truck);
      const flash=Math.floor(run.t*3)%2===0;
      for(const x of [Drive.crosswalk.to+.55,-13.55])for(const z of [-6.51,6.49]){
        const p=cam(point(x,2.83,z));if(p.z<1)continue;
        const [sx,sy]=screen(p);
        if(behindVehicle(p,sx,sy,truck))continue;
        light(sx,sy,Math.max(4,f*.44/p.z),'94,255,175',flash?.65:.12);
        const size=f*.14/p.z;
        if(size>1){
          const tint=flash?'#b1ffcc':'#427d66';
          ctx.strokeStyle=tint;ctx.fillStyle=tint;ctx.lineWidth=Math.max(1,size*.26);ctx.lineCap='round';
          ctx.beginPath();ctx.arc(sx,sy-size*.65,Math.max(.6,size*.28),0,tau);ctx.fill();
          ctx.beginPath();ctx.moveTo(sx,sy-size*.26);ctx.lineTo(sx,sy+size*.34);
          ctx.lineTo(sx+size*.38,sy+size*.78);ctx.moveTo(sx,sy+size*.34);
          ctx.lineTo(sx-size*.28,sy+size*.88);ctx.moveTo(sx-size*.42,sy+size*.1);
          ctx.lineTo(sx,sy-size*.15);ctx.lineTo(sx+size*.44,sy+size*.04);ctx.stroke();
        }
      }
      rain(run,phase);
    }
    function rain(run,phase){
      // One batched path keeps rain readable without sampling the scene.
      // Light drizzle: a few faint streaks close to the car.
      const count=Math.floor(26*tiers[quality].rain);
      ctx.lineCap='round';ctx.lineWidth=1.1*clamp(w/1280,.6,1.5);ctx.strokeStyle='rgba(216,229,233,.2)';
      ctx.beginPath();
      for(let i=0;i<count;i++){
        const [rx,ry,size,seed]=drops[i];
        if(seed>run.rain*.84)continue;
        const z=1.6+wrap(rx*29-run.s,14),x=(ry-.5)*16;
        const y=wrap(seed*7-phase*(3.9+size),7)-camera.y;
        const sx=cx+f*x/z,sy=cy-f*y/z;
        if(sx<0||sx>w||sy<0||sy>h)continue;
        ctx.moveTo(sx,sy);
        ctx.lineTo(cx+f*(x-.038-run.speed*.012)/(z+.11),cy-f*(y-.28-size*.12)/(z+.11));
      }
      ctx.stroke();
      const period=2.05, strokeTime=1.24;
      const wipers=run.wipers!==false;
      if(wipers&&!wipeWasEnabled)wipeStartedAt=phase;
      wipeWasEnabled=wipers;
      const wipeTime=Math.max(0,phase-wipeStartedAt);
      const cycle=wrap(wipeTime,period);
      const sweep=wipers&&cycle<strokeTime?(1-Math.cos(cycle/strokeTime*tau))*.5:0;
      // Screen-space geometry of two tandem wipers. The driver's pivot sits
      // below the left glass, so its raised blade follows the left A-pillar.
      // Radii use height to keep the long blades inside the windscreen.
      const glassShift=-view*w*.50;
      const wiperGeometry=[
        {x:w*.225+glassShift,y:h*.79,inner:h*.10,outer:h*.738,park:-.075,raised:-2.25},
        {x:w*.60+glassShift,y:h*.79,inner:h*.13,outer:h*.710,park:-.075,raised:-2.14}
      ];
      const blade=g=>lerp(g.park,g.raised,sweep);
      const windshield=new Path2D();
      // Match the cabin's sloping A-pillars; cockpit trim is drawn over the glass.
      windshield.moveTo(glassShift,0);windshield.lineTo(w+glassShift,0);
      windshield.lineTo(w*.81+glassShift,h*.765);windshield.lineTo(w*.20+glassShift,h*.765);windshield.closePath();
      const glassScale=clamp(w/1280,.6,1.5);
      // Blade pivots, sweep timing and endpoints match the original view.
      ctx.save();ctx.clip(windshield);
      for(const g of wiperGeometry){
        const angle=blade(g),c=Math.cos(angle),sn=Math.sin(angle);
        const at=(radius,offset=0)=>[g.x+c*radius-sn*offset,g.y+sn*radius+c*offset];
        const [ex,ey]=at(g.outer),[ix,iy]=at(g.inner);
        const joint=(g.inner+g.outer)*.5;
        const [jx,jy]=at(joint),[kx,ky]=at(joint*.45,7*glassScale);
        ctx.lineCap='round';ctx.lineJoin='round';
        // Hinged metal arm reaches the middle of the longer rubber blade.
        ctx.strokeStyle='#0b1116';ctx.lineWidth=5*glassScale;
        ctx.beginPath();ctx.moveTo(g.x,g.y);ctx.lineTo(kx,ky);ctx.lineTo(jx,jy);ctx.stroke();
        ctx.strokeStyle='#56616a';ctx.lineWidth=1.3*glassScale;ctx.stroke();
        ctx.strokeStyle='#090e12';ctx.lineWidth=5.3*glassScale;
        ctx.beginPath();ctx.moveTo(ix,iy);ctx.lineTo(ex,ey);ctx.stroke();
        // A slender raised backbone and support clips give the blade depth.
        const [bx,by]=at(g.inner+8*glassScale,2*glassScale);
        const [tx,ty]=at(g.outer-8*glassScale,2*glassScale);
        ctx.strokeStyle='#647078';ctx.lineWidth=1.1*glassScale;
        ctx.beginPath();ctx.moveTo(bx,by);ctx.lineTo(tx,ty);ctx.stroke();
        ctx.strokeStyle='#1a242c';ctx.lineWidth=2*glassScale;
        for(const fraction of [.2,.4,.6,.8]){
          const radius=lerp(g.inner,g.outer,fraction);
          const [a,b]=at(radius,-2*glassScale),[c,d]=at(radius,3*glassScale);
          ctx.beginPath();ctx.moveTo(a,b);ctx.lineTo(c,d);ctx.stroke();
        }
        ctx.fillStyle='#182129';ctx.beginPath();ctx.arc(jx,jy,4*glassScale,0,tau);ctx.fill();
      }
      ctx.restore();
    }

    const shapePaths=new Map();
    function shape(path,fill,stroke,width=1){
      let p=shapePaths.get(path);
      if(!p){p=new Path2D(path);if(shapePaths.size<64)shapePaths.set(path,p);}
      if(fill){ctx.fillStyle=fill;ctx.fill(p);}if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=width;ctx.stroke(p);}
    }
    const mirrorOutlines=[
      new Path2D('M2 15 Q2 4 16 3 L93 3 Q107 4 108 15 L105 39 Q103 47 93 47 L18 47 Q5 46 4 36 Z'),
      new Path2D('M2 23 Q7 8 31 4 L96 5 Q107 7 107 17 L102 37 Q99 46 86 47 L17 45 Q1 42 2 23 Z')
    ];
    function mirror(x,y,mw,mh,side){
      ctx.save();
      ctx.translate(x,y);ctx.scale(mw/110,mh/49*Math.min(1,(w/1000)/(h/600)*1.35));
      const outline=mirrorOutlines[side===0?0:1];
      ctx.fillStyle='#090f13';ctx.fill(outline);
      ctx.save();ctx.clip(outline);
      // A static rear-road symbol preserves the cabin silhouette at fixed cost.
      ctx.fillStyle='#34434c';ctx.fillRect(6,7,99,37);
      ctx.fillStyle='#1b2931';ctx.beginPath();ctx.moveTo(6,44);ctx.lineTo(44,26);ctx.lineTo(67,26);ctx.lineTo(105,44);ctx.closePath();ctx.fill();
      ctx.strokeStyle='#8a917b';ctx.lineWidth=.8;ctx.beginPath();ctx.moveTo(56,29);ctx.lineTo(55,36);ctx.moveTo(55,39);ctx.lineTo(55,44);ctx.stroke();
      ctx.fillStyle='#8db1ce18';ctx.fillRect(4,4,104,42);
      if(side!==0){
        const edge=side<0?94:7;
        ctx.fillStyle='#151f28';ctx.fillRect(edge,13,10,35);
      }else{
        ctx.fillStyle='#11191e';
        ctx.fillRect(5,6,101,4);
        ctx.beginPath();ctx.ellipse(24,46,14,7,0,0,tau);ctx.ellipse(88,46,13,7,0,0,tau);ctx.fill();
      }
      ctx.fillStyle='#d7e1e06e';
      for(const [dx,dy] of [[19,14],[34,34],[64,12],[85,24]])ctx.fillRect(dx,dy,1.2,1.2);
      ctx.restore();
      ctx.strokeStyle='#657b89';ctx.lineWidth=1.35;ctx.stroke(outline);ctx.restore();
    }
    function exteriorMirrors(run){
      ctx.save();ctx.scale(w/1000,h/600);
      const shift=-view*500;
      const looking=Math.min(1,Math.abs(view)/.475);
      const left=5+shift-(view<0?32*looking:0);
      const right=840+shift+(view>0?48*looking:0);
      const y=380-8*looking;
      const mirrorWidth=155+12*looking,mirrorHeight=78+6*looking;
      if(view<.12){ctx.save();ctx.translate(left,0);shape('M39 435 l65 31 -11 -29 -43 -17 Z','#15232b','#71838b58');ctx.restore();}
      if(view>-.12){ctx.save();ctx.translate(right,0);shape('M46 435 l-65 31 11 -29 43 -17 Z','#15232b','#71838b58');ctx.restore();}
      if(view<.12)mirror(left,y,mirrorWidth,mirrorHeight,-1);
      if(view>-.12)mirror(right,y,mirrorWidth,mirrorHeight,1);
      if(run.signal&&Math.floor(run.t*2.9)%2===0){
        const x=run.signal<0?left+26:right+62;
        light(x,y+37,12,'255,177,60',.4);
        ctx.fillStyle='#ffbd60';ctx.fillRect(x-7,y+37,14,1.6);
      }
      ctx.restore();
    }
    // Head-up display low on the windscreen: speed and indicator state.
    function headUp(run){
      const blink=Math.floor(run.t*2.9)%2===0;
      ctx.save();
      ctx.translate(342,427);ctx.scale((h/600)/(w/1000),1);
      ctx.fillStyle='rgba(4,10,12,.22)';ctx.fillRect(-76,-32,152,50);
      ctx.textAlign='center';ctx.textBaseline='alphabetic';
      ctx.shadowBlur=0;
      ctx.fillStyle='rgba(219,251,243,.9)';
      ctx.font='600 29px "Noto Sans KR",system-ui,sans-serif';
      ctx.fillText(String(Math.round(run.speed*3.6)),0,0);
      ctx.shadowBlur=0;
      ctx.fillStyle='rgba(190,230,223,.72)';
      ctx.font='500 8.5px "Noto Sans KR",system-ui,sans-serif';
      ctx.fillText('km/h',0,11);
      for(const side of [-1,1]){
        const lit=run.signal===side&&blink,x=side*50,y=-10;
        ctx.fillStyle=lit?'rgba(126,255,176,.96)':'rgba(176,210,205,.17)';
        ctx.shadowBlur=0;
        ctx.beginPath();ctx.moveTo(x+side*11,y);ctx.lineTo(x,y-8);ctx.lineTo(x,y-3.4);ctx.lineTo(x-side*10,y-3.4);
        ctx.lineTo(x-side*10,y+3.4);ctx.lineTo(x,y+3.4);ctx.lineTo(x,y+8);ctx.closePath();ctx.fill();
      }
      ctx.restore();
    }
    function cockpit(run){
      ctx.save();
      const scaleX=w/1000, scaleY=h/600;
      ctx.scale(scaleX,scaleY);
      const shift=-view*500;
      ctx.translate(shift,0);
      const photo=ready(images.cockpit);
      if(photo){
        // Translate the cabin without stretching it: the near side window opens
        // up while the opposite mirror and A-pillar move out of the frame.
        ctx.fillStyle='#111a21';ctx.fillRect(-800,455,2600,145);
        ctx.fillStyle='#182127';ctx.fillRect(-800,0,2600,25);
        const iw=images.cockpit.naturalWidth,ih=images.cockpit.naturalHeight;
        // Continue the side door and roof textures into the newly exposed area.
        for(const [sx,dx] of [[0,-700],[iw*.988,1000]]){
          ctx.drawImage(images.cockpit,sx,0,iw*.012,ih*.045,dx,0,700,27);
          ctx.drawImage(images.cockpit,sx,ih*.79,iw*.012,ih*.21,dx,474,700,126);
        }
        shape('M1000 125 L1088 25 L1180 25 L1000 295 Z',
          gradient(1000,125,1100,210,[[0,'#3c3b39'],[.5,'#262725'],[1,'#10171c']]));
        shape('M0 125 L-88 25 L-180 25 L0 295 Z',
          gradient(0,125,-100,210,[[0,'#3c3b39'],[.5,'#262725'],[1,'#10171c']]));
        ctx.drawImage(images.cockpit,0,0,1000,600);
      }
      if(!photo){
      const trim=gradient(0,0,0,600,[[0,'#252e36'],[.38,'#131c24'],[.76,'#252c33'],[1,'#090f15']]);
      const pillar=gradient(70,160,174,190,[[0,'#111a21'],[.54,'#353e43'],[.82,'#252e35'],[1,'#131b22']]);
      shape('M-300 0 H1300 V40 Q1050 51 884 41 Q580 19 332 35 Q122 55 -300 49 Z',trim);
      shape('M39 22 L82 26 Q111 102 137 167 Q172 248 202 338 Q211 376 228 449 L192 475 Q165 399 145 342 Q105 224 73 158 Q44 102 11 39 Z',pillar,'#59636a55',1.1);
      shape('M936 29 L984 24 Q943 115 913 200 Q887 276 862 353 L830 463 L799 449 Q825 351 848 277 Q899 115 936 29 Z',trim,'#65747e77',1.4);
      shape('M-310 444 Q-10 434 161 440 Q238 452 306 447 Q543 427 761 440 Q1029 450 1300 441 V640 H-310 Z',
        gradient(0,439,0,600,[[0,'#313b43'],[.09,'#232e36'],[.26,'#18232b'],[.57,'#121a21'],[1,'#080f15']]),'#84909860',1);
      shape('M-310 507 Q-20 489 153 496 Q240 505 309 498 Q575 477 817 493 Q1032 501 1300 497 L1300 509 Q1050 515 811 507 Q577 493 309 510 Q140 518 -310 522 Z','#0d151b','#52626b66');
      shape('M-310 415 Q-30 406 118 416 L180 442 L190 538 Q24 528 -310 538 Z',trim,'#475763');
      shape('M1300 413 Q1088 405 899 419 L829 444 L809 535 Q1020 523 1300 541 Z',trim,'#475763');
      }
      shape('M481 6 Q498 4 513 7 L508 49 L489 53 Z','#1b252d','#59636a');
      mirror(405,42,190,62,0);
      if(hud)headUp(run);
      if(!photo)shape('M260 470 Q286 427 375 430 Q455 433 482 473 Q410 462 343 464 Z','#10191f','#6d7b8465',1.1);
      // Steering wheel and both wrists use the same steering rotation.
      ctx.save();ctx.translate(342,579);ctx.scale(1,Math.min(1,scaleX/scaleY*1.47));ctx.rotate((run.wheel??run.steer)*.7);
      if(ready(images.wheel)){
        ctx.drawImage(images.wheel,-145,-123,290,253);
        ctx.restore();ctx.restore();
        return;
      }
      function hand(side){
        ctx.save();ctx.scale(side,1);
        const sleeve=gradient(78,-20,144,128,[[0,'#36464d'],[.4,'#26353e'],[1,'#131b24']]);
        shape('M88 -10 Q113 -13 125 11 L155 125 L106 143 Q94 93 72 34 Q65 16 88 -10 Z',sleeve,'#71848b48');
        shape('M78 -29 Q83 -45 91 -43 Q99 -48 106 -40 L118 -22 Q123 -9 111 3 L94 15 Q85 19 78 9 L72 -5 Q70 -15 78 -29 Z',
          gradient(72,-40,119,15,[[0,'#b18e7c'],[.48,'#8f6c60'],[1,'#624841']]),'#d0a58d55');
        shape('M90 -33 Q101 -33 107 -19 M86 -26 Q97 -26 102 -14 M80 -17 Q92 -17 98 -8',null,'#4a38377d',1);
        ctx.restore();
      }
      ctx.beginPath();ctx.ellipse(0,0,108,99,0,0,tau);
      ctx.strokeStyle=gradient(0,-104,0,93,[[0,'#4b5a61'],[.26,'#222e36'],[1,'#10191f']]);ctx.lineWidth=17;ctx.stroke();
      shape('M-100 -15 L-33 -9 Q0 -20 33 -9 L100 -15 L91 4 L37 15 L20 49 L-20 49 L-37 15 L-91 4 Z','#1b242b','#5d6c74',1.2);
      shape('M-36 -10 Q0 -22 36 -10 L39 17 Q38 36 19 43 L-19 43 Q-38 36 -39 17 Z',
        gradient(0,-18,0,49,[[0,'#35434d'],[1,'#1a232c']]),'#89929a50');
      hand(-1);hand(1);
      ctx.restore();ctx.restore();
    }
    function draw(run,dt) {
      const now=performance.now();
      frameNumber++;
      weatherTime+=dt;
      const elapsed=now-lastFrame;
      if(lastFrame&&elapsed<250){
        observedTime+=elapsed;
        frameAverage=lerp(frameAverage,elapsed,.07);
        slowFrames=frameAverage>24?slowFrames+1:0;
        if(observedTime<20000&&slowFrames>32&&quality<tiers.length-1){quality++;slowFrames=0;frameAverage=20;}
      }
      lastFrame=now;
      resize();
      const pose=Drive.pose(run);
      if(run.signal!==glanceSignal){glanceSignal=run.signal;glanceAt=weatherTime;}
      const glancing=weatherTime-glanceAt<glanceTime;
      // Two damped stages in series give the head turn a soft start as well as a soft stop.
      const aim=ease(motion.aim,run.signal*.475*(glancing?1:glanceRest),dt,6.5);
      displayYaw=ease(motion.look,aim,dt,6.5);
      view=displayYaw;
      const hazard=run.result==='unsafe'?Drive.pedestrian(run):null;
      const target=hazard?Math.atan2(hazard.x-pose.x,hazard.z-pose.z):null;
      // Look slightly into the bend the car is actually following.
      const turning=clamp((run.curve||0)*Drive.track.radius,-1,1);
      const lead=ease(motion.lead,turning*.085+(run.wheel||0)*.02,dt,5);
      const baseYaw=pose.yaw+displayYaw+lead;
      const x=pose.x+Math.cos(pose.yaw)*run.lean,z=pose.z-Math.sin(pose.yaw)*run.lean;
      f=Math.max(w*.57,h*.425);cx=w*.50;
      // The nose dips a little under braking and lifts as the car pulls away.
      const acceleration=dt>0&&lastSpeed!==null?(run.speed-lastSpeed)/dt:0;
      lastSpeed=run.speed;
      cy=h*.455-f*ease(motion.pitch,clamp(-acceleration*.0021,-.006,.012),dt,6);
      // The driver looks where the hazard can come from: first toward the
      // pavement on the right while nearing the turn, then toward the gap
      // ahead of the parked vehicle while passing it. A left indicator wins.
      const stopped=Drive.parked(run.vehicle),walker=Drive.pedestrian(run);
      let interest=null,limit=0;
      if(run.yaw>.03&&run.signal>=0&&!run.result){
        if(run.s>Drive.track.cueDistance-2&&run.s<Drive.track.turnStart+3){
          interest=walker?.cue?[Math.min(walker.x+.5,stopped.rear+4.5),walker.z]:[stopped.rear+1.5,-7.3];
          limit=.6;
        }else if(pose.yaw>1&&x<stopped.front-1.5){
          interest=[stopped.front+1.3,stopped.edge-.6];
          limit=.3;
        }
      }
      const margin=Math.atan(w*.2/f);
      let correction=0;
      if(interest){
        let bearing=Math.atan2(interest[0]-x,interest[1]-z)-baseYaw;
        bearing=Math.atan2(Math.sin(bearing),Math.cos(bearing));
        correction=clamp(bearing-margin,0,limit);
      }
      cornerYaw=ease(motion.corner,correction,dt,run.signal<0?7:3.6);
      // Turning the head also slides the cabin, as it does for an indicator glance.
      view=displayYaw+cornerYaw*.6;
      const toHazard=ease(motion.hazard,target===null?0:1,dt,11);
      const driving=baseYaw+cornerYaw;
      const yaw=target===null?driving:lerp(driving,target*.75+(pose.yaw+displayYaw)*.25,clamp(toHazard,0,1));
      camera={x,z,y:1.18,cos:Math.cos(yaw),sin:Math.sin(yaw)};
      road(run);
      exteriorMirrors(run);
      cockpit(run);
    }
    function cueLocation(run){
      const ped=Drive.pedestrian(run);
      if(!ped?.cue)return null;
      const place=walkerPlace(ped);
      if(!place)return null;
      const {p,x,y,height}=place;
      if(!(x>w*.06&&x<w*.94&&y>h*.2&&y<h*.72))return null;
      // Only a frame in which most of the figure can actually be seen counts.
      const seen=visibleRows(x,p.z,y-height,y,parkedVehicle(run)).reduce((sum,[from,to])=>sum+to-from,0);
      return seen>height*.7?[x,y-height*.5]:null;
    }
    return {
      draw,cueLocation,
      reset(){displayYaw=0;cornerYaw=0;wipeWasEnabled=false;lastSpeed=null;glanceSignal=0;glanceAt=-Infinity;
        for(const state of Object.values(motion))state.value=state.rate=0;},
      pause(){lastFrame=0;slowFrames=0;},
      stats(){return {fps:frameNumber?1000/frameAverage:0,width:canvas.width,height:canvas.height,
        quality:['high','medium','low'][quality]};},
      composition(){return {x:camera.x??null,y:camera.y??null,z:camera.z??null,
        yaw:camera.sin===undefined?null:Math.atan2(camera.sin,camera.cos),focalLength:f,
        horizontalFov:2*Math.atan(w/(2*f)),width:w,height:h,view};}
    };

  }
  window.Scene={create};
})();
