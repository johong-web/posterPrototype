# Unity WebGL AI Project Roadmap

## 프로젝트 구조
```
Scene 1: AR 포스터 (WebAR)
Scene 2: AI 이미지 애니메이션
Claude AI: 챗봇 및 프롬프트 생성
```

---

## 1. 초기 설정

**Unity 환경**
- Unity 2022.3 LTS + URP
- Platform: WebGL

**폴더 구조**
```
Assets/
├── Scenes/
│   ├── MainMenu.unity
│   ├── ARPoster.unity
│   └── AIAnimation.unity
├── Scripts/
│   ├── ARTracking.cs
│   ├── AIVideoGenerator.cs
│   └── ClaudeAPIClient.cs
└── Plugins/WebGL/
    └── *.jslib
```

---

## 2. Scene 1: AR 포스터

**필요 라이브러리**
- AR.js
- A-Frame

**핵심 기능**
1. 이미지 마커 트래킹
2. 마커 인식 시 비디오 재생
3. Unity ↔ JavaScript 통신

**주요 스크립트**
- ARTracking.cs: 마커 감지 및 이벤트 처리
- VideoController.cs: 비디오 재생 제어

---

## 3. Scene 2: AI 애니메이션

**워크플로우**
```
사진 업로드 → AI API 호출 → 영상 생성 대기 → 재생
```

**AI 서비스 옵션**
- Kling AI (추천)
- Runway Gen-3
- Luma Dream Machine

**주요 스크립트**
- ImageUploader.cs: 웹 파일 업로드
- AIVideoGenerator.cs: AI API 통합
- VideoPlayer 제어

---

## 4. Claude AI 통합

**기능**
1. 챗봇 UI
2. 프롬프트 자동 생성
3. 사용자 가이드

**API 연동**
```csharp
// Anthropic API 호출
POST https://api.anthropic.com/v1/messages
Headers:
  - x-api-key: YOUR_API_KEY
  - anthropic-version: 2023-06-01
Body: {
  model: "claude-sonnet-4-20250514",
  max_tokens: 1000,
  messages: [{role: "user", content: "..."}]
}
```

**주요 스크립트**
- ClaudeAPIClient.cs: API 통신
- ChatbotUI.cs: 채팅 인터페이스
- PromptGenerator.cs: 프롬프트 생성

---

## 5. JavaScript 통신

**Unity → JavaScript**
```csharp
[DllImport("__Internal")]
private static extern void JavaScriptFunction();
```

**JavaScript → Unity**
```javascript
SendMessage('ObjectName', 'MethodName', 'parameter');
```

---

## 6. WebGL 빌드 설정

**Build Settings**
- Compression: Brotli
- Code Optimization: Size
- Strip Engine Code: Enabled

**HTML Template**
- AR.js 라이브러리 포함
- Unity Loader
- 반응형 레이아웃

---

## 7. 개발 순서

1. Unity 프로젝트 생성
2. WebGL 빌드 테스트
3. AR 포스터 구현
4. AI 애니메이션 구현
5. Claude AI 통합
6. UI/UX 개선
7. 최적화 및 배포

---

## 8. API Keys

```
ANTHROPIC_API_KEY=sk-ant-...
KLING_API_KEY=...
```

---

## 참고 문서

- Claude API: https://docs.anthropic.com/
- Kling AI: https://docs.klingai.com/
- AR.js: https://ar-js-org.github.io/AR.js-Docs/
- Unity WebGL: https://docs.unity3d.com/Manual/webgl.html
