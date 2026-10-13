from pathlib import Path
p=Path('/private/tmp/withtype-ink-welcome-v2-stage/comp.html')
s=p.read_text()
start=s.index('function noise(x,y) {');end=s.index('function distance(',start)
s=s[:start]+'''function paperHash(x,y) {
  let n=Math.imul(x,374761393)+Math.imul(y,668265263);
  n=Math.imul(n^(n>>>13),1274126177);
  return ((n^(n>>>16))>>>0)/4294967295;
}
function valueNoise(x,y) {
  const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy;
  const u=OM.ease.sineInOut(fx),v=OM.ease.sineInOut(fy);
  return OM.lerp(OM.lerp(paperHash(ix,iy),paperHash(ix+1,iy),u),OM.lerp(paperHash(ix,iy+1),paperHash(ix+1,iy+1),u),v);
}
function noise(x,y) {
  return .58*valueNoise(x/4.7,y/2.4)+.28*valueNoise(x/1.4,y/.8)+.14*paperHash(Math.floor(x*3),Math.floor(y*3));
}
'''+s[end:]
s=s.replace("offset[x]=fontSize*(.10*Math.sin(dx/textWidth*Math.PI*2)+.025*Math.sin(dx/15));","offset[x]=fontSize*(.18*Math.sin(dx/textWidth*Math.PI*2)+.12*(valueNoise(dx/18,47)-.5));")
s=s.replace("width[x]=.92+.12*Math.cos(dx/19)+.035*Math.sin(dx/7);","width[x]=.60+.48*valueNoise(dx/18,11);")
s=s.replace('const density=.97-.065*porosity[i];','const density=.97-.055*porosity[i]-.12*(1-morph)*Math.min(1,Math.abs(dx)/rx);')
p.write_text(s)
