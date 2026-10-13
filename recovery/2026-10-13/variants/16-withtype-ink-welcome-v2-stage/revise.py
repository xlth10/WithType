from pathlib import Path

root=Path('/Users/outsider/SEVB/Type/docs/design/app-opening-2026-10-12')
s=(root/'ink-welcome-v1/comp.html').read_text()
s=s.replace('DURATION=3.2','DURATION=3.6')
s=s.replace('fontSize=32,textWidth=0,field=null','fontSize=30,textWidth=0,dropHeight=170,anchor=190,field=null')
s=s.replace("const query=new URLSearchParams(location.search);","const query=new URLSearchParams(location.search);\nconst gravity=OM.bezier(.55,0,1,.45);")
s=s.replace('fontSize=Math.min(32,Math.max(24,W/29));','fontSize=Math.min(30,Math.max(24,W/28));\n  dropHeight=Math.min(170,(H/2-54)/2+24);anchor=dropHeight+20;')
s=s.replace('const font=`460','const font=`420')
s=s.replace('cw=Math.ceil(textWidth+64);ch=136;','cw=Math.ceil(textWidth+80);ch=Math.ceil(dropHeight+70);')
s=s.replace("ink.style.top=(Y-ch/2)+'px';","ink.style.top=(Y-anchor)+'px';")
s=s.replace('fillText(BRAND.welcome,cw/2,ch/2)','fillText(BRAND.welcome,cw/2,anchor)')
s=s.replace('dy=y/SCALE-ch/2','dy=y/SCALE-anchor')
s=s.replace("  field={a,arrival,porosity,d:distance(a,pw,ph),image:ctx.createImageData(pw,ph)};",'''  const solid=Float32Array.from(a,v=>v>.5?1:0);
  const outside=distance(solid,pw,ph),inside=distance(Float32Array.from(solid,v=>1-v),pw,ph);
  const sdf=Float32Array.from(outside,(v,i)=>(v-inside[i])/SCALE);
  const offset=new Float32Array(pw),width=new Float32Array(pw);
  for(let x=0;x<pw;x++) {
    const dx=x/SCALE-cw/2;
    offset[x]=fontSize*(.10*Math.sin(dx/textWidth*Math.PI*2)+.025*Math.sin(dx/15));
    width[x]=.92+.12*Math.cos(dx/19)+.035*Math.sin(dx/7);
  }
  field={a,porosity,sdf,offset,width,image:ctx.createImageData(pw,ph),top:Math.floor((anchor-fontSize*1.25)*SCALE),bottom:Math.ceil((anchor+fontSize*1.25)*SCALE)};''')
s=s.replace('Math.ceil(W*H/290)','Math.ceil(W*H/560)')
s=s.replace('.022+random()*.047','.016+random()*.030')
s=s.replace("'rgba(128,121,95,.048)'","'rgba(128,121,95,.026)'")
start=s.index('function camera(t) {');end=s.index('function organic(',start)
s=s[:start]+'''function camera(t) {
  return OM.camera(t,[
    {t:0,x:X,y:Y-24,zoom:2},
    {t:.14,x:X,y:Y-24,zoom:2},
    {t:.62,x:X,y:Y,zoom:2.10,curve:OM.ease.sineInOut},
    {t:.84,x:X,y:Y+1,zoom:2.12,curve:OM.ease.cubicOut},
    {t:1.10,x:X,y:Y+1,zoom:2.12},
    {t:1.76,x:X,y:Y,zoom:1.60,curve:OM.ease.cubicOut},
    {t:2.70,x:X,y:Y,zoom:1.60},
    {t:DURATION,x:X,y:Y,zoom:1,curve:OM.ease.sineInOut},
  ],{W,H});
}
function dropAt(t) {
  return OM.hop(t,.14,.70,{x:0,y:-dropHeight},{x:0,y:0},{height:0,curve:gravity});
}
function liquidAt(t) {
  const spread=OM.ease.cubicOut(OM.seg(t,.70,1.30));
  return {spread,rx:OM.lerp(11,textWidth*.53,spread),ry:OM.lerp(4,fontSize*.56,spread),morph:OM.ease.sineInOut(OM.seg(t,1.16,2.0))};
}
'''+s[end:]
start=s.index('function drawInk(t) {');end=s.index('function seek(value)',start)
s=s[:start]+'''function drawInk(t) {
  ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,pw,ph);
  const {a,porosity,sdf,offset,width,image,top,bottom}=field,data=image.data;
  const liquid=liquidAt(t),{spread,rx,ry,morph}=liquid;
  if(t>=.70) {
    const touch=OM.seg(t,.70,.75),settled=t>=2;
    for(let y=top;y<bottom;y++)for(let x=0;x<pw;x++) {
      const i=y*pw+x,dx=x/SCALE-cw/2,dy=y/SCALE-anchor;
      const yy=dy-offset[x]*spread;
      const pool=(Math.sqrt((dx/rx)**2+(yy/(ry*width[x]))**2)-1)*ry;
      // The liquid footprint changes topology into the letter footprint.
      // Letter counters and spaces open inside existing ink, rather than fading type in.
      const contour=OM.lerp(pool,sdf[i],morph)+(porosity[i]-.5)*(.7-.52*morph);
      const softness=settled?.23:OM.lerp(.72,.23,morph);
      const core=OM.clamp(.5-contour/(softness*2));
      const halo=Math.exp(-Math.max(0,contour)/(1.1-.78*morph))*.11*(1-morph);
      const density=.97-.065*porosity[i];
      const alpha=touch*Math.max(core*density,halo);
      data[4*i]=40;data[4*i+1]=44;data[4*i+2]=39;data[4*i+3]=Math.round(255*OM.clamp(alpha));
    }
    ctx.putImageData(image,0,0);
  }
  ctx.setTransform(SCALE,0,0,SCALE,0,0);
  const cx=cw/2,cy=anchor;
  if(t<.88) {
    const p=dropAt(t),absorb=OM.ease.cubicOut(OM.seg(t,.70,.88));
    const hit=OM.impact(t,.70,{decay:17,omega:24,sqx:.20,sqy:.25});
    const radius=9.6,op=1-OM.seg(t,.75,.88);
    const sh=ctx.createRadialGradient(cx,cy+3,0,cx,cy+3,14);
    sh.addColorStop(0,`rgba(40,44,39,${(.02+.09*OM.clamp(1+p.y/dropHeight))*op})`);sh.addColorStop(1,'rgba(40,44,39,0)');
    ctx.fillStyle=sh;ctx.save();ctx.translate(cx,cy+3);ctx.scale(1,.22);
    ctx.translate(-cx,-cy-3);ctx.fillRect(cx-14,cy-11,28,28);ctx.restore();
    const elongation=1+.16*gravity(OM.seg(t,.14,.70))*(1-absorb);
    organic(cx,cy+p.y,radius*hit.sx*(1+absorb*.70)/Math.sqrt(elongation),radius*hit.sy*(1-absorb*.88)*elongation,op,.3);
  }
  ctx.setTransform(1,0,0,1,0,0);
}
'''+s[end:]
s=s.replace("t<.58?'drop':t<.88?'absorb':t<1.62?'form':t<2.32?'welcome'","t<.70?'drop':t<1.16?'absorb':t<2?'form':t<2.7?'welcome'")
s=s.replace('OM.seg(t,2.46,DURATION)','OM.seg(t,2.88,DURATION)')
s=s.replace('OM.seg(t,2.32,2.76)','OM.seg(t,2.70,3.10)')
start=s.index('window.__meta=');end=s.index('window.__ready=',start)
s=s[:start]+'''window.__meta={dur:DURATION,fps:30,cuts:[],beats:[0,.14,.70,1.16,2.0,2.70,DURATION],inFrame:{drop:[0,.88,'whole'],ink:[.70,3.10,'whole']}};
window.__track=t=>{
  const M=OM.view(camera(t),{W,H}),p=dropAt(t),l=liquidAt(t);
  const op=1-OM.ease.sineInOut(OM.seg(t,2.70,3.10));
  return {
    drop:{...OM.projectBox(M,{x:X-18,y:Y+p.y-18,w:36,h:36}),op:t<.88?1-OM.seg(t,.75,.88):0},
    ink:{...OM.projectBox(M,{x:X-cw/2,y:Y-fontSize*1.25,w:cw,h:fontSize*2.5}),op:t>=.70?op:0},
  };
};
window.__motion=(a,b)=>{
  const ca=camera(a),cb=camera(b),pa=dropAt(a),pb=dropAt(b);
  const A=OM.project(OM.view(ca,{W,H}),X,Y+pa.y),B=OM.project(OM.view(cb,{W,H}),X,Y+pb.y);
  const front=Math.abs(liquidAt(a).rx-liquidAt(b).rx)*Math.max(ca.zoom,cb.zoom);
  return Math.max(OM.screenTravel(ca,cb,camera((a+b)/2),{W,H}),Math.hypot(B[0]-A[0],B[1]-A[1]),front);
};
'''+s[end:]
Path('/private/tmp/withtype-ink-welcome-v2-stage/comp.html').write_text(s)
