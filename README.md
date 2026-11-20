# 지형 템플릿 뷰어

기후·재난 시각화 프로젝트의 3D 기반 화면입니다. 지형·하늘·바다 템플릿을 각각 골라 조합하고, 자유 시점으로 날아다니며 둘러볼 수 있습니다.

## 실행

정적 파일만 있으므로 아무 웹 서버로 열면 됩니다.

```
python -m http.server 8000
# http://localhost:8000
```

`file://`로 직접 열면 브라우저가 데이터 파일을 막아서 동작하지 않습니다.

URL로 조합을 바로 지정할 수 있습니다: `?terrain=red-canyon&sky=golden-dusk&sea=jade-lagoon`

## 조작

| 입력 | 동작 |
| --- | --- |
| W A S D / 방향키 | 이동 |
| E, Space / Q, C | 상승 / 하강 |
| 마우스 드래그 | 시점 회전 |
| 휠 | 이동 속도 조절 |
| Shift | 4배 가속 |
| H | 패널 열기·닫기 |

터치 기기에서는 오른쪽 아래 버튼으로 이동합니다.

## 템플릿

`data/catalog.json`에 목록이 있습니다.

- **지형 15종** (`data/terrain/<id>.r16` 높이장 + `scenes/<id>.json/.geo.bin` 실제 메시 + `color/<id>.jpg` 지형 색). 건물·시추 시설·다리·부두·배 같은 인공 구조물은 빼고 자연 지형(산·바위·섬·빙하)과 그 아래 땅만 남겼습니다.
- **하늘 15종** (`data/sky/<id>.jpg` 하늘 텍스처 + `js/atmosphere.js`의 `PRESETS` 조명·구름·안개)
- **바다 15종** (`js/atmosphere.js`의 `WATER_LOOK` 물 맑기·흰 물마루·해저색 + 바다 색·거칠기)

`catalog.json`의 `pairs`는 지형마다 기본으로 어울리는 하늘·바다입니다. 패널의 "지형에 어울리는 하늘·바다 함께 적용"을 끄면 지형만 바뀝니다.

## 재난 시뮬레이션 (시험판)

패널 위쪽 "재난 시뮬레이션" 탭에서 재난을 고르고 값을 숫자로 입력하거나 슬라이더로 조정합니다. 두 칸은 서로 연동됩니다.

| 재난 | 입력값 | 화면 연출 |
| --- | --- | --- |
| 태풍 | 최대 풍속, 시간당 강수량, 바람 방향 | 비 · 어두운 하늘 · 거친 바다 · 폭풍 해일만큼 수면 상승 |
| 집중호우 · 홍수 | 시간당 강수량, 지속 시간, 배수 능력 | 비 · 배수 초과분만큼 저지대 침수(흙탕물) |
| 지진 | 규모, 진원 깊이, 진앙 거리 | 지반 가속도(PGA)에 맞춘 흔들림, 흔들림 시간만큼 반복 |
| 지진해일 | 파고(수심 10 m 기준), 처오름 배율, 오는 방향, 재생 배속 | 지형을 128×128 칸으로 나눠 수심별 속도 √(g·d)로 도착 시간을 계산(섬을 돌아 들어감), Green 법칙으로 얕을수록 높아짐. 칸마다 물 빠짐(해저 드러남) → 흰 흙탕 물살과 함께 차오름 → 처오름 높이보다 낮은 땅 침수 → 빠짐 → 두 번째 파. "해일 가까이 보기"로 해안에서 볼 수 있음 |
| 산불 | 피해 면적, 풍속, 풍향, 습도 | 발화점에서 화선이 번지고 연기가 바람 따라 흐름, 피해 경계선 |
| 폭염 | 기온, 습도, 지속 일수 | 강한 햇빛 · 누런 연무 |
| 대설 · 한파 | 시간당 적설, 지속 시간, 풍속, 기온 | 눈 · 하얀 시정 |

- **실제 크기 기준**: 월드 1단위 = 0.8 m(지형 배율 ×10 기준). 침수 깊이 · 파고 · 산불 반경 · 불꽃 높이 · 연기 상승 · 빗방울(약 9 m/s) · 눈송이(약 1.2 m/s) 속도, 바람(m/s), 비 · 눈 · 연기로 인한 시정(보이는 거리)이 실제 m 단위로 들어갑니다. 오른쪽 위 HUD의 고도 · 속도 · 화면 가운데까지 거리도 실제 m입니다. 산불이 번지는 과정만 30초 타임랩스로 압축합니다.
- **추정치**: 재난마다 중심기압, 진도, 침수 깊이, 시정 등을 간이 공식으로 계산해 보여줍니다. 시각화용 근사이며 실제 피해 계산이 아닙니다. 공식 출처는 `js/disaster.js` 맨 위 주석에 있습니다 (MetroRisk(MIT) 값 참고).
- **API 연동**: 나중에 뉴스 · API에서 뽑은 수치를 그대로 넣으면 됩니다.
  ```js
  Disaster.set('flood', { rain: 90, hours: 6, drain: 40 }, { /* 맵 · API에서 받은 침수 이력 · 방재 시설 등 */ });
  Disaster.get(); // { type, params, data }
  ```
  URL로도 됩니다: `templates.html?terrain=tropic-isles&disaster=typhoon&wind=55&rain=90`. 패널 아래 "파라미터 JSON"에서 직접 붙여넣어 적용할 수도 있습니다.
  세 번째 인자 `data`는 지금은 보관만 하고 연출에는 쓰지 않습니다 (침수 · 방재 데이터 연동 자리).

## 구조

- `templates.html`: 뷰어 (three.js r128, 자유 비행 카메라, 템플릿 선택 UI)
- `js/terrain.js`: 높이장·메시 로더, 지형 셰이더 (triplanar 바위·풀 질감)
- `js/atmosphere.js`: 하늘·조명·안개 프리셋
- `js/ocean.js`: FFT 바다 시뮬레이션
- `js/scenery.js`: 그림자, 나무·바위 배치, 색 처리
- `js/disaster.js`: 재난 종류 · 입력값 · 간이 공식, 비 · 눈 · 산불 · 해일 · 흔들림 연출, 재난 패널
- `js/tsunami.js`: 지진해일 (수심별 도착 시간 · Green 법칙 · 침수)

## 대한민국 실제 3D 지도

서버 기본 주소에서 대한민국 실제 3D 지도가 바로 열립니다. 지도 패널의 **지형 템플릿 뷰어** 링크로 기존 화면에 이동합니다.
[로컬 지도](http://localhost:8000/)로 접속합니다.
저장소 루트에서 `python -m http.server 8000`으로 실행합니다.
WebGL을 지원하는 브라우저와 지도·DEM·라이브러리 CDN에 대한 인터넷 연결이 필요합니다.
API 키나 빌드 단계는 없습니다.

- **북한산**의 기울어진 3D 시점에서 시작합니다. DEM 기반 음영이 능선과 계곡을 강조합니다. 지역 메뉴에서 대한민국 전체, 광화문, 해운대, 한라산, 독도로 이동할 수 있습니다.
- 마우스로 드래그하면 이동, 휠을 굴리면 확대·축소, 오른쪽 버튼을 누르고 드래그하면 회전·기울이기가 됩니다.
- 기본 화면은 실제 Sentinel-2 영상을 DEM 지형 표면에 입힙니다. **위성 영상** 체크를 해제하면 음영을 적용한 일반 지도가 표시됩니다.
- 지도 클릭 또는 WGS84 십진수 위도·경도 입력으로 DEM 값을 조회합니다. 조회는 화면 확대율과 별도로 z15 DEM 타일의 해당 픽셀을 읽으며, 화면 지형의 과장은 1배입니다.
- OSM 도로와 건물 외곽선을 표시합니다. 줌 15부터 타일의 건물 높이 속성으로 건물을 압출합니다. 타일에 건물 부위가 있으면 각 외곽선과 바닥·상단 높이를 적용합니다. 등록된 건물 색상을 우선 사용하고, 색상 정보가 비어 있으면 높이별 색을 사용합니다. 제공 높이에는 추정값이 포함될 수 있습니다. 지붕 형상과 외벽 텍스처는 현재 타일에서 제공되지 않습니다.
- 광화문에서 건물·도로와 고도 조회를 함께 확인하고, 북한산에서 능선과 계곡을 비교할 수 있습니다.

### 데이터와 기술 선택

| 기술·데이터 | 조건 및 용도 |
| --- | --- |
| [MapLibre GL JS](https://github.com/maplibre/maplibre-gl-js) | BSD-3-Clause. Terrarium 지형, 벡터 타일, 사용자 정의 WebGL 레이어를 한 지도에 표시합니다. |
| [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) | 인증 없이 Mapzen/Tilezen Terrarium 타일을 요청합니다. [원본별 출처·조건](https://github.com/tilezen/joerd/blob/master/docs/attribution.md)을 따릅니다. 광화문 타일 메타데이터의 원본은 SRTM입니다. |
| [EOxCloudless 2025](https://cloudless.eox.at/license-non-commercial) | Copernicus Sentinel-2 합성 영상. 해커톤의 비상업 시연에 CC BY-NC-SA 4.0 조건으로 사용하며 출처를 지도에 표기합니다. 상업 사용에는 EOX 라이선스가 필요합니다. |
| [OpenFreeMap](https://openfreemap.org/) | 공개 인스턴스는 키 없이 무료입니다. 지도에 OpenFreeMap 및 OpenMapTiles 출처를 표시하고, [OSM 데이터는 ODbL](https://www.openstreetmap.org/copyright)을 따릅니다. |
| [CesiumJS / Cesium ion](https://cesium.com/platform/cesium-ion/pricing/) | CesiumJS는 Apache-2.0이며 정밀 지형과 3D Tiles에 적합합니다. Cesium ion 호스팅 데이터는 가입 및 [액세스 토큰](https://cesium.com/learn/ion/cesium-ion-access-tokens/)이 필요하며 무료 Community 요금제에는 이용 범위와 할당량이 있습니다. |
| [VWorld](https://www.vworld.kr/) | 국내 공간정보와 3D 지도 API를 제공합니다. 도입 시 VWorld 포털의 개발자 메뉴에서 서비스 도메인을 등록하고 인증키를 발급받은 뒤 이용 범위와 재배포 조건을 확인합니다. |
| [Three.js](https://github.com/mrdoob/three.js) / 지역 GLB | Three.js는 MIT이며 기존 뷰어와 지역 단위 모델에 적합합니다. 전국 타일의 좌표 변환·스트리밍·상세도 관리를 추가로 구현해야 하므로 이번 지도는 타일을 직접 스트리밍합니다. |

DEM 조회값은 원본 지형 래스터의 표본입니다. 픽셀 인코딩의 정밀도와 원본 지형의 수평·수직 정확도는 다릅니다. 해역에서는 음의 값이 나올 수 있고, 정밀 침수 모델에 사용할 때는 대상 지역 DEM의 수직 기준면과 해상도를 먼저 확인해야 합니다.

### 재난 효과 연동

기존 Three.js 템플릿과 분리된 `korea/`에서 지도 UI는 `map.js`, 고도 조회는
`dem.js`, 레이어 등록 및 좌표 변환은 `disaster-layers.js`가 처리합니다.
초기화 후 `window.koreaMap`이 설정되고 `window`에 `korea-map-ready` 이벤트가 발생합니다.

```js
const { map, getElevation, disasters } = window.koreaMap;
const groundElevation = await getElevation(126.977, 37.574);
const anchor = await disasters.locate({
  longitude: 126.977,
  latitude: 37.574,
  heightAboveGround: 15,
});
// anchor.altitude는 DEM 고도 + 지표 위 높이(m)이며,
// anchor.mercator는 MapLibre custom layer의 배치에 사용할 수 있습니다.
// GeoJSON 레이어라면 map.addSource(...)로 원본을 먼저 등록합니다.
// disasters.addLayer({ id: 'disaster-flood', type: 'fill', source: 'flood' });
// disasters.removeLayer('disaster-flood');
```

### 브이월드 3D 지도

[브이월드 포털 개발자 메뉴](https://www.vworld.kr/dev/v4dv_apikeyapp_s001.do)에서 자기 프로젝트용 OpenAPI 인증키를 발급받고 브라우저에서 접속할 서비스 도메인을 등록합니다. 로컬 개발과 배포 주소가 다르면 각각의 등록 조건을 확인합니다. 예제 사이트의 키는 해당 서비스에 귀속됩니다.

기본 지도에서 **브이월드 3D 지도**를 열고 키를 입력합니다. 키는 해당 브라우저의 같은 출처에만 저장되며 이후 기본 주소에서 브이월드 지도가 열립니다. 지도 로드 후 왼쪽 패널은 숨겨집니다. 키를 변경하거나 삭제하려면 [브이월드 설정](http://localhost:8000/korea/vworld.html?settings=1)을 엽니다. 인증이 필요한 3D 모델 및 지형은 브이월드 SDK가 직접 표시합니다. 고도 클릭값은 공통 AWS 공개 DEM을 사용합니다.

SDK가 준비되면 `korea-vworld-ready` 이벤트가 발생합니다. `window.koreaVWorld.viewer`에서 Cesium 엔티티나 데이터소스를 추가하고, `window.koreaVWorld.getElevation(lng, lat)`으로 지표 고도를 가져올 수 있습니다.

### 브이월드 좌표와 3D 마커

지도에서 지점을 클릭하면 위도·경도와 AWS 공개 DEM 고도가 표시됩니다. 공개 DEM 조회에 실패하면 클릭한 브이월드 지형의 타원체 기준 높이를 표시합니다. **3D 마커**를 누르면 선택한 지점에 시험용 모델이 배치됩니다.

지형 타일은 화면 주변까지 미리 로딩하고, 화면 가장자리에도 같은 3D 타일 상세도 기준을 적용합니다. 표시 가능한 건물과 텍스처는 브이월드가 해당 지역에 제공하는 원본 데이터에 따릅니다.

다른 팀원이 효과를 연동할 때는 `korea-vworld-ready` 이후 `window.koreaVWorld.disasters.register(type, createEffect)`에 모듈을 등록합니다. 생성 함수는 지도·좌표·강도를 전달받고, `setIntensity`와 `destroy` 메서드를 반환합니다.

3D 마커는 [Khronos glTF Sample Assets의 Box](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/Box)를 사용합니다. © 2017 Cesium, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). 원본 모델 파일은 변경하지 않았으며, 지도에서 표시 크기만 조정합니다.

### 재난 · 기후변화 효과 (브이월드 3D)

브이월드 지도 오른쪽 위 **재난 · 기후변화** 패널에서 재난을 고르고 지도를 클릭해 발생 지점을 정합니다. 입력값은 숫자 칸과 슬라이더로 조정하며, 효과가 켜진 채로 지도를 클릭하면 그 자리로 옮겨집니다.

| 재난 | 지도 위 표현 (모두 실제 m) |
| --- | --- |
| 태풍 · 집중호우 | 화면 비, 어두운 하늘, 비 양에 따른 시정. 폭풍해일 · 침수 깊이만큼 물을 채워 DEM보다 낮은 땅만 잠김 |
| 해수면 상승 (기후변화) | 해수면 + 상승분(+ 폭풍해일)까지 바다가 올라옴. IPCC AR6 2100년 전망과 비교 |
| 지진해일 | 실제 주기 12분 파형(빠짐 → 차오름 → 잠김 → 빠짐)을 재생 배속만큼 빠르게, 처오름 높이까지 흙탕물. 물이 해안보다 높은 동안 물 끝이 해안선에서 육지 안쪽으로 밀려 들어감(육상 물살 2√(g·h), 4 ~ 30 m/s). 늘 바다에서 들어오므로 물 기준은 고르지 않음 |
| 지진 | 카메라 위치의 지반 가속도로 흔들림, 진도별 영향 반경 원 |
| 산불 | 피해 면적(또는 **영역 그리기**로 직접 그린 다각형)을 발화점에서 바깥으로 태움. 불꽃 수천 개 · 화선 · 불탄 자리 · 연기 |
| 폭염 · 대설 | 누런 연무 · 아지랑이 / 눈 내림, 위를 보는 면(지형 · 건물 지붕)에 눈이 쌓임 |

- 재난 정의 · 입력값 · 간이 공식은 템플릿 뷰어와 같은 `js/disaster.js`를 씁니다. 효과는 `korea/disasters/fx.js`, 패널은 `korea/disasters/panel.js`입니다.
- API: `koreaDisaster.set('flood', { rain: 90, hours: 6, drain: 40, polygon: [[경도, 위도], …] }, { longitude, latitude }, 부가데이터)` · `koreaDisaster.stop()` · `koreaDisaster.get()`
- 팀원 컨트롤러(`koreaVWorld.disasters`)는 `start({ type, longitude, latitude, intensity, params })`와 `setParams(type, params)`를 받도록 넓혔습니다. 기존 호출은 그대로 동작합니다.
- 해수면은 선택 지점 둘레 바다(공개 DEM이 음수인 곳)의 지도 높이로 정합니다.

### 브이월드 키

`korea/config.js`의 배포용 키가 기본으로 쓰입니다. 브이월드 키는 브라우저 코드에 드러나는 방식이며 포털에 등록한 서비스 URL에서만 동작합니다. 브라우저에서 직접 입력한 키(설정 화면)가 있으면 그쪽을 먼저 씁니다.

### 예비 지도 (브이월드 점검 · 장애 대비)

브이월드 SDK가 안 열리거나(점검 · 장애), 키 인증이 실패하거나, 20초 안에 지도가 준비되지 않은 채로 **시작하기**를 누르면 `korea/backup.html`로 넘어갑니다(20초가 지나도 시작하기 전에 브이월드가 뜨면 브이월드를 씀). 예비 지도는 브이월드와 같은 CesiumJS 1.99에 AWS 공개 DEM · Sentinel-2 영상 · OpenStreetMap 3D 건물(OpenFreeMap) · 물 표면을 올리고 같은 재난 패널 · 효과를 씁니다. 지도 서버로 브이월드를 쓰지 않습니다.
조작은 브이월드 지도와 같습니다: 왼쪽 끌기 이동 · 오른쪽 끌기 기울이기 · 휠 확대(`tile-coverage.js`), 오른쪽 지도 버튼(북쪽 맞추기 · 확대 · 축소 · 초기화, `map-nav.js`), 위치 검색창(브이월드 검색 API라 키가 있을 때만), 패널 · 검색 모양(`map-ui.css`). 차이: 건물은 외곽선을 높이만큼 세운 상자이고(브이월드 건물의 지진 · 침수 · 산불 손상 표현은 브이월드에서만), 거리 · 면적 · 높이 재기 버튼은 브이월드에만 있습니다. 키가 없을 때도 입력창 대신 예비 지도로 엽니다. 자동 전환을 끄려면 `vworld.html?nofallback=1`, 키 입력 · 지역 이동 창은 `vworld.html?settings=1`에서만 보입니다.

### 구름 · 하늘 (브이월드)

- **3D 구름**: 실제 높이 · 크기(m)의 구름 덩어리. 태풍은 적란운 · 난층운(밑면 0.5~1.2 km, 폭 4~7.5 km, 일부 5~8 km 탑), 호우는 난층운, 대설은 층적운. 바람(m/s)대로 흘러가고, 비 · 눈 구름 밑에는 빗줄기 · 눈발 커튼이 땅까지 내려옵니다. 카메라가 비구름 밑에 있을 때만 화면에 비 · 눈이 내립니다.
- **하늘**: 기본은 열대 정오. 템플릿 뷰어의 하늘 사진을 카메라를 감싼 하늘 구(스카이스피어)로 그립니다. "재난에 맞는 하늘로 자동 바꾸기"를 켜 두면 태풍 → 폭풍우, 호우 → 먹구름, 대설 → 눈보라 잿빛, 폭염 → 금빛 노을, 산불 → 호박빛 새벽, 해수면 상승 → 뭉게구름 쪽빛, 해일 → 회녹 흐림으로 바뀝니다.
- **시정**: 기본은 실제 시정의 10배(최소 18 km). "실제 시정"을 켜면 실제 값입니다. 날씨 효과는 카메라가 2.5 km보다 높아지면 옅어지고 8 km 위에서는 사라집니다.
- **백엔드 구름 연동**: 자동 생성 대신 서버가 준 구름을 그대로 띄웁니다.
  ```js
  koreaDisaster.clouds.load([
    { id: 'c1', longitude: 129.13, latitude: 35.19,   // 구름 중심
      base: 900,                                     // 밑면 해발 m (또는 baseAboveGround: 지면 위 m)
      width: 6000, height: 2500, depth: 4000,        // 가로 · 두께 · 세로 m
      speed: 12, direction: 60,                      // m/s, 이동 방향 (북 = 0°, 시계 방향)
      precip: 'rain', rate: 0.8, darkness: 0.8 },    // 비/눈, 세기 0~1, 어두움 0~1
  ]);
  koreaDisaster.clouds.update(list);  // 같은 id는 새 위치로 부드럽게 이동 · 크기 변경, 새 id 추가, 빠진 id 삭제
  koreaDisaster.clouds.clear();
  ```

### 재난 사건 목록 (백엔드 연동)

지도 오른쪽 **재난 사건** 서랍에 백엔드(`JsonParc/GDGoC_TUK_pssk_backend`)가 뉴스에서 뽑은 사건을 카드로 보여 줍니다. 최근 · 저장됨 탭, 재난 종류 · 지역(대한민국 먼저 / 대한민국만 / 해외만) 필터가 있습니다. 카드를 누르면 요약 · 피해 규모 · 시뮬레이션 입력값과 값마다 출처(기사 / 기사로 계산 / 기상청 실황 / 기본값(가정)) · 원문 기사 · 행동요령이 나오고, **시뮬레이션 실행**을 누르면 그 지역으로 이동해 `map_effect`대로 재난 효과를 켭니다. 저장(☆)은 이 브라우저에만 남습니다.

- 서버 주소: `korea/config.js`의 `DISASTER_API_URL`. 비워 두면 localhost에서 열 때만 `http://localhost:8001`을 씁니다.
- 백엔드 `ALLOWED_ORIGINS`에 이 사이트 주소(예: `https://jsonparc.github.io`, Render 프론트 주소)를 넣어야 합니다.
- 프론트 보정: 한파 카드는 눈이 내리지 않게(`rate 0`), 기사에서 온 해일 높이는 이미 해안 높이라 처오름 배율 1.
