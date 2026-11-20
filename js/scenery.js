/* 그림자 · 나무 · 바위 (index.html 시점유도 sim · carrier.html 함재기 sim 공통)
   - 그림자: 태양(DirectionalLight) 그림자 맵을 카메라 둘레에만 깔고 카메라를 따라 옮김 (높이 오를수록 넓게).
     지형 · 함선 · 항공기 · 나무가 서로 · 물에 그림자를 드리움 (물은 ocean.js가 같은 그림자 맵을 읽음)
   - 나무 · 바위: 지형 메시의 실제 삼각형 위에 뿌림. 구운 지형 색이 초록인 완만한 곳 = 숲, 가파른 비탈 · 물가 = 바위.
     위치는 삼각형 안의 한 점이라 항상 실제 지면 높이에 붙음. 지형 배율(×10 등)에 맞춰 크기도 함께 커짐
   설정 (이 브라우저에 저장): shadows · sea(FFT 바다) · trees */
(function(root){
'use strict';
const opts = { shadows: true, sea: true, trees: true };
try { Object.assign(opts, JSON.parse(localStorage.getItem('scenery-opts') || '{}')); } catch {}
const saveOpts = () => { try { localStorage.setItem('scenery-opts', JSON.stringify(opts)); } catch {} };

/* 그림자. dir = 해 방향 벡터 (하늘 셰이더 sunDir과 같은 객체: 맵을 바꾸면 함께 바뀜) */
function shadows(THREE, renderer, sun, scene, dir, o = {}){
  const size = o.size || 4096;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.shadowMap.autoUpdate = false;
  const sh = sun.shadow; sh.mapSize.set(size, size); sh.bias = -.0008; sh.normalBias = .02;
  scene.add(sun.target);
  const _f = new THREE.Vector3(), _r = new THREE.Vector3(), _u = new THREE.Vector3(), _d = new THREE.Vector3();
  let frame = 0;
  const api = {
    half: 0,
    get on(){ return opts.shadows && sun.castShadow; },
    /* 매 프레임 렌더 전에. 그림자 범위 = 카메라 앞쪽 (지면 높이에 따라 넓어짐) */
    update(camera, ground = 0){
      sun.castShadow = opts.shadows;
      if ((frame % 45) === 0) fixColors(scene);
      if (!opts.shadows) { frame++; cullVegetation(camera); return; }
      const alt = Math.max(0, camera.position.y - ground);
      // 범위는 정해진 단계로만 바뀜 (고도에 따라 매 프레임 조금씩 바뀌면 그림자 한 칸 크기가 계속 달라져 경계가 지글거림)
      // 최소 900 m: 지상(LAV) · 저고도에서 범위 경계가 가까이 보이며 그림자가 생겼다 사라지지 않게
      const want = Math.min(4000, Math.max(900, 600 + alt*1.6));
      if (!api.half || want > api.half*1.05 || want < api.half/1.6) api.half = Math.min(4000, 900*Math.pow(1.5, Math.ceil(Math.log(want/900)/Math.log(1.5))));
      const half = api.half;
      camera.getWorldDirection(_f); _f.y = 0; if (_f.lengthSq() < 1e-6) _f.set(0, 0, -1); _f.normalize();
      // 카메라 앞쪽으로 조금만 (20%) 밀어서 보이는 곳을 더 덮음. 많이 밀면 고개를 돌릴 때마다 범위 경계가 지형을 쓸고 지나가 그림자가 깜빡임
      const c = camera.position.clone().addScaledVector(_f, half*.2); c.y = ground;
      // 그림자 맵 한 칸 단위로 끊어서 옮김 (움직일 때 그림자 가장자리가 지글거리지 않게)
      _d.copy(dir).normalize(); _r.set(0, 1, 0).cross(_d).normalize(); if (_r.lengthSq() < 1e-6) _r.set(1, 0, 0); _u.copy(_d).cross(_r).normalize();
      const texel = half*2/size, a = Math.round(c.dot(_r)/texel)*texel, b = Math.round(c.dot(_u)/texel)*texel, d0 = c.dot(_d);
      c.copy(_r).multiplyScalar(a).addScaledVector(_u, b).addScaledVector(_d, d0);
      const far = Math.max(6000, half*4);
      sun.target.position.copy(c); sun.position.copy(c).addScaledVector(_d, far*.5);
      sh.normalBias = texel*2.5; // 면을 따라 그림자 한 칸만큼 띄워 자기 그림자 점무늬(acne) 방지
      const cam = sh.camera; cam.left = -half; cam.right = half; cam.top = half; cam.bottom = -half; cam.near = 1; cam.far = far;
      cam.updateProjectionMatrix(); sun.target.updateMatrixWorld(); sun.updateMatrixWorld();
      renderer.shadowMap.needsUpdate = true;
      // 새로 생긴 함선 · 미사일 · 항공기도 그림자를 드리우게 (가끔 한 번 장면 전체 확인)
      if ((frame++ % 45) === 0) mark(scene);
      cullVegetation(camera);
    },
  };
  return api;
}
/* 공통 색 처리 (모든 맵 · 모든 물체): 빛 계산은 선형 색 공간에서 하고, 화면으로 낼 때 ACES 톤매핑 + sRGB.
   → 석양처럼 강한 빛을 받아도 하이라이트가 하얗게 날아가지 않고, 그늘은 너무 검지 않게 (맵마다 조명값을 따로 손보지 않음).
   직접 짠 셰이더(하늘 · 바다 · 불꽃 · 연기)는 지금처럼 화면 색으로 바로 그리고, 내장 재질은 색 · 텍스처를 선형으로 바꿔 씀 */
const color = { linear: false, exposure: 1.2 };
function colorPipeline(THREE, renderer, seaMat){
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = color.exposure;
  color.linear = true; color.THREE = THREE;
  if (seaMat && seaMat.uniforms.uFogLinear) seaMat.uniforms.uFogLinear.value = 1;
}
const BUILTIN = m => m && (m.isMeshStandardMaterial || m.isMeshPhongMaterial || m.isMeshLambertMaterial || m.isMeshBasicMaterial || m.isLineBasicMaterial || m.isLineDashedMaterial || m.isPointsMaterial || m.isSpriteMaterial || m.isMeshToonMaterial);
// 재질마다 한 번: 색(hex로 정한 화면 색) → 선형, 색 텍스처 → sRGB로 읽기, 너무 매끈한 금속 · 도장은 거칠기를 조금 (해 반사가 하얗게 번쩍이지 않게)
function fixColors(scene){
  if (!color.linear) return;
  const THREE = color.THREE;
  const work_light = root.MapAtmosphere ? root.MapAtmosphere.STRUCT_WIN.value : 0;
  scene.traverse(o => {
    if (o.isPointLight && o.userData.workLight) o.intensity = o.userData.workLight*work_light;
    const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of ms) {
      if (m && m.userData.workLamp) m.emissiveIntensity = 2*work_light;
      // 지형 · 함재기 · 함선은 같은 하늘광 세기를 사용. 맵 변경과 늦게 로드된 재질에도 적용.
      if (m && m.isMeshStandardMaterial && !m.envMap) m.envMapIntensity = env.intensity;
      if (!BUILTIN(m) || m.userData.noColorFix) continue;
      // 발광맵 등이 재질보다 늦게 로드되어도 색 텍스처 인코딩을 맞춤.
      for (const k of ['map', 'emissiveMap']) { const t = m[k]; if (t && !t.isDataTexture && t.encoding === THREE.LinearEncoding) { t.encoding = THREE.sRGBEncoding; t.needsUpdate = true; m.needsUpdate = true; } }
      if (m.userData._lin) continue;
      m.userData._lin = true;
      if (m.color) m.color.convertSRGBToLinear();
      if (m.emissive) m.emissive.convertSRGBToLinear();
      // 표시선 · 이름표 · 불빛(밝기 그대로 보여야 하는 것)은 톤매핑하지 않음
      if (m.isMeshBasicMaterial || m.isLineBasicMaterial || m.isLineDashedMaterial || m.isPointsMaterial || m.isSpriteMaterial) m.toneMapped = false;
      if (m.isMeshStandardMaterial && m.roughness < .45 && !m.roughnessMap) m.roughness = .45;
      m.needsUpdate = true;
    }
  });
}
/* 하늘 → 환경광 (IBL): 화면에 보이는 하늘 셰이더(노을 · 구름 · 해 쪽 광륜)를 그대로 큐브맵으로 구워 scene.environment에 넣음.
   → 항공기 · 함선 · 지형의 간접광과 반사가 보이는 하늘과 같은 시간대 색이 됨 (예전: 반구광 두 색만 → 하늘은 노을인데 물체는 다른 빛).
   반구광(hemi)은 땅에서 튀는 빛만 약하게 남김. 맵을 바꿀 때마다(atmosphere.js apply 뒤) 다시 구움 */
const env = { on: false, intensity: 0 };
function skyEnvironment(THREE, renderer, scene, skyMat, hemi){
  if (!color.linear || !THREE.PMREMGenerator) return null;
  const atmosphere = root.MapAtmosphere;
  if (atmosphere && atmosphere.patchSky) atmosphere.patchSky(THREE, skyMat);
  /* 맵 하늘 텍스처와 방향 · 색 보정을 그대로 공유. 텍스처가 없을 때만 같은 색의 단순한 하늘로 대체.
     아래 반구는 어두운 바다빛으로 채워 물체 밑면이 하늘처럼 밝아지지 않게 함. */
  const u = skyMat.uniforms;
  const envMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { zenith: u.zenith, hor: u.hor, sunDir: u.sunDir, sunCol: u.sunCol, glow: u.glow || { value: 1 }, cover: u.cover || { value: 0 }, overcast: u.overcast || { value: 0 },
      cloudLit: u.cloudLit || { value: new THREE.Color(1, 1, 1) }, cloudDark: u.cloudDark || { value: new THREE.Color(.6, .65, .7) },
      skyTex: u.skyTex, skyOn: u.skyOn, skyRot: u.skyRot, skyTint: u.skyTint, skyGain: u.skyGain },
    vertexShader: 'varying vec3 vp; void main(){ vp = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position, 1.); }',
    fragmentShader: (atmosphere ? atmosphere.SKY_GLSL : '') + `
      uniform vec3 zenith; uniform vec3 hor; uniform vec3 sunDir; uniform vec3 sunCol; uniform float glow; uniform float cover; uniform float overcast;
      uniform vec3 cloudLit; uniform vec3 cloudDark; varying vec3 vp;
      void main(){
        vec3 d = normalize(vp); float up = d.y, sd = max(dot(d, normalize(sunDir)), 0.);
        vec3 c = mix(hor, zenith, pow(clamp(up, 0., 1.), .5));
        float cl = clamp(.35*max(cover, 0.) + .9*overcast, 0., .85)*smoothstep(0., .15, up);
        c = mix(c, mix(cloudLit, cloudDark, .45 + .3*overcast), cl);
        c += sunCol*(pow(sd, 6.)*.45*glow + pow(sd, 48.)*1.5)*(1. - .6*overcast);
        if (skyOn > .5 && up >= 0.) c = mix(skyTexColor(d)*skyGain, mix(hor, zenith, pow(clamp(up, 0., 1.), .45)), skyTint);
        c = up < 0. ? mix(hor, hor*.28, smoothstep(0., .3, -up)) : c;
        gl_FragColor = vec4(pow(clamp(c, 0., 6.), vec3(2.2)), 1.);
        // PMREM 굽기 대상은 RGBE로 저장됨: 내장 재질처럼 출력 인코딩을 거쳐야 함 (안 거치면 값이 2^127배로 읽혀 환경광이 깨짐)
        #include <encodings_fragment>
      }`,
  });
  const pmrem = new THREE.PMREMGenerator(renderer), cap = new THREE.Scene();
  cap.add(new THREE.Mesh(new THREE.SphereGeometry(500, 48, 24), envMat));
  let rt = null;
  const api = {
    hemiScale: .7,
    update(){
      const r = pmrem.fromScene(cap, 0, 1, 2000);
      if (rt) rt.dispose(); rt = r;
      scene.environment = rt.texture; env.on = true;
      if (hemi) { if (hemi.userData.baseI == null) hemi.userData.baseI = hemi.intensity; hemi.intensity = hemi.userData.baseI*api.hemiScale; }
    },
  };
  env.update = api.update; env.hemi = hemi; env.api = api; env.scene = scene;
  return api;
}
// atmosphere.js apply()가 맵 조명을 정한 뒤 부름: 반구광 기본 세기를 기억하고 하늘 환경광을 다시 구움
// p = 맵 설정. 지형에 맞춘 하늘 확산광 비율을 모든 물체에 공유.
function afterAtmosphere(p){
  env.overcast = p ? Math.max(p.overcast || 0, (p.cover || 0) > .2 ? .4 : 0) : 0;
  env.intensity = .35 + .5*env.overcast; // 맑은 맵 · 역광에서도 하늘 반사를 끄지 않음.
  if (env.hemi) env.hemi.userData.baseI = env.hemi.intensity;
  if (env.update) env.update();
  if (env.scene) fixColors(env.scene);
}
// 화면 색(hex) → 렌더러가 쓰는 색 (선형이면 바꿈). 조명 · 안개 색에 씀 (atmosphere.js)
function lightColor(c){ if (color.linear && c && c.convertSRGBToLinear) c.convertSRGBToLinear(); return c; }
// 빛을 받는 불투명 메시만 (하늘 · 바다 · 효과 · 반투명 · 발광은 뺌). userData.noShadow로 뺄 수 있음
function mark(scene){
  scene.traverse(o => {
    if (!o.isMesh || o.userData.noShadow || o.userData._shMarked) return;
    const ms = Array.isArray(o.material) ? o.material : [o.material];
    const lit = ms.every(m => m && (m.isMeshStandardMaterial || m.isMeshPhongMaterial || m.isMeshLambertMaterial) && !m.transparent && m.opacity >= 1);
    o.userData._shMarked = true;
    if (!lit) return;
    o.castShadow = true; o.receiveShadow = true;
  });
}

/* ───── 나무 · 바위 ───── */
function rng(seed){ let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0)/4294967296; }; }
function hashStr(s){ let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; }
// 여러 지오메트리를 한 덩어리로 (위치 · 법선 · 색). 법선은 각자 정한 값 그대로
function merge(THREE, parts){
  let n = 0; for (const p of parts) n += p.g.attributes.position.count;
  const pos = new Float32Array(n*3), nor = new Float32Array(n*3), col = new Float32Array(n*3); let o = 0;
  for (const p of parts) {
    const g = p.g.index ? p.g.toNonIndexed() : p.g, P = g.attributes.position, N = g.attributes.normal;
    for (let i = 0; i < P.count; i++) {
      pos[o*3] = P.getX(i); pos[o*3 + 1] = P.getY(i); pos[o*3 + 2] = P.getZ(i);
      nor[o*3] = N.getX(i); nor[o*3 + 1] = N.getY(i); nor[o*3 + 2] = N.getZ(i);
      let c = p.color(P.getX(i), P.getY(i), P.getZ(i), N.getY(i)); if (color.linear) c = c.map(v => Math.pow(v, 2.2));
      col[o*3] = c[0]; col[o*3 + 1] = c[1]; col[o*3 + 2] = c[2]; o++;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeBoundingSphere(); return g;
}
// 둥근 덩어리 (정이십면체, 법선 = 중심에서 바깥 → 매끈한 그늘), 위치 · 크기 · 납작함
function blob(THREE, x, y, z, r, sy, rnd){
  const g = new THREE.IcosahedronGeometry(1, 0), p = g.attributes.position, nrm = new Float32Array(p.count*3);
  for (let i = 0; i < p.count; i++) {
    // 꼭짓점마다 크게 들쭉날쭉 (같은 위치는 같은 값이라 면이 벌어지지 않음) → 공 모양이 아닌 불규칙한 잎 덩어리
    const vx = p.getX(i), vy = p.getY(i), vz = p.getZ(i), k = .72 + .56*(.5 + .5*Math.sin(vx*7.3 + vz*5.1 + vy*3.3 + rnd*9.7))*(.6 + .4*Math.sin(vy*6.1 - vx*4.7 + rnd*3.1));
    nrm[i*3] = vx*.7; nrm[i*3 + 1] = vy*.7 + .3; nrm[i*3 + 2] = vz*.7;
    p.setXYZ(i, x + vx*r*k, y + vy*r*sy*k, z + vz*r*k);
  }
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3)); return g;
}
/* 나무 무리 (지름 · 높이 1 안팎): 크기가 다른 나무 다섯 그루. 꼭짓점 색은 명암만 (위 밝게 · 아래 어둡게),
   색조는 무리마다 그 자리 지형 색으로 (InstancedMesh 색) → 주변 풀 · 숲 색과 어울림. kind 0 = 활엽수, 1 = 침엽수 */
function grove(THREE, kind){
  const R = rng(kind*977 + 13), parts = [];
  const shade = (x, y, z, ny) => { const k = .5 + .5*Math.max(0, ny); return [k, k, k]; };
  for (let i = 0; i < 5; i++) {
    const a = R()*6.2832, d = i ? .22 + R()*.24 : 0, x = Math.cos(a)*d, z = Math.sin(a)*d, h = i ? .55 + R()*.35 : 1;
    const trunk = new THREE.CylinderGeometry(.012, .02, .3*h, 5); trunk.translate(x, .15*h, z);
    parts.push({ g: trunk, color: () => [.3, .25, .2] });
    if (kind === 0) {
      // 잎 덩어리 여러 개를 엇갈려 쌓음 (크기 · 위치 제각각)
      for (let b = 0; b < 4; b++) {
        const r = (.09 + R()*.09)*h, a2 = R()*6.2832, d2 = R()*.1*h;
        parts.push({ g: blob(THREE, x + Math.cos(a2)*d2, (.45 + R()*.35)*h, z + Math.sin(a2)*d2, r, .7 + R()*.25, i*7 + b), color: shade });
      }
    } else {
      const c1 = new THREE.ConeGeometry(.13*h, .45*h, 7); c1.translate(x, .4*h, z);
      const c2 = new THREE.ConeGeometry(.09*h, .4*h, 7); c2.translate(x, .68*h, z);
      parts.push({ g: c1, color: shade }, { g: c2, color: shade });
    }
  }
  return merge(THREE, parts);
}
/* 바위 (지름 1): 울퉁불퉁한 정이십면체, 면 단위 음영 */
function boulder(THREE){
  const g = new THREE.IcosahedronGeometry(.5, 1), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = 1 + .22*Math.sin(x*9.1 + y*4.7) + .16*Math.sin(z*7.3 - y*6.1) + .1*Math.sin(x*13.7 + z*11.3);
    p.setXYZ(i, x*k, y*k*.72, z*k);
  }
  const ng = g.toNonIndexed(); ng.computeVertexNormals();
  return merge(THREE, [{ g: ng, color: (x, y, z, ny) => { const k = .7 + .3*Math.max(0, ny); return [k, k, k]; } }]);
}

/* 맵마다 숲 양 (1 = 기본). 얼음 맵(TerrainField.ICE_MAPS)은 없음. 이 지형 · 이 지형처럼 풀밭 위주인 곳은 드문드문 */
const TREE_AMOUNT = { 'moss-archipelago': .12, 'snow-cliffs': .2, 'slate-bay': .3, 'basalt-rigs': .35, 'frost-fjord': 0, 'ice-shelf': 0, 'red-canyon': .25, 'rust-harbor': .5 };
const TILE = 1500, VIEW = 9000; // 타일 크기 · 이 거리 밖 타일은 그리지 않음 (m, 화면 좌표)
let activeVegetation = null;

/* 지형에 뿌리기. terrain = TerrainField (배율 적용 상태), image = 구운 지형 색 (Image · Canvas)
   반환: THREE.Group (타일마다 나무 무리 · 바위 InstancedMesh). 지형을 다시 만들 때 dispose(group) */
function vegetation(THREE, terrain, image, o = {}){
  const group = new THREE.Group(); group.name = 'vegetation'; group.userData.counts = { trees: 0, rocks: 0 };
  const slug = terrain.meta.slug || '', TF = root.TerrainField;
  if (TF && TF.ICE_MAPS.includes(slug)) return group;
  const amount = TREE_AMOUNT[slug] ?? 1;
  const S = terrain.scene, s = terrain.scale, W = terrain.meta.worldSize, rand = rng(hashStr(slug || 'map'));
  // 지형 색 픽셀 (uv = 지형 전체 0 ~ 1, terrain.sceneGeometry와 같은 방향)
  let px = null; const PW = 512;
  if (image) try { const c = document.createElement('canvas'); c.width = c.height = PW; const g = c.getContext('2d'); g.drawImage(image, 0, 0, PW, PW); px = g.getImageData(0, 0, PW, PW).data; } catch { px = null; }
  const colorAt = (x, z) => {
    if (!px) return [80, 100, 50];
    const u = Math.min(PW - 1, Math.max(0, Math.floor((x + W/2)/W*PW))), r = Math.min(PW - 1, Math.max(0, Math.floor((z + W/2)/W*PW))), i = (r*PW + u)*4;
    return [px[i], px[i + 1], px[i + 2]];
  };
  // 초록(식생) 정도 0 ~ 1: 초록이 가장 세고 채도가 있으며 너무 밝지 않음 (눈 · 얼음 · 모래 · 바위는 0)
  const greenOf = ([r, g, b]) => {
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), sat = mx ? (mx - mn)/mx : 0;
    if (g < mx || mx > 215) return 0;
    return Math.max(0, Math.min(1, (sat - .16)/.18))*Math.max(0, Math.min(1, (g - Math.max(r, b))/14));
  };
  const area2 = s*s, treeK = amount/(42*42), rockK = 1/(110*110); // 무리 · 바위 개수 / 화면 m²
  const tiles = new Map(), put = (kind, p, extra) => {
    const key = Math.floor(p[0]*s/TILE) + ',' + Math.floor(p[2]*s/TILE);
    let t = tiles.get(key); if (!t) tiles.set(key, t = { lists: [[], [], []], x: (Math.floor(p[0]*s/TILE) + .5)*TILE, z: (Math.floor(p[2]*s/TILE) + .5)*TILE, top: 0 });
    t.lists[kind].push([p, extra]); t.top = Math.max(t.top, p[1]*s);
  };
  const tri = (ax, ay, az, bx, by, bz, cx, cy, cz) => {
    const ex = bx - ax, ey = by - ay, ez = bz - az, fx = cx - ax, fy = cy - ay, fz = cz - az;
    const nx = ey*fz - ez*fy, ny = ez*fx - ex*fz, nz = ex*fy - ey*fx, len = Math.hypot(nx, ny, nz); if (!len) return;
    const up = Math.abs(ny)/len, area = len/2*area2, y = (ay + by + cy)/3;
    if (y < .4) return;
    const pick = () => { let a = rand(), b = rand(); if (a + b > 1) { a = 1 - a; b = 1 - b; } return [ax + ex*a + fx*b, ay + ey*a + fy*b, az + ez*a + fz*b]; };
    const col = colorAt((ax + bx + cx)/3, (az + bz + cz)/3), g = greenOf(col);
    const tk = area*treeK*g*Math.max(0, Math.min(1, (up - .72)/.14))*Math.min(1, (y - .4)/2);
    for (let n = Math.floor(tk) + (rand() < tk % 1 ? 1 : 0); n > 0; n--) put(rand() < .3 ? 1 : 0, pick(), col);
    const rk = area*rockK*((y < 3 ? 2 : 0) + (up > .35 && up < .8 ? 1 : 0))*(1 - .8*g);
    for (let n = Math.floor(rk) + (rand() < rk % 1 ? 1 : 0); n > 0; n--) put(2, pick(), col);
  };
  if (S) {
    const P = S.pos, I = S.index, B = S.bld;
    for (let t = 0; t < I.length; t += 3) {
      if (B && (B[I[t]] || B[I[t + 1]] || B[I[t + 2]])) continue; // 건물 · 시설
      const a = I[t]*3, b = I[t + 1]*3, c = I[t + 2]*3;
      tri(P[a], P[a + 1], P[a + 2], P[b], P[b + 1], P[b + 2], P[c], P[c + 1], P[c + 2]);
    }
  } else {
    const n = terrain.n, H = terrain.heights, cu = W/(n - 1), step = Math.max(1, terrain.meshStep || 1), X = c => -W/2 + c*cu, h = (r, c) => H[r*n + c];
    for (let r = 0; r + step < n; r += step) for (let c = 0; c + step < n; c += step) {
      if (Math.max(h(r, c), h(r, c + step), h(r + step, c), h(r + step, c + step)) < .4) continue;
      tri(X(c), h(r, c), X(r), X(c + step), h(r, c + step), X(r), X(c), h(r + step, c), X(r + step));
      tri(X(c + step), h(r, c + step), X(r), X(c + step), h(r + step, c + step), X(r + step), X(c), h(r + step, c), X(r + step));
    }
  }
  // 너무 많으면 고르게 솎음 (성능)
  let nT = 0, nR = 0; for (const t of tiles.values()) { nT += t.lists[0].length + t.lists[1].length; nR += t.lists[2].length; }
  const keepT = Math.min(1, (o.maxGroves || 14000)/Math.max(1, nT)), keepR = Math.min(1, (o.maxRocks || 6000)/Math.max(1, nR));
  const geos = [grove(THREE, 0), grove(THREE, 1), boulder(THREE)];
  const mats = [new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .95, metalness: 0 }), null, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .95, metalness: 0, flatShading: true })];
  mats[1] = mats[0]; mats[0].userData.noColorFix = mats[2].userData.noColorFix = true; // 색은 아래에서 직접 선형으로
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3(), col = new THREE.Color();
  const big = Math.min(s, 1.6); // 지형 배율을 따르되 실제 나무 크기에서 너무 벗어나지 않게
  const meshes = [];
  for (const t of tiles.values()) for (let kind = 0; kind < 3; kind++) {
    const list = t.lists[kind].filter(() => rand() < (kind < 2 ? keepT : keepR)); if (!list.length) continue;
    // 지오메트리는 공유하되 타일마다 경계 구를 따로 → 화면 밖 타일은 그리지 않음 (그림자 그릴 때도)
    const g = new THREE.BufferGeometry(); for (const k of ['position', 'normal', 'color']) g.setAttribute(k, geos[kind].attributes[k]);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(t.x, t.top/2, t.z), TILE*.75 + t.top);
    const im = new THREE.InstancedMesh(g, mats[kind], list.length);
    list.forEach(([p, c], i) => {
      if (kind < 2) {
        const hgt = (5 + rand()*6)*big, w = hgt*(1.2 + rand()*.6);
        e.set(0, rand()*6.2832, 0); q.setFromEuler(e); v.set(p[0]*s, p[1]*s - hgt*.03, p[2]*s); sc.set(w, hgt, w);
        // 색 = 그 자리 지형 색을 조금 어둡고 진하게 (숲 그늘) + 무리마다 조금씩 다르게
        const l = .62 + rand()*.25; col.setRGB(c[0]/255*l*(.9 + rand()*.2), c[1]/255*l*1.05, c[2]/255*l*(.85 + rand()*.2));
      } else {
        const d = (1.6 + Math.pow(rand(), 2)*4.5)*big;
        e.set(rand()*.6, rand()*6.2832, rand()*.6); q.setFromEuler(e); v.set(p[0]*s, p[1]*s - d*.2, p[2]*s); sc.set(d*(.8 + rand()*.5), d*(.6 + rand()*.5), d*(.8 + rand()*.5));
        // 바위: 회색에 지형 색을 살짝 (주변 바위 · 흙과 같은 기운)
        const l = .42 + rand()*.18; col.setRGB(l*(.75 + .25*c[0]/180), l*(.75 + .25*c[1]/180), l*(.75 + .25*c[2]/180));
      }
      if (color.linear) col.convertSRGBToLinear();
      im.setMatrixAt(i, m4.compose(v, q, sc)); im.setColorAt(i, col);
    });
    im.castShadow = im.receiveShadow = true; im.userData.tile = t; im.userData.noShadowMark = true;
    group.add(im); meshes.push(im);
    group.userData.counts[kind < 2 ? 'trees' : 'rocks'] += list.length;
  }
  group.userData.meshes = meshes;
  activeVegetation = group;
  return group;
}
// 먼 타일은 그리지 않음 (안개 너머 · 성능). 그림자 update에서 매 프레임
function cullVegetation(camera){
  const g = activeVegetation; if (!g || !g.parent) return;
  for (const m of g.userData.meshes) { const t = m.userData.tile; m.visible = Math.hypot(t.x - camera.position.x, t.z - camera.position.z) < VIEW + TILE; }
}
function dispose(group){ if (!group) return; group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); if (group.parent) group.parent.remove(group); }

/* 설정 화면 연결 (있는 요소만): onChange(key) */
function bindUI(onChange){
  const $ = id => document.getElementById(id);
  for (const [id, key] of [['sceneryShadows', 'shadows'], ['scenerySea', 'sea'], ['sceneryTrees', 'trees']]) {
    const el = $(id); if (!el) continue;
    el.checked = opts[key];
    el.addEventListener('change', () => { opts[key] = el.checked; saveOpts(); onChange && onChange(key); });
  }
}
root.MapScenery = { opts, saveOpts, shadows, mark, vegetation, dispose, bindUI, color, colorPipeline, fixColors, lightColor, skyEnvironment, afterAtmosphere, env };
})(typeof window !== 'undefined' ? window : globalThis);
