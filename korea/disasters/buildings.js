/* 재난이 3D 건물에 주는 영향 (브이월드 건물 타일셋에 Cesium customShader 하나로)
   건물 구분: b3dm 배치 ID(featureId_0) + 타일 위치로 건물마다 난수.
   지면: 발생 지점 둘레를 64×64 칸으로 지도 지형 높이를 재서 텍스처로 → 꼭짓점의 "지면 위 높이"(실제 m)

   - 지진: 건물 높이 h의 고유주기 T ≈ h/30 s 응답 변위 Sd = Sa·(T/2π)², Sa = 2.5·PGA·g·min(1, 0.5/T) (실제 m) × 보기용 과장으로 흔들림.
           완전 파괴 취약도 P = Φ(ln(PGA/0.55 g)/0.64)로 건물마다 판정, 흔들리는 동안 주저앉고 기울며 먼지색
   - 물(해일 · 해수면 · 침수): 지금까지 가장 높았던 수위 아래는 젖은 흙탕 자국. 해일은 침수 깊이로 손상 취약도
           (Suppasri 등 2013 중앙값 약 2 m · β 0.6, 저층부)를 판정해 잠긴 층을 부서진 색으로
   - 산불: 불 번짐 지도(발화점에서의 상대 거리)를 텍스처로 받아 화선이 지나는 건물은 몇몇 층이 불타고(빛), 지나간 뒤엔 그을림 */
const VS = `
  float bh(float n){ return fract(sin(n*12.9898)*43758.5453); }
  void vertexMain(VertexInput vsInput, inout czm_modelVertexOutput vsOutput){
    // 브이월드 타일은 실제 위치가 czm_model이 아니라 모델뷰 행렬에 들어 있어 눈 좌표를 거쳐 지구 좌표로
    vec3 w = (czm_inverseView*(czm_modelView*vec4(vsOutput.positionMC, 1.))).xyz;
    vec3 L = (u_enuInv*vec4(w, 1.)).xyz;                              // 발생 지점 기준 동 · 북 · 위 (m)
    vec2 guv = L.xy/(2.*u_half) + .5;
    float inside = step(0., guv.x)*step(guv.x, 1.)*step(0., guv.y)*step(guv.y, 1.);
    float ground = u_gMin + texture2D(u_ground, clamp(guv, 0., 1.)).r*u_gScale;
    float h = max(L.z - ground, 0.);                                   // 지면 위 높이
    vec3 up = normalize(w), east = normalize(cross(vec3(0., 0., 1.), up)), north = cross(up, east);
    float fid = float(vsInput.featureIds.featureId_0);
    // 건물마다 난수: 타일 안 배치 ID + 300 m 칸 (브이월드 타일은 모델 행렬 이동이 0이라 타일 구분에 못 씀)
    float r1 = bh(fid*1.37 + dot(floor(L.xy/300.), vec2(.137, .711)) + 7.3), r2 = bh(r1*91.7 + 3.1);
    vec3 off = vec3(0.);
    float dmg = 0.;
    if (u_qOn > .5) {
      float d = length(L.xy)/1000., R = sqrt(d*d + u_depth*u_depth);
      float pga = .0159*exp(.868*u_M)*pow(R + .0606*exp(.7*u_M), -1.09);
      float P = 1./(1. + exp(-1.702*log(max(pga, 1e-4)/.55)/.64));
      float c = r1 < P ? smoothstep(r2*u_dur*.6, r2*u_dur*.6 + 4., u_t) : 0.;
      float T = max(.1, h/30.), Sd = 2.5*pga*9.81*min(1., .5/T)*pow(T/6.2832, 2.), wv = 6.2832/T*u_t, ph = r1*6.2832;
      off += (east*sin(wv + ph) + north*.6*sin(wv*1.13 + ph*2.))*Sd*u_env*u_exag*(1. - c);
      off += (-up*h*.82 + (east*(r2 - .5) + north*(r1 - .5))*h*.25)*c;
      dmg = c;
    }
    v_wet = 0.; v_burn = 0.; v_fire = 0.;
    if (u_wOn > .5) {
      float lvl = u_wMax - ground;                                     // 그 자리 최대 침수 깊이 (m)
      v_wet = inside*step(.05, lvl)*(1. - smoothstep(lvl - .3, lvl + .1, h));
      if (u_wTsu > .5 && lvl > .3) { float P = 1./(1. + exp(-1.702*log(lvl/2.)/.6)); dmg = max(dmg, inside*step(r1, P)*(1. - smoothstep(lvl - .5, lvl + .5, h))*.8); }
    }
    if (u_fOn > .5) {
      vec2 fuv = (L.xy - u_fBox.xy)/u_fBox.zw;
      float rel = texture2D(u_fRel, clamp(fuv, 0., 1.)).r*1.5;           // 1.5 = 영역 밖
      float inF = step(0., fuv.x)*step(fuv.x, 1.)*step(0., fuv.y)*step(fuv.y, 1.)*step(rel, 1.01);
      float dd = u_fG - rel;
      v_fire = inF*step(0., dd)*(1. - smoothstep(.12, .2, dd))*step(.35, r1);   // 화선이 지나는 동안 (건물 65%)
      v_burn = inF*smoothstep(.0, .25, dd)*mix(.55, 1., r2);
    }
    v_dmg = dmg; v_h = h; v_r = r1;
    v_upEC = (czm_view*vec4(up, 0.)).xyz;                                // 지붕 눈: 위 방향 (눈 좌표)
    vsOutput.positionMC += (czm_inverseModelView*vec4((czm_view*vec4(off, 0.)).xyz, 0.)).xyz;
  }`;
const FS = `
  void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material){
    vec3 c = material.diffuse;
    c = mix(c, c*vec3(.55, .5, .42) + vec3(.06, .05, .03), v_wet*.75);      // 젖은 흙탕 자국
    c = mix(c, vec3(.45, .42, .38), v_dmg*.7);                            // 부서짐 · 먼지
    c = mix(c, vec3(.07, .06, .055), v_burn*.85);                         // 그을림
    if (u_snow > 0.) {                                                    // 쌓인 눈: 위를 보는 면(지붕 · 옥상)만, 벽은 그대로
      float roof = smoothstep(.55, .85, dot(normalize(fsInput.attributes.normalEC), normalize(v_upEC)));
      float lum = dot(c, vec3(.299, .587, .114));                        // 원래 지붕 무늬(실외기 · 난간 그림자)를 조금 남김
      c = mix(c, vec3(.86, .88, .93)*mix(.82, 1.04, lum), roof*clamp(u_snow*1.2, 0., 1.)*mix(.72, .9, v_r));
    }
    material.diffuse = c;
    if (v_fire > 0.) {
      // 몇몇 층(3.5 m 간격)에서 불길: 층 · 건물마다 다르게 깜빡임
      float fl = floor(v_h/3.5), on = step(.45, fract(sin(fl*7.1 + v_r*53.)*437.));
      float flick = .6 + .4*sin(u_time*9. + fl*3. + v_r*20.)*sin(u_time*5.3 + v_r*7.);
      material.emissive += vec3(1., .42, .1)*v_fire*on*flick*1.6;
      material.diffuse = mix(material.diffuse, vec3(.2, .08, .03), v_fire*on*.5);
    }
  }`;

export function createBuildingFX(viewer, Cesium) {
  const scene = viewer.scene, U = Cesium.UniformType, N = 64;
  const blank = new Cesium.TextureUniform({ typedArray: new Uint8Array([0, 0, 0, 255]), width: 1, height: 1 });
  const shader = new Cesium.CustomShader({
    uniforms: {
      u_enuInv: { type: U.MAT4, value: Cesium.Matrix4.IDENTITY.clone() }, u_half: { type: U.FLOAT, value: 5000 },
      u_ground: { type: U.SAMPLER_2D, value: blank }, u_gMin: { type: U.FLOAT, value: 0 }, u_gScale: { type: U.FLOAT, value: 0 },
      u_time: { type: U.FLOAT, value: 0 },
      u_qOn: { type: U.FLOAT, value: 0 }, u_t: { type: U.FLOAT, value: 0 }, u_env: { type: U.FLOAT, value: 0 }, u_M: { type: U.FLOAT, value: 6 },
      u_depth: { type: U.FLOAT, value: 10 }, u_dur: { type: U.FLOAT, value: 10 }, u_exag: { type: U.FLOAT, value: 10 },
      u_wOn: { type: U.FLOAT, value: 0 }, u_wMax: { type: U.FLOAT, value: -1e4 }, u_wTsu: { type: U.FLOAT, value: 0 },
      u_fOn: { type: U.FLOAT, value: 0 }, u_fRel: { type: U.SAMPLER_2D, value: blank }, u_fBox: { type: U.VEC4, value: new Cesium.Cartesian4(0, 0, 1, 1) }, u_fG: { type: U.FLOAT, value: 0 }, u_snow: { type: U.FLOAT, value: 0 },
    },
    varyings: { v_dmg: Cesium.VaryingType.FLOAT, v_wet: Cesium.VaryingType.FLOAT, v_burn: Cesium.VaryingType.FLOAT, v_fire: Cesium.VaryingType.FLOAT, v_h: Cesium.VaryingType.FLOAT, v_r: Cesium.VaryingType.FLOAT, v_upEC: Cesium.VaryingType.VEC3 },
    vertexShaderText: VS, fragmentShaderText: FS,
  });
  let sets = [], users = 0, enu = null, originH = 0;
  const set = (k, v) => shader.setUniform(k, v);
  const tilesets = () => { const out = [], P = scene.primitives; for (let i = 0; i < P.length; i++) { const t = P.get(i); if (t instanceof Cesium.Cesium3DTileset && !/poi/i.test(String(t.resource && t.resource.url || ''))) out.push(t); } return out; };
  function attach() { sets = tilesets(); for (const t of sets) t.customShader = shader; }
  function detach() { for (const t of sets) if (t.customShader === shader) t.customShader = undefined; sets = []; }
  const t0 = performance.now();
  scene.preRender.addEventListener(() => { if (users) set('u_time', (performance.now() - t0) / 1000); });

  /* 발생 지점 기준 좌표계 + 지면 높이 텍스처 (반경 half m) */
  async function setArea(longitude, latitude, half) {
    enu = Cesium.Transforms.eastNorthUpToFixedFrame(Cesium.Cartesian3.fromDegrees(longitude, latitude));
    const inv = Cesium.Matrix4.inverse(enu, new Cesium.Matrix4());
    set('u_enuInv', inv); set('u_half', half);
    const cartos = [];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = ((i + .5) / N - .5) * 2 * half, y = ((j + .5) / N - .5) * 2 * half;
      cartos.push(Cesium.Cartographic.fromCartesian(Cesium.Matrix4.multiplyByPoint(enu, new Cesium.Cartesian3(x, y, 0), new Cesium.Cartesian3())));
    }
    const tp = viewer.terrainProvider;
    let res = cartos;
    try { res = await (tp.availability ? Cesium.sampleTerrainMostDetailed(tp, cartos) : Cesium.sampleTerrain(tp, 14, cartos)); }
    catch { for (const c of cartos) c.height = scene.globe.getHeight(c) ?? 0; }
    // 지면 높이를 같은 동 · 북 · 위 좌표의 z로 (지구 곡률 포함)
    const z = res.map(c => Cesium.Matrix4.multiplyByPoint(inv, Cesium.Cartesian3.fromRadians(c.longitude, c.latitude, Number.isFinite(c.height) ? c.height : 0), new Cesium.Cartesian3()).z);
    let lo = Infinity, hi = -Infinity; for (const v of z) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    const span = Math.max(1, hi - lo), px = new Uint8Array(N * N * 4);
    z.forEach((v, k) => { const q = Math.round((v - lo) / span * 255); px[k * 4] = px[k * 4 + 1] = px[k * 4 + 2] = q; px[k * 4 + 3] = 255; });
    set('u_ground', new Cesium.TextureUniform({ typedArray: px, width: N, height: N, minificationFilter: Cesium.TextureMinificationFilter.LINEAR, magnificationFilter: Cesium.TextureMagnificationFilter.LINEAR }));
    set('u_gMin', lo); set('u_gScale', span);
    originH = Cesium.Cartographic.fromCartesian(enu ? Cesium.Matrix4.getTranslation(enu, new Cesium.Cartesian3()) : Cesium.Cartesian3.ZERO).height;
  }
  // 타원체 높이(m) → 지금 좌표계 z (발생 지점 근처)
  const zOf = hEll => hEll - originH;

  return {
    async begin(longitude, latitude, half) { users++; if (users === 1) attach(); else sets = tilesets().map(t => (t.customShader = shader, t)); await setArea(longitude, latitude, half); },
    end() { users = Math.max(0, users - 1); set('u_qOn', 0); set('u_wOn', 0); set('u_fOn', 0); set('u_snow', 0); if (!users) detach(); },
    quake(o) { set('u_qOn', 1); set('u_t', o.t); set('u_env', o.env); set('u_M', o.M); set('u_depth', o.depth); set('u_dur', o.dur); set('u_exag', o.exag); },
    water(maxEllipsoidHeight, tsunami) { set('u_wOn', 1); set('u_wMax', zOf(maxEllipsoidHeight)); set('u_wTsu', tsunami ? 1 : 0); },
    // rel: Float(0~1, 영역 밖 1.5) n×n 격자 (동 · 북 m 범위 box = [minX, minY, sizeX, sizeY]), g: 지금 번진 정도
    fireMap(rel, n, box) {
      const px = new Uint8Array(n * n * 4); rel.forEach((v, k) => { const q = Math.round(Math.min(v, 1.5) / 1.5 * 255); px[k * 4] = px[k * 4 + 1] = px[k * 4 + 2] = q; px[k * 4 + 3] = 255; });
      set('u_fRel', new Cesium.TextureUniform({ typedArray: px, width: n, height: n, minificationFilter: Cesium.TextureMinificationFilter.LINEAR, magnificationFilter: Cesium.TextureMagnificationFilter.LINEAR }));
      set('u_fBox', new Cesium.Cartesian4(...box)); set('u_fOn', 1);
    },
    fire(g) { set('u_fG', g); },
    snow(cover) { set('u_snow', cover); },
  };
}
