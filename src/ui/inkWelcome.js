import * as motion from "./inkWelcomeMotion.js";
import { normalizeWelcomeText, fitWelcomeFontSize } from "./welcome.js";

export const INK_SCALE = 3;
export const PAPER_SCALE = 2;
export const DURATION = motion.DURATION;

/** One renderer for the approved preview and the bundled desktop frontend. */
export function createInkWelcome({ world, ui, paper, ink, fibers }) {
  const SCALE=INK_SCALE;
  const ctx=ink.getContext('2d');
  const raster=document.createElement('canvas');
  const rasterCtx=raster.getContext('2d',{willReadFrequently:true});
  if(!ctx||!rasterCtx||!fibers.getContext('2d'))throw new Error('Canvas 2D is unavailable');
  const viewport=()=>({width:Math.max(1,world.clientWidth||innerWidth),height:Math.max(1,world.clientHeight||innerHeight)});
  let W=0,H=0,X=0,Y=0;
  let cw=0,ch=0,pw=0,ph=0,fontSize=30,textWidth=0,dropHeight=170,anchor=190,field=null;
  let clock=0,disposed=false,lastSettled=false,preparedKey='',welcomeText='';
  const dropAt=t=>motion.dropAt(t,dropHeight);
  const liquidAt=t=>motion.liquidAt(t,textWidth,fontSize);
  world.dataset.ready='false';world.dataset.finished='false';world.style.transform='none';
  ui.style.opacity='0';ui.inert=true;paper.style.opacity='1';

function paperHash(x,y) {
  let n=Math.imul(x,374761393)+Math.imul(y,668265263);
  n=Math.imul(n^(n>>>13),1274126177);
  return ((n^(n>>>16))>>>0)/4294967295;
}
function valueNoise(x,y) {
  const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy;
  const u=motion.sineInOut(fx),v=motion.sineInOut(fy);
  return motion.lerp(motion.lerp(paperHash(ix,iy),paperHash(ix+1,iy),u),motion.lerp(paperHash(ix,iy+1),paperHash(ix+1,iy+1),u),v);
}
function noise(x,y) {
  return .58*valueNoise(x/4.7,y/2.4)+.28*valueNoise(x/1.4,y/.8)+.14*paperHash(Math.floor(x*3),Math.floor(y*3));
}
function distance(mask,width,height) {
  const d=new Float32Array(mask.length);
  for(let i=0;i<d.length;i++)d[i]=mask[i]>.12?0:1e4;
  const rt=Math.SQRT2;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
    const i=y*width+x;let v=d[i];
    if(x)v=Math.min(v,d[i-1]+1);
    if(y)v=Math.min(v,d[i-width]+1);
    if(x&&y)v=Math.min(v,d[i-width-1]+rt);
    if(y&&x+1<width)v=Math.min(v,d[i-width+1]+rt);
    d[i]=v;
  }
  for(let y=height-1;y>=0;y--)for(let x=width-1;x>=0;x--) {
    const i=y*width+x;let v=d[i];
    if(x+1<width)v=Math.min(v,d[i+1]+1);
    if(y+1<height)v=Math.min(v,d[i+width]+1);
    if(x+1<width&&y+1<height)v=Math.min(v,d[i+width+1]+rt);
    if(x&&y+1<height)v=Math.min(v,d[i+width-1]+rt);
    d[i]=v;
  }
  return d;
}
function prepare(value) {
  if(disposed)return;
  welcomeText=normalizeWelcomeText(value);
  const size=viewport();
  W=size.width;H=size.height;X=W/2;Y=H/2;
  const key=JSON.stringify([W,H,welcomeText]);
  if(field&&key===preparedKey)return;
  preparedKey=key;lastSettled=false;
  const preferredSize=Math.min(30,Math.max(24,W/28));
  const fontAt=size=>`420 ${size}px "WithType UI", "Segoe UI", sans-serif`;
  fontSize=fitWelcomeFontSize(preferredSize,(W-64)/(2.12*1.06),size=>{
    rasterCtx.font=fontAt(size);return rasterCtx.measureText(welcomeText).width;
  });
  dropHeight=Math.min(170,(H/2-54)/2+24);anchor=dropHeight+20;
  const font=fontAt(fontSize);
  rasterCtx.font=font;textWidth=rasterCtx.measureText(welcomeText).width;
  world.dataset.welcome=welcomeText;world.dataset.fontSize=String(fontSize);world.dataset.textWidth=String(textWidth);
  cw=Math.ceil(textWidth+80);ch=Math.ceil(dropHeight+70);pw=cw*SCALE;ph=ch*SCALE;
  ink.width=pw;ink.height=ph;ink.style.width=cw+'px';ink.style.height=ch+'px';
  ink.style.left=(X-cw/2)+'px';ink.style.top=(Y-anchor)+'px';
  raster.width=pw;raster.height=ph;
  rasterCtx.setTransform(SCALE,0,0,SCALE,0,0);
  rasterCtx.font=font;rasterCtx.textAlign='center';rasterCtx.textBaseline='middle';
  rasterCtx.fillStyle='#000';rasterCtx.fillText(welcomeText,cw/2,anchor);
  const pixels=rasterCtx.getImageData(0,0,pw,ph).data;
  const a=new Float32Array(pw*ph),porosity=new Float32Array(pw*ph);
  for(let y=0;y<ph;y++)for(let x=0;x<pw;x++) {
    const i=y*pw+x,dx=x/SCALE-cw/2,dy=y/SCALE-anchor,n=noise(x/SCALE,y/SCALE);
    a[i]=pixels[4*i+3]/255;porosity[i]=n;
  }
  const solid=Float32Array.from(a,v=>v>.5?1:0);
  const outside=distance(solid,pw,ph),inside=distance(Float32Array.from(solid,v=>1-v),pw,ph);
  const sdf=Float32Array.from(outside,(v,i)=>(v-inside[i])/SCALE);
  const offset=new Float32Array(pw),width=new Float32Array(pw);
  for(let x=0;x<pw;x++) {
    const dx=x/SCALE-cw/2;
    offset[x]=fontSize*(.18*Math.sin(dx/textWidth*Math.PI*2)+.12*(valueNoise(dx/18,47)-.5));
    width[x]=.60+.48*valueNoise(dx/18,11);
  }
  field={a,porosity,sdf,offset,width,image:ctx.createImageData(pw,ph),top:Math.floor((anchor-fontSize*1.25)*SCALE),bottom:Math.ceil((anchor+fontSize*1.25)*SCALE)};
  fibers.width=W*PAPER_SCALE;fibers.height=H*PAPER_SCALE;
  const g=fibers.getContext('2d'),random=motion.rng(2317);
  g.setTransform(PAPER_SCALE,0,0,PAPER_SCALE,0,0);g.lineCap='round';
  for(let i=0;i<Math.ceil(W*H/560);i++) {
    const x=random()*W,y=random()*H,len=1+random()*7,dy=(random()-.5)*3;
    g.strokeStyle=`rgba(112,108,87,${.016+random()*.030})`;g.lineWidth=.22+random()*.3;
    g.beginPath();g.moveTo(x,y);g.quadraticCurveTo(x+len*.52,y+dy*.3,x+len,y+dy);g.stroke();
  }
  for(let i=0;i<95;i++) {
    const x=random()*W,y=random()*H;
    g.strokeStyle='rgba(128,121,95,.026)';g.lineWidth=.32;
    g.beginPath();g.moveTo(x,y);g.bezierCurveTo(x+5,y-1,x+10,y+2,x+15,y+1);g.stroke();
  }
}
function drawBead(cx,cy,rx,ry,alpha) {
  ctx.globalAlpha=alpha;ctx.fillStyle='#282c27';ctx.beginPath();
  // Initial rx and ry match; the existing fall and impact preserve liquid deformation.
  ctx.ellipse(cx,cy,rx,ry,0,0,Math.PI*2);
  ctx.fill();ctx.globalAlpha=1;
}

function drawInk(t) {
  if(t>=2&&lastSettled)return;
  lastSettled=t>=2;
  ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,pw,ph);
  const {a,porosity,sdf,offset,width,image,top,bottom}=field,data=image.data;
  const liquid=liquidAt(t),{spread,rx,ry,morph}=liquid;
  if(t>=.70) {
    const touch=motion.seg(t,.70,.75),settled=t>=2;
    for(let y=top;y<bottom;y++)for(let x=0;x<pw;x++) {
      const i=y*pw+x,dx=x/SCALE-cw/2,dy=y/SCALE-anchor;
      const yy=dy-offset[x]*spread;
      const pool=Math.max(-4,(Math.sqrt((dx/rx)**2+(yy/(ry*width[x]))**2)-1)*ry);
      // The liquid footprint changes topology into the letter footprint.
      // Letter counters and spaces open inside existing ink, rather than fading type in.
      const contour=motion.lerp(pool,sdf[i],morph)+(porosity[i]-.5)*(.7-.52*morph);
      const softness=settled?.23:motion.lerp(.72,.23,morph);
      const core=motion.clamp(.5-contour/(softness*2));
      const halo=Math.exp(-Math.max(0,contour)/(1.1-.78*morph))*.11*(1-morph);
      const density=.97-.055*porosity[i]-.12*(1-morph)*Math.min(1,Math.abs(dx)/rx);
      const alpha=touch*Math.max(core*density,halo);
      data[4*i]=40;data[4*i+1]=44;data[4*i+2]=39;data[4*i+3]=Math.round(255*motion.clamp(alpha));
    }
    ctx.putImageData(image,0,0);
  }
  ctx.setTransform(SCALE,0,0,SCALE,0,0);
  const cx=cw/2,cy=anchor;
  if(t<.88) {
    const p=dropAt(t),absorb=motion.cubicOut(motion.seg(t,.70,.88));
    const hit=motion.impactAt(t);
    const radius=9.6,op=1-motion.seg(t,.75,.88);
    const sh=ctx.createRadialGradient(cx,cy+3,0,cx,cy+3,14);
    sh.addColorStop(0,`rgba(40,44,39,${(.02+.09*motion.clamp(1+p.y/dropHeight))*op})`);sh.addColorStop(1,'rgba(40,44,39,0)');
    ctx.fillStyle=sh;ctx.save();ctx.translate(cx,cy+3);ctx.scale(1,.22);
    ctx.translate(-cx,-cy-3);ctx.fillRect(cx-14,cy-11,28,28);ctx.restore();
    const elongation=1+.16*motion.seg(t,.14,.70)**2*(1-absorb);
    drawBead(cx,cy+p.y,radius*hit.sx*(1+absorb*.70)/Math.sqrt(elongation),radius*hit.sy*(1-absorb*.88)*elongation,op);
  }
  ctx.setTransform(1,0,0,1,0,0);
}

function seek(value) {
  if(disposed)return;
  const numeric=Number(value);
  const t=Number.isNaN(numeric)?0:motion.clamp(numeric,0,DURATION);clock=t;
  world.style.transform=t>=DURATION?'none':`matrix(${motion.view(motion.cameraAt(t,W,H),{W,H}).join(',')})`;
  world.dataset.time=t.toFixed(6);world.dataset.duration=String(DURATION);
  world.dataset.finished=String(t>=DURATION);world.dataset.phase=t<.70?'drop':t<1.16?'absorb':t<2?'form':t<2.7?'welcome':t<DURATION?'expand':'ready';
  const appear=motion.sineInOut(motion.seg(t,2.88,DURATION));
  ui.style.opacity=String(t>=DURATION?1:appear);ui.inert=t<DURATION;
  paper.style.opacity=String(1-appear);
  ink.style.opacity=String(1-motion.sineInOut(motion.seg(t,2.70,3.10)));
  if(field&&t<DURATION)drawInk(t);
}
function snapshot() {
  return {time:clock,width:W,height:H,welcomeText,fontSize,textWidth,dropHeight,inkScale:SCALE,paperScale:PAPER_SCALE};
}
function track(t) {
  const matrix=motion.view(motion.cameraAt(t,W,H),{W,H});
  const project=(x,y)=>[matrix[0]*x+matrix[4],matrix[3]*y+matrix[5]];
  const box=(x,y,w,h)=>{const a=project(x,y),b=project(x+w,y+h);return{x:a[0],y:a[1],w:b[0]-a[0],h:b[1]-a[1]};};
  const p=dropAt(t),op=1-motion.sineInOut(motion.seg(t,2.70,3.10));
  return {
    drop:{...box(X-18,Y+p.y-18,36,36),op:t<.88?1-motion.seg(t,.75,.88):0},
    ink:{...box(X-cw/2,Y-fontSize*1.25,cw,fontSize*2.5),op:t>=.70?op:0},
  };
}
function destroy() {
  if(disposed)return;
  seek(DURATION);disposed=true;field=null;
  for(const canvas of [ink,fibers,raster]){canvas.width=0;canvas.height=0;}
}
return {prepare,seek,snapshot,track,destroy};
}
