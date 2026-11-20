// 배포용 브이월드 WebGL 인증키 (개발키, 2027-05-20 만료).
// 브이월드 키는 브라우저 코드에 그대로 드러나는 방식이고, 브이월드 포털에 등록한 서비스 URL에서만 동작합니다
// (현재 등록: https://jsonparc.github.io/GDGoC_TUK_pssk/). 다른 주소에서 쓰려면 포털에서 도메인을 추가하세요.
// 브라우저에서 직접 입력한 키(설정 화면, localStorage)가 있으면 그쪽을 먼저 씁니다.
window.KOREA_VWORLD_KEY = 'D989545A-232E-41A2-8532-B6E66D86B907';

// 재난 사건 목록 · 상세를 주는 백엔드 API 주소 (JsonParc/GDGoC_TUK_pssk_backend). 끝에 / 없이.
// 비워 두면 localhost에서 열 때만 http://localhost:8001을 씀. 백엔드를 배포하면 그 주소를 넣으세요 (예: 'https://xxx.onrender.com').
// 백엔드 쪽 ALLOWED_ORIGINS에 이 사이트 주소(https://jsonparc.github.io 등)가 들어가야 브라우저가 응답을 받을 수 있음
window.DISASTER_API_URL = 'https://earthpulse-api-vibv.onrender.com';
