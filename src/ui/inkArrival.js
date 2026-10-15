/** A fixed porous sheet: weighted travel from the contact footprint, independent of frame time. */
export function inkArrival(width,height,cx,cy,conductivity) {
  const count=width*height,cost=new Float32Array(count),paper=new Float32Array(count);
  cost.fill(Infinity);
  const heap=[];
  const push=(id,value)=>{let i=heap.length;heap.push([id,value]);while(i){const parent=(i-1)>>1;if(heap[parent][1]<=value)break;heap[i]=heap[parent];i=parent;}heap[i]=[id,value];};
  const pop=()=>{const first=heap[0],last=heap.pop();if(heap.length){let i=0;while(i*2+1<heap.length){let child=i*2+1;if(child+1<heap.length&&heap[child+1][1]<heap[child][1])child++;if(heap[child][1]>=last[1])break;heap[i]=heap[child];i=child;}heap[i]=last;}return first;};
  for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
    const i=y*width+x;paper[i]=conductivity(x-cx,y-cy);
    if(Math.hypot(x-cx,y-cy)<=9.6){cost[i]=0;push(i,0);}
  }
  const steps=[[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1],[-2,-1],[2,-1],[-2,1],[2,1],[-1,-2],[1,-2],[-1,2],[1,2]].map(([dx,dy])=>[dx,dy,Math.hypot(dx*.30,dy*.90)]);
  while(heap.length) {
    const [id,travel]=pop();if(travel>cost[id]+1e-5)continue;
    const x=id%width,y=Math.floor(id/width);
    for(const [dx,dy,length] of steps) {
      const nx=x+dx,ny=y+dy;if(nx<0||nx>=width||ny<0||ny>=height)continue;
      const next=ny*width+nx,value=travel+length/(.5*(paper[id]+paper[next]));
      if(value<cost[next]-1e-5){cost[next]=value;push(next,cost[next]);}
    }
  }
  return cost;
}
