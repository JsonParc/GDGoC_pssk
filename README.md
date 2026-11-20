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

## 구조

- `templates.html`: 뷰어 (three.js r128, 자유 비행 카메라, 템플릿 선택 UI)
- `js/terrain.js`: 높이장·메시 로더, 지형 셰이더 (triplanar 바위·풀 질감)
- `js/atmosphere.js`: 하늘·조명·안개 프리셋
- `js/ocean.js`: FFT 바다 시뮬레이션
- `js/scenery.js`: 그림자, 나무·바위 배치, 색 처리

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
