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

- **지형 15종** (`data/terrain/<id>.r16` 높이장 + `scenes/<id>.json/.geo.bin` 실제 메시 + `color/<id>.jpg` 지형 색)
- **하늘 15종** (`data/sky/<id>.jpg` 하늘 텍스처 + `js/atmosphere.js`의 `PRESETS` 조명·구름·안개)
- **바다 15종** (`js/atmosphere.js`의 `WATER_LOOK` 물 맑기·흰 물마루·해저색 + 바다 색·거칠기)

`catalog.json`의 `pairs`는 지형마다 기본으로 어울리는 하늘·바다입니다. 패널의 "지형에 어울리는 하늘·바다 함께 적용"을 끄면 지형만 바뀝니다.

## 구조

- `index.html`: 뷰어 (three.js r128, 자유 비행 카메라, 템플릿 선택 UI)
- `js/terrain.js`: 높이장·메시 로더, 지형 셰이더 (triplanar 바위·풀 질감)
- `js/atmosphere.js`: 하늘·조명·안개 프리셋
- `js/ocean.js`: FFT 바다 시뮬레이션
- `js/scenery.js`: 그림자, 나무·바위 배치, 색 처리
