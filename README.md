# AR Poster Project

MindAR을 사용한 이미지 트래킹 기반 AR 포스터 프로젝트

## 개요

포스터 이미지를 카메라로 비추면 해당 포스터 위에 영상이 오버레이되어 재생됩니다.

### 주요 기능
- 포스터 이미지 인식 (NFT 마커)
- 실시간 이미지 트래킹 (Homography 지원)
- 영상 오버레이 재생
- 커스텀 스무딩 필터 (떨림 감소)
- 모바일 브라우저 지원

### 기술 스택
- **MindAR** - 이미지 트래킹 라이브러리
- **A-Frame** - 3D/VR 웹 프레임워크
- **HTML/CSS/JavaScript** - 프론트엔드

---

## 프로젝트 구조

```
posterPrototype/
├── index.html              # 메인 페이지
├── css/
│   └── style.css           # 스타일
├── js/
│   └── app.js              # AR 로직 + 커스텀 스무딩
├── assets/
│   ├── marker/
│   │   └── targets.mind    # 마커 파일 (포스터 이미지 컴파일)
│   └── video/
│       └── video.mp4       # 재생할 영상
├── package.json
└── README.md
```

---

## 설치 및 실행

### 1. 의존성 설치

```bash
npm install
```

### 2. 로컬 서버 실행

```bash
npx serve -l 3000
```

PC 브라우저에서 확인: http://localhost:3000

### 3. 모바일 테스트 (HTTPS 필요)

모바일에서 카메라 접근을 위해 HTTPS가 필요합니다.

**Cloudflare Tunnel 사용 (추천):**

```bash
# 터미널 1: 로컬 서버 실행
npx serve -l 3000

# 터미널 2: Cloudflare 터널 실행
npx cloudflared tunnel --url http://localhost:3000
```

출력에서 `https://xxxxx.trycloudflare.com` URL을 모바일에서 접속합니다.

---

## 마커 파일 생성 방법

포스터 이미지를 `.mind` 파일로 변환해야 합니다.

### 온라인 컴파일러 사용

1. https://hiukim.github.io/mind-ar-js-doc/tools/compile 접속
2. 포스터 이미지 업로드
3. "Start" 클릭
4. "Download" 클릭
5. `targets.mind` 파일을 `assets/marker/` 폴더에 저장

### Scale 설명 (미리보기 탭)

| Scale | 의미 |
|-------|------|
| Scale 1 | 가까운 거리에서의 특징점 |
| Scale 12 | 먼 거리에서의 특징점 |

Scale 탭은 미리보기용이며, 컴파일시 자동으로 모든 Scale이 포함됩니다.

---

## 영상 파일 설정

### 지원 형식
- MP4 (H.264 코덱 추천)
- WebM

### 주의사항
- 모바일 호환성을 위해 MP4 사용 권장
- 파일 크기는 가볍게 유지 (10MB 이하 추천)
- 영상 비율은 포스터 비율과 동일하게
- 영상 첫 프레임이 포스터 이미지와 동일하면 더 자연스러움

### 현재 설정
- 포스터 크기: 1208 x 1702 (가로:세로 = 0.71:1)
- 영상 파일 경로: `assets/video/video.mp4`

---

## 코드 구조

### index.html

```html
<!-- MindAR + A-Frame 라이브러리 -->
<script src="https://aframe.io/releases/1.4.2/aframe.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/mind-ar@1.2.5/dist/mindar-image-aframe.prod.js"></script>

<!-- AR Scene -->
<a-scene mindar-image="imageTargetSrc: assets/marker/targets.mind;">
  <a-entity mindar-image-target="targetIndex: 0">
    <a-video src="#poster-video" width="1" height="1.409"></a-video>
  </a-entity>
</a-scene>
```

### app.js 주요 기능

| 기능 | 설명 |
|------|------|
| AR 이벤트 처리 | arReady, arError, targetFound, targetLost |
| 커스텀 스무딩 | 작은 떨림 무시, 큰 움직임만 부드럽게 반영 |
| 비디오 제어 | 타겟 인식시 자동 재생 |

### 스무딩 파라미터 조정

`js/app.js` 파일에서 조정 가능:

```javascript
const SMOOTHING = {
  positionThreshold: 0.02,  // 위치 임계값 (높이면 더 안정적)
  rotationThreshold: 0.5,   // 회전 임계값 (높이면 더 안정적)
  lerpFactor: 0.15          // 보간 계수 (낮추면 더 부드러움)
};
```

---

## 사용 방법

1. 모바일에서 URL 접속
2. 카메라 권한 허용
3. 포스터 이미지를 카메라에 비추기
4. 포스터 위에 영상이 재생됨

---

## 트러블슈팅

### 카메라가 안 켜짐
- HTTPS로 접속했는지 확인
- 브라우저 카메라 권한 확인

### 포스터 인식이 안 됨
- 조명이 충분한지 확인
- 포스터가 구겨지거나 반사되지 않는지 확인
- `.mind` 파일이 올바른 이미지로 생성되었는지 확인

### 영상이 재생되지 않음
- 모바일에서는 화면 터치 필요 (자동재생 정책)
- 영상 파일 경로 확인
- 영상 코덱 확인 (H.264 권장)

### 영상이 떨림
- `app.js`에서 `positionThreshold`, `rotationThreshold` 값을 높이기
- `lerpFactor` 값을 낮추기 (더 부드러운 움직임)

---

## 배포

### 정적 호스팅 서비스 사용
- GitHub Pages
- Netlify
- Vercel
- Firebase Hosting

### 주의사항
- 반드시 HTTPS로 배포해야 함
- 영상 파일 용량 확인

---

## 대안 라이브러리 비교

더 나은 트래킹 품질이 필요한 경우:

| 라이브러리 | 안정성 | 가격 | 특징 |
|-----------|--------|------|------|
| MindAR | 중 | 무료 | 오픈소스, 기본적인 이미지 트래킹 |
| Zappar | 상 | 무료 티어 있음 | 더 안정적, 상용 수준 |
| 8th Wall | 최상 | 유료 ($99/월~) | 업계 최고 품질 |

---

## 참고 자료

- [MindAR 공식 문서](https://hiukim.github.io/mind-ar-js-doc/)
- [A-Frame 공식 문서](https://aframe.io/docs/)
- [MindAR GitHub](https://github.com/hiukim/mind-ar-js)
- [Zappar](https://zap.works/)
- [8th Wall](https://www.8thwall.com/)
