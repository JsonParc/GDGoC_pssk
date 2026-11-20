/* 원본 R16 height fields. Rendering, navigation and collisions share this grid. */
(function(root){
'use strict';
class TerrainField {
  static get SEA_LEVEL(){return 0;}
  constructor(meta, buffer){
    this.meta=meta; this.n=meta.resolution;this.seaLevel=TerrainField.SEA_LEVEL;
    if(buffer.byteLength!==this.n*this.n*2) throw new Error('지형 데이터 크기 오류');
    const view=new DataView(buffer); this.heights=new Float32Array(this.n*this.n);
    for(let z=0;z<this.n;z++) for(let x=0;x<this.n;x++)
      this.heights[z*this.n+x]=meta.altMin+view.getUint16(((this.n-1-z)*this.n+x)*2,true)/65535*(meta.altMax-meta.altMin);
    // Eight-neighbour distance is a conservative clearance (square around land).
    this.clearance=new Float32Array(this.heights.length).fill(1e6);
    const queue=new Int32Array(this.heights.length); let head=0,tail=0;
    // Only exposed land blocks surface ships; shallow seabed is navigable.
    this.heights.forEach((h,i)=>{if(h>this.seaLevel){this.clearance[i]=0;queue[tail++]=i;}});
    while(head<tail){const i=queue[head++],x=i%this.n,z=Math.floor(i/this.n);
      for(let dz=-1;dz<=1;dz++) for(let dx=-1;dx<=1;dx++){
        const xx=x+dx,zz=z+dz,j=zz*this.n+xx;
        if(xx<0||zz<0||xx>=this.n||zz>=this.n||this.clearance[j]<=this.clearance[i]+1)continue;
        this.clearance[j]=this.clearance[i]+1;queue[tail++]=j;
      }
    }
    this.setScale(1);
  }
  setScale(scale){
    this.scale=scale;this.size=this.meta.worldSize*scale;this.cell=this.size/(this.n-1);this.x0=-this.size/2;this.z0=-this.size/2;
    this.boundary=(this.meta.playableBoundary?.points||[]).map(p=>({x:(p.x-this.meta.originX-this.meta.worldSize/2)*scale,z:(this.meta.originZ+this.meta.worldSize/2-p.z)*scale}));
  }
  withinBoundary(x,z,radius=0){
    if(this.boundary.length<3)return true;
    let inside=false,minDistance=Infinity;
    for(let i=0,j=this.boundary.length-1;i<this.boundary.length;j=i++){
      const a=this.boundary[j],b=this.boundary[i],dx=b.x-a.x,dz=b.z-a.z;
      if((a.z>z)!==(b.z>z)&&x<(b.x-a.x)*(z-a.z)/(b.z-a.z)+a.x)inside=!inside;
      const t=Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz)/(dx*dx+dz*dz||1)));
      minDistance=Math.min(minDistance,Math.hypot(x-a.x-dx*t,z-a.z-dz*t));
    }
    return (inside||minDistance<1e-7)&&minDistance+1e-7>=radius;
  }
  // lo/hi: optional distance band from origin (m); defaults keep the original 1000~3500 m search.
  nearWater(origin,radius,lo,hi){
    const min=Math.max(lo??1000,radius+220),max=Math.max(hi??3500,min+500);
    for(let i=0;i<800;i++){
      const angle=Math.random()*Math.PI*2,d=Math.sqrt(min*min+Math.random()*(max*max-min*min));
      const x=origin.x+Math.cos(angle)*d,z=origin.z+Math.sin(angle)*d;
      if(this.clear(x,z,radius))return {x,y:this.seaLevel,z};
    }
    // Deterministic local search avoids a distant or land-based fallback.
    const offset=Math.random()*Math.PI*2;
    for(let j=0;j<=20;j++)for(let i=0;i<128;i++){
      const d=min+(max-min)*j/20,angle=offset+i*Math.PI/64;
      const x=origin.x+Math.cos(angle)*d,z=origin.z+Math.sin(angle)*d;
      if(this.clear(x,z,radius))return {x,y:this.seaLevel,z};
    }
    return null;
  }
  // team('TeamA'|'TeamB') · category('standard'|'carrier'|'bomber')로 좁힘. 해당하는 게 없으면 넓혀서 고름
  spawnPoints(team,category){
    const all=(this.meta.spawns||[]).filter(s=>Number.isFinite(s.x)&&Number.isFinite(s.z));
    const teamed=team?all.filter(s=>s.team===team):[],pool=teamed.length?teamed:all;
    const wanted=category?pool.filter(s=>s.category===category):[],standard=pool.filter(s=>s.category==='standard');
    return (wanted.length?wanted:standard.length?standard:pool).map(s=>({
      x:(s.x-this.meta.originX-this.meta.worldSize/2)*this.scale,
      z:(this.meta.originZ+this.meta.worldSize/2-s.z)*this.scale,
      heading:-(s.heading||0)*Math.PI/180,id:s.id,team:s.team,index:s.index,adjusted:false
    }));
  }
  // slot: 1~7 = 그 번호 자리만 (없으면 전체), 0 · 생략 = 무작위
  spawn(radius,team,category,slot){
    let points=this.spawnPoints(team,category);
    if(slot){const k=points.filter(p=>p.index===slot);if(k.length)points=k;}
    const safe=points.filter(p=>this.clear(p.x,p.z,radius));
    if(safe.length)return safe[Math.floor(Math.random()*safe.length)];
    if(!points.length)throw new Error('함선 스폰 위치가 없습니다');
    const selected=points[Math.floor(Math.random()*points.length)];
    // At very small scales a full-sized hull may not fit any original spawn.
    const step=Math.max(this.cell,radius/2);
    for(let r=step;r<this.size*2+radius*4;r+=step){
      for(let i=0;i<32;i++){
        const angle=i*Math.PI/16,x=selected.x+Math.cos(angle)*r,z=selected.z+Math.sin(angle)*r;
        if(this.clear(x,z,radius))return {...selected,x,z,adjusted:true};
      }
    }
    throw new Error('스폰 주변에 안전한 해역이 없습니다');
  }
  fieldHeight(x,z){
    const gx=(x-this.x0)/this.cell,gz=(z-this.z0)/this.cell;
    if(gx<0||gz<0||gx>this.n-1||gz>this.n-1)return -Infinity;
    const ix=Math.min(this.n-2,Math.floor(gx)),iz=Math.min(this.n-2,Math.floor(gz)),u=gx-ix,v=gz-iz,i=iz*this.n+ix;
    const a=this.heights[i],b=this.heights[i+1],c=this.heights[i+this.n],d=this.heights[i+this.n+1];
    // Match PlaneGeometry's diagonal exactly.
    return (u+v<=1?a+(b-a)*u+(c-a)*v:d+(c-d)*(1-u)+(b-d)*(1-v))*this.scale;
  }
  broadClear(x,z,radius){
    const gx=(x-this.x0)/this.cell,gz=(z-this.z0)/this.cell;
    const ix=Math.max(0,Math.min(this.n-1,Math.round(gx))),iz=Math.max(0,Math.min(this.n-1,Math.round(gz)));
    const outside=Math.max(Math.abs(gx-ix),Math.abs(gz-iz));
    return (Math.max(outside,this.clearance[iz*this.n+ix])-2)*this.cell>radius;
  }
  clear(x,z,radius){
    if(!this.withinBoundary(x,z,radius))return false;
    if(this.broadClear(x,z,radius))return true;
    if(this.fieldHeight(x,z)>this.seaLevel)return false;
    if(radius===0)return this.fieldHeight(x,z)<=this.seaLevel;
    const r=radius/Math.cos(Math.PI/16),polygon=[];
    for(let i=0;i<16;i++){const a=i*Math.PI/8;polygon.push({x:x+Math.cos(a)*r,z:z+Math.sin(a)*r});}
    return this.polygonClear(polygon);
  }
  hullClear(x,z,heading,len){
    if(this.withinBoundary(x,z,len*.61)&&this.broadClear(x,z,len*.61))return true;
    if(this.fieldHeight(x,z)>this.seaLevel)return false;
    const c=Math.cos(heading),s=Math.sin(heading);
    return this.polygonClear([[-.065,.41],[-.065,-.41],[0,-.59],[.065,-.41],[.065,.41]].map(([a,b])=>({x:x+(a*c+b*s)*len,z:z+(-a*s+b*c)*len})));
  }
  polygonClear(hull){
    if(hull.some(p=>!this.withinBoundary(p.x,p.z)))return false;
    // A concave boundary can cut through an edge even when both ends are inside.
    const cross=(a,b,c)=>(b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x);
    for(let i=0;i<hull.length;i++)for(let j=0;j<this.boundary.length;j++){
      const a=hull[i],b=hull[(i+1)%hull.length],c=this.boundary[j],d=this.boundary[(j+1)%this.boundary.length];
      if(cross(a,b,c)*cross(a,b,d)<0&&cross(c,d,a)*cross(c,d,b)<0)return false;
    }
    // Clip each rendered terrain triangle to the actual footprint. An overlap
    // blocks only if its interpolated altitude is above the visible water plane.
    const minX=Math.min(...hull.map(p=>p.x)),maxX=Math.max(...hull.map(p=>p.x));
    const minZ=Math.min(...hull.map(p=>p.z)),maxZ=Math.max(...hull.map(p=>p.z));
    const x0=Math.max(0,Math.floor((minX-this.x0)/this.cell)),x1=Math.min(this.n-2,Math.floor((maxX-this.x0)/this.cell));
    const z0=Math.max(0,Math.floor((minZ-this.z0)/this.cell)),z1=Math.min(this.n-2,Math.floor((maxZ-this.z0)/this.cell));
    for(let z=z0;z<=z1;z++)for(let x=x0;x<=x1;x++){
      const index=z*this.n+x;
      if(Math.max(this.heights[index],this.heights[index+1],this.heights[index+this.n],this.heights[index+this.n+1])*this.scale<=this.seaLevel)continue;
      const point=(dx,dz)=>({x:this.x0+(x+dx)*this.cell,z:this.z0+(z+dz)*this.cell,h:this.heights[(z+dz)*this.n+x+dx]*this.scale});
      const a=point(0,0),b=point(1,0),c=point(0,1),d=point(1,1);
      for(const tri of [[a,b,c],[b,d,c]]){
        if(tri.every(p=>p.h<=this.seaLevel))continue;
        let poly=tri;
        for(let i=0;i<hull.length&&poly.length;i++){
          const u=hull[i],v=hull[(i+1)%hull.length],side=p=>(v.x-u.x)*(p.z-u.z)-(v.z-u.z)*(p.x-u.x),out=[];
          let prev=poly[poly.length-1],dp=side(prev);
          for(const p of poly){const dist=side(p);
            if((dist>=0)!==(dp>=0)){const t=dp/(dp-dist);out.push({x:prev.x+(p.x-prev.x)*t,z:prev.z+(p.z-prev.z)*t,h:prev.h+(p.h-prev.h)*t});}
            if(dist>=0)out.push(p);prev=p;dp=dist;
          }poly=out;
        }
        if(poly.some(p=>p.h>this.seaLevel+1e-7))return false;
      }
    }
    return true;
  }
  fieldImpact(a,b){
    // Split at every grid and triangle edge: height is linear in each interval.
    const dx=b.x-a.x,dz=b.z-a.z,dy=b.y-a.y;
    let lo=0,hi=1;
    for(const [p,d,min] of [[a.x,dx,this.x0],[a.z,dz,this.z0]]){
      if(Math.abs(d)<1e-12){if(p<min||p>min+this.size)return null;continue;}
      let t0=(min-p)/d,t1=(min+this.size-p)/d;if(t0>t1)[t0,t1]=[t1,t0];
      lo=Math.max(lo,t0);hi=Math.min(hi,t1);
    }
    if(lo>hi)return null;
    const cuts=[lo,hi];
    for(const [p,d,origin] of [[a.x,dx,this.x0],[a.z,dz,this.z0],[a.x+a.z,dx+dz,this.x0+this.z0]]){
      if(Math.abs(d)<1e-12)continue;
      const u=(p+d*lo-origin)/this.cell,v=(p+d*hi-origin)/this.cell;
      for(let k=Math.ceil(Math.min(u,v));k<=Math.floor(Math.max(u,v));k++){
        const t=(origin+k*this.cell-p)/d;if(t>lo&&t<hi)cuts.push(t);
      }
    }
    cuts.sort((a,b)=>a-b);
    const gap=t=>a.y+dy*t-this.fieldHeight(Math.max(this.x0,Math.min(this.x0+this.size,a.x+dx*t)),Math.max(this.z0,Math.min(this.z0+this.size,a.z+dz*t)));
    let prev=cuts[0],g=gap(prev);
    if(g<=0)return {x:a.x+dx*prev,y:a.y+dy*prev,z:a.z+dz*prev,t:prev};
    for(let i=1;i<cuts.length;i++){
      const end=cuts[i],next=gap(end);
      if(next<=0){const t=prev+(end-prev)*g/(g-next);return {x:a.x+dx*t,y:a.y+dy*t,z:a.z+dz*t,t};}
      prev=end;g=next;
    }
    return null;
  }
  segmentClear(a,b,radius){
    const steps=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.z-a.z)/Math.max(1,this.cell/2)));
    for(let i=0;i<=steps;i++){const t=i/steps;if(!this.clear(a.x+(b.x-a.x)*t,a.z+(b.z-a.z)*t,radius))return false;}return true;
  }
  // goal이 있으면 그 지점에 가장 가까이 갈 수 있는 곳까지, 없으면 갈 수 있는 곳 중 무작위
  route(start,radius,goal){
    const n=80,margin=Math.max(1000,radius*3),size=this.size+margin*2,cell=size/(n-1),origin=-size/2;
    const point=i=>({x:origin+(i%n)*cell,z:origin+Math.floor(i/n)*cell});
    const sx=Math.max(0,Math.min(n-1,Math.round((start.x-origin)/cell))),sz=Math.max(0,Math.min(n-1,Math.round((start.z-origin)/cell)));
    let first=-1,best=Infinity;
    for(let dz=-2;dz<=2;dz++)for(let dx=-2;dx<=2;dx++){
      const x=sx+dx,z=sz+dz;if(x<0||z<0||x>=n||z>=n)continue;
      const i=z*n+x,p=point(i),d=Math.hypot(p.x-start.x,p.z-start.z);
      if(d<best&&this.segmentClear(start,p,radius)){first=i;best=d;}
    }
    if(first<0)return [];
    const parents=new Int32Array(n*n).fill(-1),queue=new Int32Array(n*n);let head=0,tail=1;queue[0]=first;parents[first]=first;
    while(head<tail){const i=queue[head++],x=i%n,z=Math.floor(i/n);
      for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){const xx=x+dx,zz=z+dz,j=zz*n+xx;
        if(xx<0||zz<0||xx>=n||zz>=n||parents[j]>=0)continue;
        if(!this.segmentClear(point(i),point(j),radius))continue;
        parents[j]=i;queue[tail++]=j;
      }
    }
    if(tail<2)return [];
    let end=queue[1+Math.floor(Math.random()*(tail-1))];const path=[];
    if(goal){let best=Infinity;for(let k=1;k<tail;k++){const p=point(queue[k]),dist=Math.hypot(p.x-goal.x,p.z-goal.z);if(dist<best){best=dist;end=queue[k];}}}
    while(end!==first){path.push(point(end));end=parents[end];}path.push(point(first));return path.reverse();
  }
  /* 실제 게임 메시 (원본 /scenes/<slug>.json + <family>.geo.bin)
     높이장은 지점마다 높이가 하나라 아치 · 크레인 · 건물 아래가 꽉 찬 기둥이 됨.
     메시가 있으면 미사일 · 폭탄 · 전투기 · 조준선 충돌과 화면 표시는 메시로, 함선 항해 · 스폰은 높이장(fieldHeight)으로. */
  attachScene(scene,buffer){
    const W=this.meta.worldSize,cx=this.meta.originX+W/2,cz=this.meta.originZ+W/2;
    const deq=e=>{const q=new Uint16Array(buffer,e.offset,e.length),o=new Float32Array(e.length);
      for(let i=0;i<e.length;i+=3)for(let k=0;k<3;k++)o[i+k]=e.min[k]+q[i+k]*e.step[k];return o;};
    const idx=e=>e.type==='uint16'?new Uint16Array(buffer,e.offset,e.length):new Uint32Array(buffer,e.offset,e.length);
    const local=scene.geometries.map(g=>({p:deq(g.position),i:idx(g.index)}));
    // 건물 · 시추 시설 (창문 불빛을 넣을 메시). 바위 · 산 · 섬 · 눈 덮개 · 크레인은 뺌
    // b = 1: 창문이 있는 건물, 3: 시추 시설 강철 재질, 2: 기타 인공 구조물. 바위 · 산 · 섬 · 눈 덮개는 0
    const NOT=/Snow_Top|Snow_Bottom|rock|cliff|mountain|island|seabottom|reef/i,RIG=/Oil_rig|Oil_platform|Crane/i,FLOOD=/Oil_rig|Oil_platform|platform|container|lobby|industrial|Crane/i,
      BLD=/Nordic_house|house|station|building|tower|lighthouse|factory|hangar/i;
    // background_circle: 게임 원본의 먼 배경 링 (반경 ~10km · 높이 1.4km, 배율 ×10이면 100km · 14km). 시뮬레이터에선 쓸 곳이 없고 지평선에 갈색 판으로 비침
    const BACKDROP=/^background_circle/i;
    const parts=scene.instances.filter(s=>!BACKDROP.test(scene.geometries[s.geometry].name||'')).map(s=>{const nm=scene.geometries[s.geometry].name||'';return {...local[s.geometry],m:s.matrix,deck:/Oil_(rig|platform).*Base/i.test(nm),b:NOT.test(nm)?0:RIG.test(nm)?3:FLOOD.test(nm)?2:BLD.test(nm)?1:0};});
    if(scene.terrain)parts.push({p:deq(scene.terrain.position),i:idx(scene.terrain.index),m:null});
    let nv=0,ni=0;for(const p of parts){nv+=p.p.length/3;ni+=p.i.length;}
    // 좌표: 렌더 공간(Unity z 반전) → 시뮬레이터 배율 1 좌표 (맵 중심 0,0). 배율은 사용할 때 곱함
    const pos=new Float32Array(nv*3),index=new Uint32Array(ni),bld=new Uint8Array(nv),lamp_candidates=[];let vo=0,io=0;
    for(const p of parts){const m=p.m,src=p.p,base=vo*3;
      for(let i=0;i<src.length;i+=3){let x=src[i],y=src[i+1],z=src[i+2];
        if(m){const X=m[0]*x+m[1]*y+m[2]*z+m[3],Y=m[4]*x+m[5]*y+m[6]*z+m[7],Z=m[8]*x+m[9]*y+m[10]*z+m[11];x=X;y=Y;z=Z;} // 행 우선 행렬
        pos[base+i]=x-cx;pos[base+i+1]=y;pos[base+i+2]=z+cz;}
      if(p.b)bld.fill(p.b,vo,vo+src.length/3);
      for(let k=0;k<p.i.length;k++)index[io+k]=p.i[k]+vo;
      // 작업등은 실제 갑판의 위를 향한 넓은 면에만 설치. 공중의 격자 무늬를 발광시키지 않음.
      if(p.deck){
        for(let k=0;k<p.i.length;k+=3){
          const a=(p.i[k]+vo)*3,b=(p.i[k+1]+vo)*3,c=(p.i[k+2]+vo)*3;
          const ax=pos[b]-pos[a],ay=pos[b+1]-pos[a+1],az=pos[b+2]-pos[a+2],bx=pos[c]-pos[a],by=pos[c+1]-pos[a+1],bz=pos[c+2]-pos[a+2];
          const nx=ay*bz-az*by,ny=az*bx-ax*bz,nz=ax*by-ay*bx,area=Math.hypot(nx,ny,nz),y=(pos[a+1]+pos[b+1]+pos[c+1])/3;
          if(y>3&&ny>area*.98&&area>8)lamp_candidates.push({x:(pos[a]+pos[b]+pos[c])/3,y,z:(pos[a+2]+pos[b+2]+pos[c+2])/3,area});
        }
      }
      vo+=src.length/3;io+=p.i.length;}
    const work_lights=[];
    // 충돌용 xz 격자 (칸마다 걸치는 삼각형 목록 · 칸 최고 높이)
    let minX=Infinity,minZ=Infinity,maxX=-Infinity,maxZ=-Infinity,maxY=-Infinity;
    for(let i=0;i<pos.length;i+=3){const x=pos[i],y=pos[i+1],z=pos[i+2];if(x<minX)minX=x;if(x>maxX)maxX=x;if(z<minZ)minZ=z;if(z>maxZ)maxZ=z;if(y>maxY)maxY=y;}
    const C=16,gx=Math.max(1,Math.ceil((maxX-minX)/C)+1),gz=Math.max(1,Math.ceil((maxZ-minZ)/C)+1),nt=ni/3;
    const start=new Uint32Array(gx*gz+1),cellMaxY=new Float32Array(gx*gz).fill(-Infinity);
    const range=(t,f)=>{const a=index[t*3]*3,b=index[t*3+1]*3,c=index[t*3+2]*3;
      const x0=Math.floor((Math.min(pos[a],pos[b],pos[c])-minX)/C),x1=Math.floor((Math.max(pos[a],pos[b],pos[c])-minX)/C);
      const z0=Math.floor((Math.min(pos[a+2],pos[b+2],pos[c+2])-minZ)/C),z1=Math.floor((Math.max(pos[a+2],pos[b+2],pos[c+2])-minZ)/C);
      const top=Math.max(pos[a+1],pos[b+1],pos[c+1]);
      for(let z=z0;z<=z1;z++)for(let x=x0;x<=x1;x++)f(z*gx+x,top);};
    for(let t=0;t<nt;t++)range(t,(cell,top)=>{start[cell+1]++;if(top>cellMaxY[cell])cellMaxY[cell]=top;});
    for(let i=0;i<gx*gz;i++)start[i+1]+=start[i];
    const fill=start.slice(0,gx*gz),tris=new Uint32Array(start[gx*gz]);
    for(let t=0;t<nt;t++)range(t,cell=>{tris[fill[cell]++]=t;});
    this.scene={pos,index,bld,work_lights,minX,minZ,maxY,C,gx,gz,start,tris,cellMaxY,stamp:new Uint32Array(nt),query:0,triangles:nt};
    for(const p of lamp_candidates.sort((a,b)=>b.area-a.area)){
      // 천장 · 다른 모듈에 묻히는 자리에는 기둥을 세우지 않음.
      if(work_lights.every(q=>Math.hypot(p.x-q.x,p.z-q.z)>24)&&this.sceneHit(p.x,p.y+.05,p.z,p.x,p.y+6,p.z)<0)work_lights.push(p);
      if(work_lights.length===8)break;
    }
    return this;
  }
  // 배율 1 좌표 선분 a→b가 메시에 처음 닿는 t (0~1) · 없으면 -1
  sceneHit(ax,ay,az,bx,by,bz){
    const S=this.scene,{pos,index,C,gx,gz,minX,minZ}=S,dx=bx-ax,dy=by-ay,dz=bz-az;
    let t0=0,t1=1;
    for(const [p,d,lo,hi] of [[ax,dx,minX,minX+gx*C],[az,dz,minZ,minZ+gz*C]]){
      if(Math.abs(d)<1e-12){if(p<lo||p>=hi)return -1;continue;}
      let u=(lo-p)/d,v=(hi-p)/d;if(u>v)[u,v]=[v,u];t0=Math.max(t0,u);t1=Math.min(t1,v);}
    if(t0>t1)return -1;
    if(++S.query>=4294967295){S.stamp.fill(0);S.query=1;}
    const q=S.query,clampI=(v,n)=>Math.max(0,Math.min(n-1,v));
    let cx=clampI(Math.floor((ax+dx*t0-minX)/C),gx),cz=clampI(Math.floor((az+dz*t0-minZ)/C),gz);
    const sx=dx>0?1:-1,sz=dz>0?1:-1;
    const tdx=Math.abs(dx)<1e-12?Infinity:C/Math.abs(dx),tdz=Math.abs(dz)<1e-12?Infinity:C/Math.abs(dz);
    let tmx=Math.abs(dx)<1e-12?Infinity:(minX+(cx+(dx>0?1:0))*C-ax)/dx,tmz=Math.abs(dz)<1e-12?Infinity:(minZ+(cz+(dz>0?1:0))*C-az)/dz;
    let best=Infinity,enter=t0;
    for(;;){
      const cell=cz*gx+cx,exit=Math.min(tmx,tmz,t1);
      if(Math.min(ay+dy*enter,ay+dy*exit)<=S.cellMaxY[cell])
        for(let k=S.start[cell];k<S.start[cell+1];k++){const t=S.tris[k];if(S.stamp[t]===q)continue;S.stamp[t]=q;
          const a=index[t*3]*3,b=index[t*3+1]*3,c=index[t*3+2]*3;
          const e1x=pos[b]-pos[a],e1y=pos[b+1]-pos[a+1],e1z=pos[b+2]-pos[a+2],e2x=pos[c]-pos[a],e2y=pos[c+1]-pos[a+1],e2z=pos[c+2]-pos[a+2];
          const px=dy*e2z-dz*e2y,py=dz*e2x-dx*e2z,pz=dx*e2y-dy*e2x,det=e1x*px+e1y*py+e1z*pz;
          if(Math.abs(det)<1e-12)continue;const inv=1/det,tx=ax-pos[a],ty=ay-pos[a+1],tz=az-pos[a+2];
          const u=(tx*px+ty*py+tz*pz)*inv;if(u<0||u>1)continue;
          const qx=ty*e1z-tz*e1y,qy=tz*e1x-tx*e1z,qz=tx*e1y-ty*e1x,v=(dx*qx+dy*qy+dz*qz)*inv;if(v<0||u+v>1)continue;
          const s=(e2x*qx+e2y*qy+e2z*qz)*inv;if(s>=0&&s<=1&&s<best)best=s;}
      if(best<=exit||exit>=t1)break;
      if(tmx<tmz){cx+=sx;enter=tmx;tmx+=tdx;if(cx<0||cx>=gx)break;}else{cz+=sz;enter=tmz;tmz+=tdz;if(cz<0||cz>=gz)break;}
    }
    return best===Infinity?-1:best;
  }
  impact(a,b){
    if(!this.scene)return this.fieldImpact(a,b);
    const s=this.scale,t=this.sceneHit(a.x/s,a.y/s,a.z/s,b.x/s,b.y/s,b.z/s);
    return t<0?null:{x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:a.z+(b.z-a.z)*t,t};
  }
  // 지표 높이. y를 주면 그 높이 아래로 처음 만나는 면 (아치 · 다리 아래를 지날 때). 메시 밖은 해저 높이장 (해수면 위는 0)
  height(x,z,y){
    if(!this.scene)return this.fieldHeight(x,z);
    const s=this.scale,top=y===undefined?this.scene.maxY+1:Math.min(y/s,this.scene.maxY+1),t=this.sceneHit(x/s,top,z/s,x/s,-1000,z/s);
    return t>=0?(top+(-1000-top)*t)*s:Math.min(this.fieldHeight(x,z),this.seaLevel);
  }
  // 화면용 메시 (현재 배율 적용, uv = 지형 전체 0~1 · 높이장 PlaneGeometry와 같은 방향, 색 = 높이 색)
  sceneGeometry(THREE){
    const S=this.scene,s=this.scale,W=this.meta.worldSize,n=S.pos.length/3,p=new Float32Array(S.pos.length),uv=new Float32Array(n*2),col=new Float32Array(n*3);
    for(let i=0;i<n;i++){const x=S.pos[i*3],y=S.pos[i*3+1],z=S.pos[i*3+2];p[i*3]=x*s;p[i*3+1]=y*s;p[i*3+2]=z*s;
      uv[i*2]=(x+W/2)/W;uv[i*2+1]=1-(z+W/2)/W;
      const f=Math.max(0,Math.min(1,y/Math.max(1,this.meta.altMax)));col[i*3]=.27+f*.34;col[i*3+1]=.34+f*.3;col[i*3+2]=.22+f*.3;}
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(p,3));g.setAttribute('uv',new THREE.BufferAttribute(uv,2));
    g.setAttribute('color',new THREE.BufferAttribute(col,3));g.setAttribute('aBld',new THREE.BufferAttribute(Float32Array.from(S.bld||new Uint8Array(n)),1));g.setIndex(new THREE.BufferAttribute(S.index,1));g.computeVertexNormals();g.computeBoundingSphere();
    return g;
  }
  Create_work_lights(THREE){
    if(!this.scene||!this.scene.work_lights.length)return null;
    const group=new THREE.Group(),s=this.scale,night=root.MapAtmosphere?root.MapAtmosphere.STRUCT_WIN.value:0;
    const steel=new THREE.MeshStandardMaterial({color:0x394651,roughness:.8});
    const lamp=new THREE.MeshStandardMaterial({color:0xd4e4ed,emissive:0xc9e2ff,emissiveIntensity:2*night,roughness:.4});
    lamp.userData.workLamp=true;
    const pole_geometry=new THREE.CylinderGeometry(.09*s,.13*s,4*s,6),housing_geometry=new THREE.BoxGeometry(1.4*s,.35*s,.65*s),lamp_geometry=new THREE.BoxGeometry(1.2*s,.09*s,.5*s);
    for(const p of this.scene.work_lights){
      const pole=new THREE.Mesh(pole_geometry,steel);pole.position.set(p.x*s,(p.y+2)*s,p.z*s);group.add(pole);
      const housing=new THREE.Mesh(housing_geometry,steel);housing.position.set(p.x*s,(p.y+4)*s,p.z*s);group.add(housing);
      const bulb=new THREE.Mesh(lamp_geometry,lamp);bulb.position.set(p.x*s,(p.y+3.8)*s,p.z*s);group.add(bulb);
      const light=new THREE.PointLight(0xc9e2ff,4*night,22*s,2);light.position.copy(bulb.position);light.position.y-=.2*s;
      if(root.MapScenery)root.MapScenery.lightColor(light.color);
      light.userData.workLight=4;group.add(light);
    }
    return group;
  }
  /* 지형 색 (원본 terrainColor.js와 같은 방식): 구운 텍스처는 높이장이 땅인 곳에서만 믿고,
     나머지 수면 위 메시(높이장엔 물로 기록된 빙붕 · 부빙 · 잔교, 텍스처 범위 밖)는 해발 → 색 표(lut) + 잡음.
     둘은 높이장 땅 마스크의 흐린 경계로 이어 붙임. material = map이 있는 MeshStandardMaterial */
  /* 지형 굴곡 텍스처 (높이장에서 한 번 구움): R = 오목 · 볼록(능선 밝게 · 골짜기 어둡게), G = 넓은 차폐(골짜기 · 산 사이 어두움), B = 경사.
     칸 반경을 미터로 정해 맵 크기 · 해상도와 상관없이 비슷한 느낌 */
  reliefCanvas(){
    if(this._relief)return this._relief;
    const n=this.n,H=this.heights,cell=Math.max(1e-3,this.meta.worldSize/(n-1));
    const box=(src,r)=>{ // 분리형 상자 흐림 2번 ≈ 가우스
      let a=src,b=new Float32Array(n*n);
      for(let pass=0;pass<2;pass++){
        for(let z=0;z<n;z++){let acc=0;const o=z*n;
          for(let x=-r;x<=r;x++)acc+=a[o+Math.min(n-1,Math.max(0,x))];
          for(let x=0;x<n;x++){b[o+x]=acc/(2*r+1);acc+=a[o+Math.min(n-1,x+r+1)]-a[o+Math.max(0,x-r)];}}
        const c=new Float32Array(n*n);
        for(let x=0;x<n;x++){let acc=0;
          for(let z=-r;z<=r;z++)acc+=b[Math.min(n-1,Math.max(0,z))*n+x];
          for(let z=0;z<n;z++){c[z*n+x]=acc/(2*r+1);acc+=b[Math.min(n-1,z+r+1)*n+x]-b[Math.max(0,z-r)*n+x];}}
        a=c;}
      return a;};
    const R=m=>Math.max(1,Math.round(m/cell/2));
    const b1=box(H,R(8)),b2=box(H,R(30)),b3=box(H,R(90)),b4=box(H,R(260));
    const cv=document.createElement('canvas');cv.width=cv.height=n;
    const cx=cv.getContext('2d'),img=cx.createImageData(n,n),d=img.data;
    for(let z=0;z<n;z++)for(let x=0;x<n;x++){
      const i=z*n+x,h=H[i];
      const cav=(h-b1[i])/2.5+(h-b2[i])/9+(h-b3[i])/30;
      const occ=Math.max(0,b2[i]-h)/10+Math.max(0,b3[i]-h)/28+Math.max(0,b4[i]-h)/70;
      const gx=(H[z*n+Math.min(n-1,x+1)]-H[z*n+Math.max(0,x-1)])/(2*cell),gz=(H[Math.min(n-1,z+1)*n+x]-H[Math.max(0,z-1)*n+x])/(2*cell);
      d[i*4]=255*(.5+.5*Math.tanh(cav*.6));
      d[i*4+1]=255*Math.max(0,1-Math.tanh(occ*.55));
      d[i*4+2]=255*Math.min(1,Math.hypot(gx,gz)/1.4);
      d[i*4+3]=255;}
    cx.putImageData(img,0,0);
    return this._relief=cv;
  }
  /* 지형 빛 텍스처 (높이장에서 한 번 구움, 모든 맵):
     R = 하늘이 보이는 정도 (8방향 지평선 각도. 골짜기 · 절벽 틈 · 높은 바위 옆은 하늘빛을 덜 받아 어두움),
     G = 드러난 바위 규모 (주변 ~40 m 높낮이 차 → 바위 무늬 크기 2 ~ 32 m (배율 1), log2로 0 ~ 1),
     B = 오목 · 볼록 (능선 밝게 · 틈 어둡게). 배치는 reliefCanvas와 같음 (행 = z, 열 = x) */
  lightCanvas(){
    if(this._light)return this._light;
    const n0=this.n,stride=n0>513?2:1,N=(n0-1)/stride+1,H=new Float32Array(N*N),cell=Math.max(1e-3,this.meta.worldSize/(N-1));
    for(let r=0;r<N;r++)for(let c=0;c<N;c++)H[r*N+c]=Math.max(this.heights[r*stride*n0+c*stride],-2);
    const at=(r,c)=>H[Math.max(0,Math.min(N-1,r))*N+Math.max(0,Math.min(N-1,c))];
    // 국소 최고 · 최저 (분리형 이동 창, 반경 R칸)
    const R=Math.max(2,Math.round(40/cell)),win=(src,fn)=>{const a=new Float32Array(N*N),b=new Float32Array(N*N);
      for(let r=0;r<N;r++)for(let c=0;c<N;c++){let v=src[r*N+c];for(let k=-R;k<=R;k++)v=fn(v,src[r*N+Math.max(0,Math.min(N-1,c+k))]);a[r*N+c]=v;}
      for(let r=0;r<N;r++)for(let c=0;c<N;c++){let v=a[r*N+c];for(let k=-R;k<=R;k++)v=fn(v,a[Math.max(0,Math.min(N-1,r+k))*N+c]);b[r*N+c]=v;}return b;};
    const hi=win(H,Math.max),lo=win(H,Math.min);
    const dirs=[[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1],[0,-1],[1,-1]],steps=[1,2,3,4,6,8,11,15,20,27,36,48,64,85];
    const cv=document.createElement('canvas');cv.width=cv.height=N;
    const cx=cv.getContext('2d'),img=cx.createImageData(N,N),d=img.data;
    for(let r=0;r<N;r++)for(let c=0;c<N;c++){
      const i=r*N+c,h=H[i];let sky=0;
      for(const [dx,dz] of dirs){let t=0;const len=Math.hypot(dx,dz)*cell;
        for(const k of steps){const rr=r+dz*k,cc=c+dx*k;if(rr<0||cc<0||rr>=N||cc>=N)break;t=Math.max(t,(H[rr*N+cc]-h)/(k*len));}
        sky+=1-Math.sin(Math.atan(t));}
      sky/=8;
      const rock=Math.max(2,Math.min(32,(hi[i]-lo[i])*.25)),avg=(at(r-2,c)+at(r+2,c)+at(r,c-2)+at(r,c+2))/4,cav=(h-avg)/(2*cell);
      d[i*4]=255*sky;d[i*4+1]=255*Math.max(0,Math.min(1,(Math.log2(rock)-1)/4));d[i*4+2]=255*(.5+.5*Math.tanh(cav*1.5));d[i*4+3]=255;
    }
    cx.putImageData(img,0,0);
    return this._light=cv;
  }
  paintMaterial(THREE, material, lut){
    if(!lut||!lut.colors||!lut.colors.length)return material;
    const M=512,raw=document.createElement('canvas');raw.width=raw.height=M;
    const rc=raw.getContext('2d'),img=rc.createImageData(M,M),n=this.n;
    for(let r=0;r<M;r++)for(let c=0;c<M;c++){
      const v=this.heights[Math.min(n-1,Math.floor((r+.5)/M*n))*n+Math.min(n-1,Math.floor((c+.5)/M*n))]>this.seaLevel?255:0,i=(r*M+c)*4;
      img.data[i]=img.data[i+1]=img.data[i+2]=v;img.data[i+3]=255;
    }
    rc.putImageData(img,0,0);
    const cv=document.createElement('canvas');cv.width=cv.height=M;const cx=cv.getContext('2d');cx.filter='blur(1.5px)';cx.drawImage(raw,0,0);
    const mask=new THREE.CanvasTexture(cv);
    const data=new Uint8Array(lut.colors.length*4);
    lut.colors.forEach((h,i)=>{const v=parseInt(h.slice(1),16);data.set([(v>>16)&255,(v>>8)&255,v&255,255],i*4);});
    const lutTex=new THREE.DataTexture(data,lut.colors.length,1,THREE.RGBAFormat);
    lutTex.minFilter=lutTex.magFilter=THREE.LinearFilter;lutTex.needsUpdate=true;
    /* 얼음 맵(이 지형) 전용 표현: 굴곡 음영 · 미세 요철 · 면 단위 음영 · 플레이 구역 바깥 빙붕 무늬.
       다른 맵은 uIce = 0이라 예전 그대로 (높이장 · 구운 텍스처 · 색표만) */
    const ice=TerrainField.ICE_MAPS.includes(this.meta.slug)||!!lut.ice;
    const relief=ice?new THREE.CanvasTexture(this.reliefCanvas()):null;if(relief)relief.anisotropy=8;
    // 실제 게임 메시: 원본 sceneMaterials.js처럼 면 단위 음영 (정점 평균 법선은 빙벽 모서리를 녹은 것처럼 뭉갬)
    if(ice&&this.scene){material.flatShading=true;material.roughness=.9;material.metalness=.03;material.needsUpdate=true;}
    // 플레이 구역(에어월) 상자 · 배율 1 좌표. 바깥 = 배경 지형: 구운 텍스처는 미니맵 밖이라 자글자글한 채움, 메시는 계단식이라 높이별 색이 줄무늬가 됨
    const bx=this.boundary.map(p=>p.x/this.scale),bz=this.boundary.map(p=>p.z/this.scale),big=1e7;
    const play=bx.length>=3?new THREE.Vector4(Math.min(...bx),Math.min(...bz),Math.max(...bx),Math.max(...bz)):new THREE.Vector4(-big,-big,big,big);
    // 바깥 무늬 = 플레이 구역 안에서 높이장이 땅인 가장 큰 정사각형(구운 텍스처가 제대로 된 빙붕)을 거울 반복. 못 찾으면 색표 위쪽 평균색
    const hi=lut.colors.slice(Math.floor(lut.colors.length*.35)),fb=[0,0,0];
    hi.forEach(h=>{const v=parseInt(h.slice(1),16);fb[0]+=((v>>16)&255)/255;fb[1]+=((v>>8)&255)/255;fb[2]+=(v&255)/255;});
    const patch=new THREE.Vector4(0,0,0,0);let patchM=1;
    if(ice){
      const W=this.meta.worldSize,cu=W/(n-1),sq=new Uint16Array(n*n);let best=0,br=0,bc=0;
      for(let r=0;r<n;r++)for(let c=0;c<n;c++){
        const x=-W/2+c*cu,z=-W/2+r*cu,i=r*n+c;
        if(!(this.heights[i]>this.seaLevel+.5&&x>play.x&&x<play.z&&z>play.y&&z<play.w))continue;
        sq[i]=r&&c?1+Math.min(sq[i-n],sq[i-1],sq[i-n-1]):1;
        if(sq[i]>best){best=sq[i];br=r;bc=c;}}
      if(best>=16){const s=Math.floor(best*.8),r0=br-best+1+Math.floor((best-s)/2),c0=bc-best+1+Math.floor((best-s)/2);
        patch.set(c0/(n-1),1-(r0+s)/(n-1),s/(n-1),s/(n-1));patchM=s*cu;}
    }
    // 빙붕 조각 평균 밝기: 명암 결만 쓰도록 나눔 (file://처럼 이미지를 못 읽으면 얼음 평균치)
    let patchLum=.85;
    if(patch.z>0&&material.map&&material.map.image)try{
      const im=material.map.image,S=64,c=document.createElement('canvas');c.width=c.height=S;const g=c.getContext('2d'),W=im.width,H=im.height;
      g.drawImage(im,patch.x*W,(1-patch.y-patch.w)*H,patch.z*W,patch.w*H,0,0,S,S);
      const d=g.getImageData(0,0,S,S).data;let s=0;for(let i=0;i<d.length;i+=4)s+=.3*d[i]+.59*d[i+1]+.11*d[i+2];patchLum=Math.max(.05,s/(S*S)/255);
    }catch{}
    /* 바위 · 풀 질감 (얼음 맵 제외 모든 맵): 미니맵에서 구운 색 텍스처는 위에서 내려다본 그림이라 절벽에 세로로 늘어지고,
       그림 속 모서리 · 금이 실제 3D 면과 어긋남. 그래서 색 텍스처는 넓은 색(밉맵 흐림)만 쓰고, 결 · 요철은 실제 면 방향에
       맞춰 세 방향으로 투영(triplanar)한 바위 · 풀 사진 질감과 법선 맵으로 그림 → 금 · 층리가 삼각형 면을 따라감 */
    // 맵마다 바위 결 · 색 (TerrainField.MAP_ROCK, 썸네일 기준)
    const rockCfg=TerrainField.MAP_ROCK[this.meta.slug]||{style:'granite',tint:0x7c7a76,mapMix:.75};
    // 얼음 맵도 질감을 씀 (셰이더에서 uIce로 얼음 전용 분기: 옆면 눈벽 · 물가 빙벽 · 윗면 눈)
    const det=TerrainField.detailTextures(THREE,rockCfg.style,rockCfg.ground),detOn={value:det.ready?1:0};
    if(!det.ready)det.wait.push(()=>{detOn.value=1;});
    const light=new THREE.CanvasTexture(this.lightCanvas());light.minFilter=THREE.LinearFilter;light.generateMipmaps=false;
    // 지형 색은 셰이더에서 직접 만들므로 공통 색 처리(scenery.js fixColors)는 건너뛰고, 렌더러가 선형이면 마지막에 직접 바꿈
    material.userData.noColorFix=true;
    // 하늘 환경광은 함재기 · 함선과 같은 맵 공통 세기 (맵 변경 시 scenery.js가 함께 갱신).
    material.envMapIntensity=(root.MapScenery&&root.MapScenery.env.intensity)||0;
    const MA=root.MapAtmosphere,uniforms={uLinOut:{value:root.MapScenery&&root.MapScenery.color.linear?1:0},uLight:{value:light},uDetOn:detOn,uRockC:{value:det.rockC},uRockN:{value:det.rockN},uGrassC:{value:det.grassC},uGrassN:{value:det.grassN},
      uRockMean:{value:new THREE.Vector3(det.mean[0]/255,det.mean[1]/255,det.mean[2]/255)},uRockTint:{value:new THREE.Color(rockCfg.tint)},uRockMapMix:{value:rockCfg.mapMix},uMoss:{value:rockCfg.moss??.5},uWallLum:{value:new THREE.Vector4(...det.rockLum)},uTopLum:{value:new THREE.Vector4(...det.groundLum)},uRockChroma:{value:rockCfg.chroma??.4},uGrassMean:{value:new THREE.Vector3(det.groundMean[0]/255,det.groundMean[1]/255,det.groundMean[2]/255)},uIce:{value:ice?1:0},uPatch:{value:patch},uPatchM:{value:patchM},uPatchLum:{value:patchLum},uPlay:{value:play},uFallback:{value:new THREE.Vector3(fb[0]/hi.length,fb[1]/hi.length,fb[2]/hi.length)},uRelief:{value:relief},uMask:{value:mask},uLut:{value:lutTex},uLutMax:{value:Math.max(1,lut.max||this.meta.altMax)},uInvScale:{value:1/this.scale},uSWin:(MA&&MA.STRUCT_WIN)||{value:0},uSand:(MA&&MA.SAND&&MA.SAND.value)?MA.SAND:{value:new THREE.Color(0xb4a88a)},uCloudSh:(MA&&MA.CLOUD)||{value:0},uCloudT:(MA&&MA.TIME)||{value:0}};
    material.extensions=Object.assign(material.extensions||{},{derivatives:true});
    material.onBeforeCompile=sh=>{
      Object.assign(sh.uniforms,uniforms);
      sh.vertexShader='varying vec3 vTerrainP; varying vec3 vTerrainN; attribute float aBld; varying float vBld;\n'+sh.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\n  vTerrainP = transformed; vTerrainN = objectNormal; vBld = aBld;');
      sh.fragmentShader=(MA?MA.CLOUD_GLSL:'uniform float uCloudSh; uniform float uCloudT; float cloudShadow(vec2 xz){return 0.;}')+`varying vec3 vTerrainP; varying float vBld; uniform float uSWin; uniform vec3 uSand; uniform sampler2D uRelief; uniform sampler2D uMask; uniform sampler2D uLut; uniform float uLutMax; uniform float uInvScale; uniform vec4 uPlay; uniform vec3 uFallback; uniform float uIce; uniform vec4 uPatch; uniform float uPatchM; uniform float uPatchLum;
uniform sampler2D uLight; uniform float uLinOut;
varying vec3 vTerrainN; uniform float uDetOn; uniform sampler2D uRockC; uniform sampler2D uRockN; uniform sampler2D uGrassC; uniform sampler2D uGrassN; uniform vec3 uRockMean; uniform vec3 uGrassMean; uniform vec3 uRockTint; uniform float uRockMapMix; uniform float uMoss; uniform float uRockChroma; uniform vec4 uWallLum; uniform vec4 uTopLum;
/* 2×2 아틀라스 (칸 1024px 중 32px 여백) 한 칸을 반복해 읽음. 칸 경계에서 밉맵이 튀지 않게 원래 좌표의 미분으로 읽음 (WebGL2)
   band = 세로 띠 칸 (v는 반복하지 않고 0 ~ 1로 고정) */
vec4 tAtl(sampler2D t, vec2 uv, float i, float band){
  vec2 o = vec2(mod(i, 2.), 1. - floor(i/2.))*.5;
  vec2 f = vec2(fract(uv.x), band > .5 ? clamp(uv.y, .002, .998) : fract(uv.y));
  vec2 a = o + (.03125 + f*.9375)*.5;
#if __VERSION__ >= 300
  return textureGrad(t, a, dFdx(uv)*.46875, dFdy(uv)*.46875);
#else
  return texture2D(t, a);
#endif
}
// 세 방향 투영 (아틀라스 칸 i). 무게가 거의 0인 방향은 건너뜀
vec3 triA(sampler2D t, vec3 q, vec3 w, float i){
  vec3 c = vec3(0.);
  if (w.x > .02) c += tAtl(t, q.zy, i, 0.).rgb*w.x;
  if (w.y > .02) c += tAtl(t, q.xz, i, 0.).rgb*w.y;
  if (w.z > .02) c += tAtl(t, q.xy, i, 0.).rgb*w.z;
  return c/max(dot(step(.02, w), w), 1e-4);
}
vec3 triAN(sampler2D t, vec3 q, vec3 n, vec3 w, float i){
  vec3 tx = vec3(0., 0., 1.), ty = tx, tz = tx;
  if (w.x > .02) tx = tAtl(t, q.zy, i, 0.).xyz*2. - 1.;
  if (w.y > .02) ty = tAtl(t, q.xz, i, 0.).xyz*2. - 1.;
  if (w.z > .02) tz = tAtl(t, q.xy, i, 0.).xyz*2. - 1.;
  tx = vec3(tx.xy + n.zy, abs(tx.z)*n.x); ty = vec3(ty.xy + n.xz, abs(ty.z)*n.y); tz = vec3(tz.xy + n.xy, abs(tz.z)*n.z);
  return normalize(tx.zyx*w.x + ty.xzy*w.y + tz.xyz*w.z);
}
float tPick(vec4 v, float i){ return dot(v, vec4(equal(vec4(i), vec4(0., 1., 2., 3.)))); }
// 면 법선 (이 지형 메시는 면 단위 음영): 위치 미분 → 카메라 쪽을 향하는 면 법선 (three.js flatShading과 같은 방식)
vec3 tFaceN(){ vec3 n = cross(dFdx(vTerrainP), dFdy(vTerrainP)); float l = length(n); return l > 1e-8 ? n/l : vec3(0., 1., 0.); }
// 세 방향 투영 가중치 (면이 향한 축일수록 큼, 경계는 짧게 섞음)
// 메시 법선이 0인 곳(겹친 점 · 퇴화 삼각형)은 위쪽으로 (그대로 정규화하면 NaN → 검은 얼룩)
vec3 tNrm(vec3 n){ float l = length(n); return l > 1e-4 ? n/l : vec3(0., 1., 0.); }
vec3 triW(vec3 n){ vec3 w = pow(abs(n), vec3(5.)); return w/max(dot(w, vec3(1.)), 1e-5); }
vec3 triC(sampler2D t, vec3 q, vec3 w){ return texture2D(t, q.zy).rgb*w.x + texture2D(t, q.xz).rgb*w.y + texture2D(t, q.xy).rgb*w.z; }
// 법선 맵 세 방향 투영 (Ben Golus의 whiteout 섞기): 결과는 월드 법선
vec3 triN(sampler2D t, vec3 q, vec3 n, vec3 w){
  vec3 tx = texture2D(t, q.zy).xyz*2. - 1., ty = texture2D(t, q.xz).xyz*2. - 1., tz = texture2D(t, q.xy).xyz*2. - 1.;
  tx = vec3(tx.xy + n.zy, abs(tx.z)*n.x); ty = vec3(ty.xy + n.xz, abs(ty.z)*n.y); tz = vec3(tz.xy + n.xy, abs(tz.z)*n.z);
  return normalize(tx.zyx*w.x + ty.xzy*w.y + tz.xyz*w.z);
}
/* 바위 무늬 크기 = 드러난 바위 규모 (uLight.g → log2 m). 크기를 연속으로 바꾸면 무늬가 늘어나 보이므로
   2배씩 다른 두 크기로 그리고 사이를 섞음. 반환 xy: 작은 쪽 크기(m), 섞는 비율 */
vec2 rockScale(vec2 tuv){ float lt = 1. + 4.*texture2D(uLight, tuv).g; return vec2(exp2(floor(lt)), fract(lt)); }
vec3 rockTex(vec3 q, vec3 w, vec2 sc){ return mix(triC(uRockC, q/sc.x, w), triC(uRockC, q/(2.*sc.x) + vec3(.37, .11, .73), w), sc.y); }
vec3 rockNrm(vec3 q, vec3 n, vec3 w, vec2 sc){ return normalize(mix(triN(uRockN, q/sc.x, n, w), triN(uRockN, q/(2.*sc.x) + vec3(.37, .11, .73), n, w), sc.y)); }
float tHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7)))*43758.5453); }
// 플레이 구역 안 = 1, 바깥 60 m 넘으면 0 (배율 1 좌표). 얼음 맵이 아니면 항상 1 (예전 그대로)
float tInPlay(vec2 q){ vec2 d = min(q - uPlay.xy, uPlay.zw - q); return mix(1., smoothstep(-60., 0., min(d.x, d.y)), uIce); }
float tNoise(vec2 p){ vec2 i = floor(p), f = fract(p), u = f*f*(3. - 2.*f);
  return mix(mix(tHash(i), tHash(i + vec2(1, 0)), u.x), mix(tHash(i + vec2(0, 1)), tHash(i + vec2(1, 1)), u.x), u.y)*2. - 1.; }
/* 구역 고르기 (이 지형): 큰 잡음(크기 s m)으로 0 ~ n-1 칸 중 두 칸과 섞는 비율 (경계 30%에서만 섞음) */
vec3 tZone(vec2 xz, float s, float n, float seed){
  float v = clamp(.5 + .75*(tNoise(xz/s + seed)*.7 + tNoise(xz/(s*.37) - seed)*.3), 0., .999)*n;
  float i0 = floor(v); return vec3(i0, min(i0 + 1., n - 1.), smoothstep(.7, 1., fract(v)));
}
// 물가 띠 (Ice_cracked_a, 아틀라스 칸 3): 가로는 벽을 따라 반복, 세로는 해발 0 ~ H m에 한 번 (아래 갈라진 얼음 → 위 눈)
vec4 tBand(sampler2D t, vec3 q, vec3 w, float H){
  float wx = w.x/max(w.x + w.z, 1e-4), v = q.y/H;
  return tAtl(t, vec2(q.z/(H*1.1), v), 3., 1.)*wx + tAtl(t, vec2(q.x/(H*1.1), v), 3., 1.)*(1. - wx);
}
`+sh.fragmentShader.replace('#include <map_fragment>',`
  vec2 tuv = clamp(vUv, 0., 1.), tEdge = min(vUv, 1. - vUv);
  vec2 txz = vTerrainP.xz*uInvScale; float alt = vTerrainP.y*uInvScale;
  float tIn = tInPlay(txz);
  float trust = smoothstep(0., .01, min(tEdge.x, tEdge.y)) * texture2D(uMask, tuv).r * tIn;
  // 높이장이 땅이 아닌 곳(빙붕 · 부빙 · 맵 바깥): 색 = 높이별 색표 (인게임 미니맵 색). 얼음 맵은 여기에 맵 안쪽 빙붕 텍스처의
  // 명암 결(금 · 얼룩)만 거울 반복으로 곱함 → 플레이 구역 안팎이 같은 방식이라 경계에서 끊기지 않음
  vec3 byH = texture2D(uLut, vec2(clamp(alt/uLutMax, 0., 1.), .5)).rgb;
  if (uPatch.z > 0.) {
    vec2 pr = 1. - abs(mod(txz/uPatchM, 2.) - 1.);
    float pl = dot(texture2D(map, uPatch.xy + uPatch.zw*pr).rgb, vec3(.3, .59, .11)) / uPatchLum;
    byH *= mix(1., clamp(pl, .55, 1.3), .85);
  }
  byH *= 1. + .12*(tNoise(txz/12.)*.25 + tNoise(txz/40.)*.35 + tNoise(txz/120.)*.4);
  // 질감을 입히는 맵은 구운 색의 넓은 색만 (밉맵 흐림): 그림 속 모서리 · 금이 실제 면과 어긋나 보이지 않게
  diffuseColor.rgb *= mix(byH, texture2D(map, tuv, uDetOn*(1. - uIce)*2.5).rgb, trust);
  // 색 변화 폭 넓히기 (모든 맵 · 땅만): 큰 구역마다 채도 · 따뜻함/차가움 · 밝기가 조금씩 달라 단조롭지 않게. 수십 m 이상 크기라 멀리서도 자글거리지 않음
  {
    float tV = smoothstep(-.5, 2., alt) * (1. - step(.5, vBld));
    float tv1 = tNoise(txz/90.), tv2 = tNoise(txz/260. + 7.3), tv3 = tNoise(txz/35. + 3.1), tv4 = tNoise(txz/600. - 2.7);
    vec3 cv = diffuseColor.rgb; float cl = dot(cv, vec3(.3, .59, .11));
    cv = max(vec3(0.), mix(vec3(cl), cv, 1. + .4*tv2 + .2*tv4));
    cv *= vec3(1. + .09*tv1 + .05*tv4, 1. + .03*tv3, 1. - .09*tv1 - .04*tv4);
    cv *= 1. + .1*tv3 + .06*tv4;
    diffuseColor.rgb = mix(diffuseColor.rgb, cv, tV);
  }
  // 굴곡 음영: 능선 · 볼록한 곳은 밝게, 골짜기 · 오목한 곳은 어둡게, 산 사이 넓은 차폐, 가파른 곳은 바위 결
  // 굴곡 음영 · 바위 결은 높이장이 땅인 곳에서만 (높이장으로 구운 값이라 빙붕 · 부빙 · 맵 바깥 메시엔 안 맞음 → 그곳은 원본처럼 색표 + 잡음만)
  float tRel = texture2D(uMask, tuv).r * smoothstep(-.5, 3., alt) * (1. - step(.5, vBld)) * tIn * uIce;
  if (tRel > 0.) {
    vec3 rel = texture2D(uRelief, tuv).rgb;
    float cav = rel.r*2. - 1., ao = rel.g, slope = rel.b;
    // 잔무늬는 한 픽셀보다 클 때만 (멀리서 모아레 점무늬 방지)
    float fine = 1. - smoothstep(.3, 1.5, length(fwidth(txz)));
    float tLum = dot(diffuseColor.rgb, vec3(.3, .59, .11));
    vec3 rock = mix(vec3(tLum), diffuseColor.rgb, .3) * vec3(1.06, 1., .92) * (1. + fine*.12*tNoise(txz/3.) + .1*tNoise(txz/11.));
    float rk = smoothstep(.5, .95, slope + .18*tNoise(txz/18.));
    vec3 c = mix(diffuseColor.rgb, rock, rk*.55);
    // 평지 · 완경사 흙/풀 얼룩 (단색 덩어리 느낌 줄이기)
    c *= 1. + (1. - rk)*(fine*.1*tNoise(txz/5.) + .08*tNoise(txz/22.));
    c *= (.6 + .4*ao) * clamp(1. + .5*cav, .6, 1.35);
    diffuseColor.rgb = mix(diffuseColor.rgb, c, tRel);
  }
  // 원본 재질이 없는 시추 시설: 도장된 강철과 낮은 부유체의 방청 도장.
  // 임의의 공간 격자로 흰색/주황 블록을 만들면 구조와 관계없는 체크무늬가 생김.
  if (vBld > 2.5) {
    vec3 rp = vTerrainP*uInvScale;
    float wear = .94 + .06*tNoise(rp.xz/9. + rp.y/7.);
    float deck = smoothstep(.65, .9, abs(normalize(vTerrainN).y));
    vec3 steel = mix(vec3(.38, .43, .46), vec3(.29, .33, .36), deck);
    // 벽의 세로 골은 가까이서만 보이게 해 원거리 줄무늬 깜빡임을 막음.
    float panel_axis = abs(vTerrainN.x) > abs(vTerrainN.z) ? rp.z : rp.x;
    float panel_detail = (1. - deck)*(1. - smoothstep(.04, .18, fwidth(panel_axis)));
    float panel = 1. - .12*pow(.5 + .5*cos(panel_axis*20.), 6.)*panel_detail;
    diffuseColor.rgb = mix(vec3(.38, .23, .16), steel, smoothstep(3., 7., rp.y))*wear*panel;
  }
  // 바위 · 풀 질감 (실제 면 방향 투영). 가파른 곳 = 바위 사진, 완만한 곳 = 맵 색 × 풀 · 흙 결, 물가는 젖은 바위처럼 어둡게
  if (uDetOn > .5 && uIce < .5) {
    float land = smoothstep(-.8, 1.5, alt)*(1. - step(.5, vBld));
    if (land > 0.) {
      vec3 tn = tNrm(vTerrainN), q = vTerrainP*uInvScale, w = triW(tn);
      vec3 L3 = vec3(.3, .59, .11);
      float near = 1. - smoothstep(.02, .12, length(fwidth(q)));
      vec4 tl = texture2D(uLight, tuv);
      // 바위 결 = 사진 그대로의 명암 · 금 · 층리. 무늬 크기는 드러난 바위 규모에 비례 (큰 절벽은 큰 결, 작은 바위는 잔 결) + 가까이서 잔 결
      vec2 sc = rockScale(tuv);
      vec3 rT = rockTex(q, w, sc)/uRockMean, rC = triC(uRockC, q/(sc.x*.27) + vec3(.71, .29, .13), w)/uRockMean;
      vec3 rT3 = rT*mix(vec3(1.), rC, near*.45);
      float rk = dot(rT3, L3);
      vec3 base = diffuseColor.rgb; float bl = dot(base, L3);
      float steep = smoothstep(.2, .42, 1. - tn.y + .06*tNoise(q.xz/15.));
      // 바위 색: 사진의 회색 결에 맵 색조를 조금 (맵마다 바위 기운이 다름). 명암 대비를 키워 금 · 틈이 또렷하게. 넓은 얼룩으로 밝은 · 어두운 바위 구역
      float mac = tNoise(q.xz/70. + q.y/50.)*.5 + tNoise(q.xz/23. - q.y/17.)*.3;
      // 차가운 회갈색 바위 (따뜻한 하늘빛과 대비). 금 · 틈은 어둡게, 볼록한 바위 면은 밝게
      // 바위 색 = 맵마다 정한 바위 색(썸네일) × 사진의 결 · 색 변화(평균으로 나눔: 층마다 붉고 누런 띠, 금 · 얼룩) + 구운 지형 색을 조금 (곳마다 다른 색)
      // 구운 색이 눈(밝고 채도 낮음)인 곳: 가파른 바위면엔 눈이 붙지 않으므로 그 맵의 바위색이 드러남 (소용돌이 · 이 지형의 검은 바위 + 눈)
      float bSat = (max(base.r, max(base.g, base.b)) - min(base.r, min(base.g, base.b)))/max(max(base.r, max(base.g, base.b)), .01);
      float snowy = smoothstep(.45, .7, bl)*(1. - smoothstep(.15, .35, bSat));
      // 눈 지대: 가파를수록 눈이 떨어져 바위가 드러남 (잡음으로 들쭉날쭉한 경계) → 검은 바위 + 눈 띠
      float bare = snowy*smoothstep(.25, .55, 1. - tn.y + .2*tNoise(q.xz/12. + q.y/9.));
      vec3 rockTint = mix(uRockTint, base*1.15, uRockMapMix*(1. - bare))*(1. + .3*mac);
      // 사진은 결(명암 · 층리 · 금)을 주고, 사진 자체 색조는 40%만 (색은 미니맵 기반 지형 색이 주인)
      vec3 rockDet = mix(vec3(dot(rT3, L3)), rT3, uRockChroma);
      vec3 rockCol = rockTint*pow(max(rockDet, vec3(0.)), vec3(1.35))*(.72 + .56*tl.b);
      // 절벽 턱 · 덜 가파른 면의 이끼 · 풀 (위를 볼수록, 잡음 얼룩으로 띄엄띄엄)
      vec3 gA = triC(uGrassC, q/4.5, w)/uGrassMean; float gl = dot(gA, L3);
      float moss = smoothstep(.45, .8, tn.y + .25*tNoise(q.xz/9. + q.y/7.))*(1. - smoothstep(.75, .95, tn.y))*smoothstep(1.5, 6., alt);
      vec3 mossCol = vec3(.2, .3, .1)*(mix(vec3(gl), gA, .4)*.7 + .3);
      rockCol = mix(rockCol, mossCol, moss*.8*uMoss);
      float green = smoothstep(.02, .1, base.g - max(base.r, base.b)*.92);
      vec3 flatCol = base*mix(vec3(rk*.45 + .55), mix(vec3(gl), gA, .3)*.8 + .2, green);
      vec3 c = mix(flatCol, rockCol, max(steep, bare));
      c *= mix(.55, 1., smoothstep(.3, 4., alt)); // 물가 젖은 바위
      diffuseColor.rgb = mix(diffuseColor.rgb, c, land);
    }
  }
  /* 얼음 맵 (이 지형) 질감: 게임 얼음 · 눈 질감 여러 장을 구역마다 다르게 (한 가지로 다 덮지 않음).
     옆면 = 빙벽 아틀라스 칸 0 ~ 2 (눈벽 세로 결 · 눈 덮인 절벽 · 푸른 빙벽)를 ~200 m 구역마다, 물가 = 칸 3 띠 (갈라진 얼음 → 눈).
     윗면 = 눈 아틀라스 칸 0 ~ 2 (눈 언덕 · 바람 자국 눈 · 구겨진 얼음눈)를 ~260 m 구역마다, 해수면 가까운 낮은 부빙 · 해빙 = 칸 3 (푸른 금 간 얼음).
     미니맵에서 구운 색은 위에서 본 그림이라 옆면에선 세로로 늘어지므로, 옆면 색은 질감이 주인 */
  if (uDetOn > .5 && uIce > .5) {
    float land = smoothstep(-.8, 1.5, alt)*(1. - step(.5, vBld));
    if (land > 0.) {
      vec3 q = vTerrainP*uInvScale, fn = tFaceN(), w = triW(fn), L3 = vec3(.3, .59, .11);
      float near = 1. - smoothstep(.03, .2, length(fwidth(q)));
      float steep = smoothstep(.3, .6, 1. - abs(fn.y));
      vec3 base = diffuseColor.rgb;
      vec3 wallCol = base, topCol = base;
      if (steep > 0.) {
        vec3 z = tZone(q.xz, 210., 3., 3.7);
        vec3 wc = triA(uRockC, q/28., w, z.x);
        if (z.z > 0.) wc = mix(wc, triA(uRockC, q/28., w, z.y), z.z);
        // 가까이 잔 결 (같은 칸을 4배 작게, 밝기만)
        if (near > 0.) wc *= mix(1., dot(triA(uRockC, q/7. + vec3(.37, .11, .73), w, z.x), L3)/tPick(uWallLum, z.x), .5*near);
        // 물가 띠: 해발 0 ~ 26 m에 갈라진 얼음 → 눈. 띠 윗부분은 구역 질감으로 넘어감 (잡음으로 들쭉날쭉)
        // (원본 띠는 회색 · 어두움 → 푸른 얼음 빛으로 밝게)
        float bandH = 18.;
        float bk = 1. - smoothstep(.55, .95, alt/bandH + .15*tNoise(q.xz/30.));
        if (bk > 0.) wc = mix(wc, tBand(uRockC, q, w, bandH).rgb*vec3(.92, 1.08, 1.25), bk*.8);
        wallCol = mix(wc, base, .15);
      }
      if (steep < 1.) {
        vec3 z = tZone(q.xz, 260., 3., -1.9);
        vec3 tc = triA(uGrassC, q/24., w, z.x);
        if (z.z > 0.) tc = mix(tc, triA(uGrassC, q/24., w, z.y), z.z);
        // 낮은 부빙 · 해빙 (해발 ~5 m 아래): 푸른 금 간 얼음
        float low = 1. - smoothstep(3., 8., alt + 2.5*tNoise(q.xz/45.));
        if (low > 0.) tc = mix(tc, triA(uGrassC, q/18., w, 3.), low);
        if (near > 0.) tc *= mix(1., dot(triA(uGrassC, q/6. + vec3(.71, .29, .13), w, low > .5 ? 3. : z.x), L3)/tPick(uTopLum, low > .5 ? 3. : z.x), .5*near);
        // 구운 색(지역별 밝기 · 그늘)을 조금 남김
        topCol = mix(tc, tc*dot(base, L3)/.85, .35);
      }
      diffuseColor.rgb = mix(diffuseColor.rgb, mix(topCol, wallCol, steep), land);
    }
  }
  // 해저: 수면 아래는 맵 모래색 (얕은 물로 비침). 지형 질감 밝기 결은 남기고, 깊을수록 어두워짐. 건물 · 구조물은 그대로
  if (vTerrainP.y < 0. && vBld < .5) {
    float dd = -vTerrainP.y, lv = dot(diffuseColor.rgb, vec3(.3, .59, .11));
    vec3 sand = uSand*clamp(.7 + .9*(lv - .3), .6, 1.15)*(1. - .5*smoothstep(3., 30., dd));
    diffuseColor.rgb = mix(diffuseColor.rgb, sand, smoothstep(.1, 1.5, dd)*.9);
  }
  diffuseColor.rgb *= 1. - uCloudSh*cloudShadow(vTerrainP.xz);
  if (uLinOut > .5) diffuseColor.rgb = pow(max(diffuseColor.rgb, 0.), vec3(2.2)); // 화면 색 → 선형 (빛 계산용)`)
        .replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
  // 바위 · 풀 법선 맵 (실제 면 방향 투영): 빛 · 그림자가 바위 결과 층리를 따라 생김
  if (uDetOn > .5 && uIce < .5) {
    vec3 q = vTerrainP*uInvScale;
    float land = smoothstep(-.8, 1.5, q.y)*(1. - step(.5, vBld));
    if (land > 0.) {
      vec3 tn = tNrm(vTerrainN), w = triW(tn);
      float near = 1. - smoothstep(.02, .12, length(fwidth(q)));
      float steep = smoothstep(.2, .42, 1. - tn.y + .06*tNoise(q.xz/15.));
      vec2 sc = rockScale(clamp(vUv, 0., 1.));
      vec3 nR = rockNrm(q, tn, w, sc);
      nR = normalize(mix(nR, triN(uRockN, q/(sc.x*.27) + vec3(.71, .29, .13), tn, w), near*.4));
      // 법선 맵을 조금 세게 (기울기 1.5배) → 바위 요철이 빛을 받아 도드라짐
      nR = normalize(tn + (nR - tn)*1.5);
      vec3 nG = normalize(mix(triN(uGrassN, q/4.5, tn, w), tn, .4));
      vec3 wn = normalize(mix(tn, normalize(mix(nG, nR, max(steep, .3))), land*.9));
      normal = normalize((viewMatrix*vec4(wn, 0.)).xyz)*(gl_FrontFacing ? 1. : -1.);
    }
  }
  // 얼음 맵 법선: 면 법선(면 단위 음영 유지) 위에 색과 같은 구역 · 칸의 법선 맵 → 옆면 세로 골 · 금, 윗면 눈 결이 빛을 받음
  if (uDetOn > .5 && uIce > .5) {
    vec3 q = vTerrainP*uInvScale;
    float land = smoothstep(-.8, 1.5, q.y)*(1. - step(.5, vBld));
    if (land > 0.) {
      vec3 fn = tFaceN(), w = triW(fn);
      float near = 1. - smoothstep(.03, .2, length(fwidth(q)));
      float steep = smoothstep(.3, .6, 1. - abs(fn.y));
      vec3 nW = fn, nS = fn;
      if (steep > 0.) {
        vec3 z = tZone(q.xz, 210., 3., 3.7);
        nW = triAN(uRockN, q/28., fn, w, z.x);
        if (near > 0.) nW = normalize(mix(nW, triAN(uRockN, q/7. + vec3(.37, .11, .73), fn, w, z.x), .5*near));
        float bk = (1. - smoothstep(.55, .95, q.y/18. + .15*tNoise(q.xz/30.)))*.8;
        if (bk > 0.) { vec3 tb = tBand(uRockN, q, w, 18.).xyz*2. - 1.; vec3 tg = normalize(vec3(-fn.z, 0., fn.x) + 1e-5), nb = normalize(fn*max(tb.z, .3) + tg*tb.x + vec3(0., tb.y, 0.)); nW = normalize(mix(nW, nb, bk)); }
        nW = normalize(fn + (nW - fn)*1.4);
      }
      if (steep < 1.) {
        vec3 z = tZone(q.xz, 260., 3., -1.9);
        float low = 1. - smoothstep(3., 8., q.y + 2.5*tNoise(q.xz/45.));
        nS = triAN(uGrassN, q/(low > .5 ? 18. : 24.), fn, w, low > .5 ? 3. : z.x);
        if (near > 0.) nS = normalize(mix(nS, triAN(uGrassN, q/6. + vec3(.71, .29, .13), fn, w, low > .5 ? 3. : z.x), .5*near));
      }
      vec3 wn = normalize(mix(fn, normalize(mix(nS, nW, steep)), land*.9));
      normal = normalize((viewMatrix*vec4(wn, 0.)).xyz);
    }
  }
  // 가까이서 보이는 미세 요철 (바위 · 흙 결): 잡음 높이의 기울기로 법선을 흔듦. 멀면 반짝임 없게 꺼짐
  {
    vec2 dq = vTerrainP.xz*uInvScale; float dAlt = vTerrainP.y*uInvScale;
    // 화면 한 픽셀이 덮는 실제 거리로 꺼짐 → 맵 배율과 상관없이 멀리서 모아레 · 반짝임 없음. 높이장이 땅인 곳만
    float dPix = length(fwidth(dq));
    float dK = (1. - smoothstep(.12, .45, dPix)) * smoothstep(-.5, 3., dAlt) * (1. - step(.5, vBld)) * texture2D(uMask, clamp(vUv, 0., 1.)).r * uIce;
    if (dK > 0.) {
      vec2 e = vec2(.6, 0.);
      #define DH(p) (tNoise((p)/2.5)*.5 + tNoise((p)/7.)*.9 + tNoise((p)/19.)*1.4)
      float hx = DH(dq + e.xy) - DH(dq - e.xy), hz = DH(dq + e.yx) - DH(dq - e.yx);
      vec3 dW = vec3(hx, 0., hz) / (2.*e.x) * .45 * dK;
      normal = normalize(normal - (viewMatrix*vec4(dW, 0.)).xyz);
    }
  }
  // 플레이 구역 바깥 배경 지형: 계단식 메시 면마다 명암이 갈려 줄무늬가 되므로 법선을 위쪽으로 눕혀 고르게
  {
    float tOut = (1. - tInPlay(vTerrainP.xz*uInvScale)) * (1. - step(.5, vBld));
    vec3 vUp = normalize((viewMatrix*vec4(0., 1., 0., 0.)).xyz);
    if (tOut > 0. && dot(normal, vUp) > 0.) normal = normalize(mix(normal, vUp, .85*tOut));
  }`)
        .replace('#include <lights_fragment_end>',`#include <lights_fragment_end>
  // 하늘이 가려진 곳(골짜기 · 절벽 틈 · 큰 바위 옆)은 하늘빛(반구광)을 덜 받고, 아주 깊은 틈은 햇빛도 조금 덜 → 면 방향 · 위치에 따라 밝기가 갈림
  {
    float kA = smoothstep(-1., 1., vTerrainP.y*uInvScale)*(1. - step(.5, vBld));
    float sky = texture2D(uLight, clamp(vUv, 0., 1.)).r;
    reflectedLight.indirectDiffuse *= mix(1., .45 + .55*sky, kA);
    reflectedLight.directDiffuse *= mix(1., .82 + .18*sky, kA);
  }`)
        .replace('#include <emissivemap_fragment>','#include <emissivemap_fragment>\n  vec3 sP = vTerrainP*uInvScale;\n  if (uSWin > 0. && vBld > .5 && vBld < 1.5) '+(MA?MA.WIN_GLSL:'{}').replace(/WP/g,'sP').replace('BASEY','0.').replace('SPACING','vec2(.9, 1.3)').replace(/MASK/g,'step(1.5, sP.y)').replace(/STRENGTH/g,'uSWin')
          // 구조물은 드문드문: 작은 창 · 켜진 창 14% · 12 m 구역 단위로 절반만 불 켜진 구역 · 은은하게
          .replace(/PW/g,'.32').replace('WALL0','.08').replace('WALL1','.14').replace('GAIN','.75').replace('LIT','.86').replace('GLOW','.012')
          .replace('CLUSTER','step(.5, fract(sin(dot(floor(sP.xz/12.) + floor(sP.y/5.)*7.13, vec2(41.3, 17.9)))*9341.7))'));
    };
    material.userData.paintTextures=[mask,lutTex,relief,light].filter(Boolean);
    return material;
  }
  // 조준 레이캐스트도 impact()로: 메시 수십만 삼각형을 three.js가 하나씩 검사하지 않게
  bindRaycast(mesh){
    const field=this;
    mesh.raycast=function(raycaster,out){
      const o=raycaster.ray.origin,d=raycaster.ray.direction,far=Math.min(raycaster.far,60000);
      const h=field.impact(o,{x:o.x+d.x*far,y:o.y+d.y*far,z:o.z+d.z*far});
      if(h&&far*h.t>=raycaster.near)out.push({distance:far*h.t,point:o.clone().set(h.x,h.y,h.z),object:mesh});
    };
  }
}
// terrain/scenes/<slug>.json + 지오메트리. 없는 맵은 null
TerrainField.loadScene=async function(base,slug){
  const r=await fetch(base+slug+'.json');if(!r.ok)return null;
  const meta=await r.json(),g=await fetch(base+meta.files.geometry);if(!g.ok)return null;
  return {meta,buffer:await g.arrayBuffer()};
};
/* 지형 해상도 옵션 (두 시뮬레이터 공통)
   normal: 513으로 줄인 데이터 · 같은 메시 (기본, 예전 성능)
   high:   원본 1025 데이터로 충돌·높이 계산 · 화면 메시는 한 칸씩 건너뛰어 513
   max:    원본 1025 데이터 · 1025 메시 그대로 */
TerrainField.QUALITIES={normal:{data:513,mesh:513},high:{data:0,mesh:513},max:{data:0,mesh:0}};
TerrainField.QUALITY_KEY='los-terrain-quality';
/* 바위 종류 (terrain/textures, ambientCG · Poly Haven CC0): 결(층리 · 금 · 덩어리)이 다른 사진. mean = 사진 평균색 (0~255) */
TerrainField.ROCK_STYLES={
  granite:  {c:'rock_color.jpg',n:'rock_normal.jpg',mean:[78,85,91]},                    // 회색 화강암 (빙하에 깎인 판)
  sandstone:{c:'rock_sandstone_color.jpg',n:'rock_sandstone_normal.jpg',mean:[124,83,49]}, // 가로 층리 사암
  basalt:   {c:'rock_basalt_color.jpg',n:'rock_basalt_normal.jpg',mean:[58,52,44]},        // 검은 화산암 · 현무암
  limestone:{c:'rock_limestone_color.jpg',n:'rock_limestone_normal.jpg',mean:[155,125,91]},// 덩어리로 갈라진 석회암 절벽
  brown:    {c:'rock_brown_color.jpg',n:'rock_brown_normal.jpg',mean:[131,105,80]},        // 갈색 바위
  /* 게임 원본 바위 (terrain/texture_map/Texture2D/*_A · *_N → textures/game 1024 jpg) */
  canyon:      {c:'game/canyon_c.jpg',n:'game/canyon_n.jpg',mean:[112,77,50]},             // CanyonRocks: 붉은 사암 협곡
  unexplored:  {c:'game/unexplored_c.jpg',n:'game/unexplored_n.jpg',mean:[118,111,106]},   // Unexplored_rocks: 회갈 바위
  unexplored_b:{c:'game/unexplored_b_c.jpg',n:'game/unexplored_b_n.jpg',mean:[90,83,76]},  // Unexplored_rocks_B: 층진 갈색 바위
  island_a:    {c:'game/island_a_c.jpg',n:'game/island_a_n.jpg',mean:[94,81,69]},          // Island_rocks_a: 적갈 해안 바위
  island_b:    {c:'game/island_b_c.jpg',n:'game/island_b_n.jpg',mean:[84,73,63]},
  island_c:    {c:'game/island_c_c.jpg',n:'game/island_c_n.jpg',mean:[73,68,61]},          // 어두운 회갈 바위
  nordic_coast:{c:'game/nordic_coast_c.jpg',n:'game/nordic_coast_n.jpg',mean:[57,54,43]},  // T_nordic_coastal_rocks: 검은 이끼 바위
  beach:       {c:'game/beach_c.jpg',n:'game/beach_n.jpg',mean:[47,43,36]},                // T_beach_rocks: 검은 화산암
  caspian:     {c:'game/caspian_c.jpg',n:'game/caspian_n.jpg',mean:[117,106,83]},          // T_caspian_rock: 밝은 석회암 판
  caspian_b:   {c:'game/caspian_b_c.jpg',n:'game/caspian_b_n.jpg',mean:[107,100,80]},      // T_caspian_rocks: 회녹 바위
  cliffs_snowy:{c:'game/cliffs_snowy_c.jpg',n:'game/cliffs_snowy_n.jpg',mean:[72,71,70]},  // Cliffs_snowy: 눈 낀 검은 절벽
  /* 이 지형 빙벽 아틀라스 (2×2, 칸마다 32px 여백): 0 T_snow_wall · 1 cliff_snow · 2 T_ice_cliff · 3 Ice_cracked_a (세로 띠: 아래 갈라진 얼음 → 위 눈)
     lum = 칸마다 평균 밝기 (가까이 잔 결 정규화) */
  ice_wall:    {c:'game/ice_wall_c.jpg',n:'game/ice_wall_n.jpg',mean:[200,200,200],lum:[.776,.81,.591,.575]},
};
/* 완만한 땅 (풀 · 모래 · 눈) 질감. 기본 = CC0 풀 */
TerrainField.GROUND_STYLES={
  grass:   {c:'grass_color.jpg',n:'grass_normal.jpg',mean:[96,109,48]},
  g_canyon:{c:'game/g_canyon_c.jpg',n:'game/g_canyon_n.jpg',mean:[107,88,47]},   // T_canyon_grass: 마른 풀 · 붉은 흙
  g_sand:  {c:'game/g_sand_c.jpg',n:'game/g_sand_n.jpg',mean:[121,80,52]},       // T_sandstone_rocky_sand
  g_tropic:{c:'game/g_tropic_c.jpg',n:'game/g_tropic_n.jpg',mean:[76,86,35]},    // grass_Albedo: 열대 풀
  g_japan: {c:'game/g_japan_c.jpg',n:'game/g_japan_n.jpg',mean:[86,90,33]},      // Japan_grass
  g_nordic:{c:'game/g_nordic_c.jpg',n:'game/g_nordic_n.jpg',mean:[89,86,44]},    // Nordic_grass
  g_med:   {c:'game/g_med_c.jpg',n:'game/g_med_n.jpg',mean:[112,115,66]},        // T_mediterranean_grass
  g_snow:  {c:'game/g_snow_c.jpg',n:'game/g_snow_n.jpg',mean:[214,222,234]},     // T_snow
  g_arctic:{c:'game/g_arctic_c.jpg',n:'game/g_arctic_n.jpg',mean:[216,218,222]}, // T_arctic_snow
  // 이 지형 윗면 아틀라스 (2×2): 0 T_arctic_snow · 1 T_snow · 2 ice_snow · 3 T_arctic_ice (해수면 가까운 낮은 부빙 · 해빙)
  // (snow_dunes는 위에서 보면 뭉게구름 · 거품처럼 보여서 뺌)
  ice_top: {c:'game/ice_top_c.jpg',n:'game/ice_top_n.jpg',mean:[218,222,230],lum:[.855,.868,.853,.601]},
};
/* 맵마다 바위 (원본 맵 썸네일 map-thumbnails/<slug>.webp를 보고 정함): style = 결, tint = 바위 색 (화면 색),
   mapMix = 구운 지형 색(미니맵 기반, 기본)을 쓰는 비율 (나머지가 tint) (맵 안에서도 곳마다 다른 바위 색을 살림), moss = 절벽 턱의 이끼 · 풀 (사막 · 극지는 거의 없음). 없는 맵은 granite · 회색 */
/* 게임 원본 질감 (texture_map)으로 교체. style = 바위, ground = 완만한 땅 (GROUND_STYLES), chroma = 바위 사진 자체 색을 쓰는 비율 (기본 .4) */
TerrainField.MAP_ROCK={
  'red-canyon':      {style:'canyon',      ground:'g_canyon',tint:0xa8603e,mapMix:.6,chroma:.7,moss:0.05}, // 붉은 사암 절벽
  'amber-rocks':   {style:'unexplored',  ground:'g_sand',  tint:0x9c6a4c,mapMix:.6,chroma:.7,moss:0.1},  // 황갈 · 적갈 바위섬
  'tropic-isles':        {style:'island_a',    ground:'g_tropic',tint:0x5e5c54,mapMix:.6,chroma:.6,moss:1},    // 열대 화산섬 (어두운 바위 · 숲)
  'misty-coast':      {style:'island_b',    ground:'g_japan', tint:0x646660,mapMix:.6,chroma:.6,moss:1},    // 회녹색 바위 해안
  'moss-archipelago':           {style:'nordic_coast',ground:'g_nordic',tint:0x4c4e4e,mapMix:.6,chroma:.6,moss:1},    // 검은 바위 · 이끼
  'obsidian-isle':        {style:'beach',       ground:'g_japan', tint:0x4a4742,mapMix:.6,chroma:.6,moss:0.6},  // 검은 화산암
  'basalt-rigs':             {style:'beach',       ground:'g_nordic',tint:0x40444a,mapMix:.6,chroma:.5,moss:0.3},
  'chalk-arches':    {style:'caspian',     ground:'g_med',   tint:0xccc6b8,mapMix:.6,chroma:.6,moss:0.35}, // 하얀 석회암 절벽 · 아치
  'karst-towers':        {style:'island_c',    ground:'g_japan', tint:0x9c8f7c,mapMix:.6,chroma:.6,moss:0.85}, // 회갈색 탑 카르스트
  'slate-bay':         {style:'caspian_b',   ground:'g_nordic',tint:0x8c8c88,mapMix:.6,chroma:.5,moss:0.6},  // 밝은 회색 바위 판
  'snow-cliffs':{style:'cliffs_snowy',ground:'g_snow',  tint:0x707274,mapMix:.6,chroma:.6,moss:0.2},
  'frost-fjord':     {style:'cliffs_snowy',ground:'g_arctic',tint:0x585b60,mapMix:.6,chroma:.6,moss:0.1},
  // 이 지형 (얼음 맵 전용 셰이더 분기): 옆면 = 빙벽 아틀라스, 윗면 = 눈 · 해빙 아틀라스 (구역마다 다른 칸)
  'ice-shelf':          {style:'ice_wall',    ground:'ice_top', tint:0xdfe6ee,mapMix:.6,moss:0},
  'rust-harbor':        {style:'unexplored_b',ground:'g_canyon',tint:0x846a54,mapMix:.6,chroma:.6,moss:0.5},  // 갈색 바위 · 단풍
  'ochre-ruins':          {style:'unexplored',  ground:'g_med',   tint:0x7c6c5a,mapMix:.6,chroma:.6,moss:0.4},  // 금빛 노을의 갈회색 산
};
/* 바위 · 풀 사진 질감. 종류마다 한 번만 읽음. 다 읽기 전에는 uDetOn = 0 (예전 모습)
   wait: 다 읽으면 부를 함수들 (paintMaterial이 재질마다 넣음) */
TerrainField.TEXTURE_BASE='data/textures/';
TerrainField.detailTextures=function(THREE,style,ground){
  const st=TerrainField.ROCK_STYLES[style]?style:'granite',gd=TerrainField.GROUND_STYLES[ground]?ground:'grass',key=st+'|'+gd,cache=this._det||(this._det={});
  if(cache[key])return cache[key];
  const L=new THREE.TextureLoader(),files=this._detFiles||(this._detFiles={}),det={ready:false,wait:[],style:st,mean:TerrainField.ROCK_STYLES[st].mean,groundMean:TerrainField.GROUND_STYLES[gd].mean};
  let left=4;const done=()=>{if(--left)return;det.ready=true;det.wait.splice(0).forEach(f=>f());};
  // 같은 파일(풀)은 종류끼리 공유. 이미 읽은 파일은 바로 done
  const load=f=>{const hit=files[f];
    if(hit){if(hit.loaded)setTimeout(done);else hit.cbs.push(done);return hit.tex;}
    const e=files[f]={loaded:false,cbs:[done]};
    e.tex=L.load(TerrainField.TEXTURE_BASE+f,()=>{e.loaded=true;e.cbs.splice(0).forEach(c=>c());},undefined,()=>console.warn('지형 질감을 읽지 못함: '+f));
    e.tex.wrapS=e.tex.wrapT=THREE.RepeatWrapping;e.tex.anisotropy=8;return e.tex;};
  const s=TerrainField.ROCK_STYLES[st];
  const g=TerrainField.GROUND_STYLES[gd];
  det.rockC=load(s.c);det.rockN=load(s.n);det.grassC=load(g.c);det.grassN=load(g.n);
  det.rockLum=s.lum||[1,1,1,1];det.groundLum=g.lum||[1,1,1,1];
  return cache[key]=det;
};
// 얼음 맵 전용 지형 표현을 쓰는 맵 (paintMaterial). 색표 lut.ice로도 켤 수 있음
TerrainField.ICE_MAPS=['ice-shelf'];
// 원본 scripts/downsample_terrain.py와 같은 방식: 3×3 최댓값을 짝수 격자점에서 취해 (2n+1)² → (n+1)².
// 최댓값이라 좁은 건물·봉우리가 낮아지지 않음. 끝점이 맞물려 worldSize·origin·altMin·altMax는 그대로.
TerrainField.downsample=function(meta,buffer,target){
  let n=meta.resolution,raw=new Uint16Array(buffer.slice(0,n*n*2));
  while(target&&n>target&&(n-1)%2===0){
    const m=(n-1)/2+1,out=new Uint16Array(m*m);
    for(let z=0;z<m;z++)for(let x=0;x<m;x++){
      let v=0;const cz=z*2,cx=x*2;
      for(let dz=-1;dz<=1;dz++){const zz=Math.min(n-1,Math.max(0,cz+dz))*n;
        for(let dx=-1;dx<=1;dx++){const r=raw[zz+Math.min(n-1,Math.max(0,cx+dx))];if(r>v)v=r;}}
      out[z*m+x]=v;
    }
    raw=out;n=m;
  }
  return {meta:n===meta.resolution?meta:{...meta,resolution:n,sourceResolution:meta.resolution},buffer:raw.buffer};
};
TerrainField.fromQuality=function(meta,buffer,quality){
  const q=TerrainField.QUALITIES[quality]||TerrainField.QUALITIES.normal,d=TerrainField.downsample(meta,buffer,q.data);
  const field=new TerrainField(d.meta,d.buffer);field.quality=quality in TerrainField.QUALITIES?quality:'normal';
  // 화면 메시 격자 간격 (데이터 격자 몇 칸마다 정점 하나)
  field.meshStep=1;while(q.mesh&&(field.n-1)/field.meshStep+1>q.mesh&&(field.n-1)%(field.meshStep*2)===0)field.meshStep*=2;
  return field;
};
root.TerrainField=TerrainField;
if(typeof module!=='undefined')module.exports=TerrainField;
})(globalThis);
