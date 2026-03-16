// AR Controller: 기기 감지 + 적절한 핸들러 로드
(async function () {
  const loadingEl = document.getElementById('loading');
  const scanGuideEl = document.getElementById('scan-guide');
  const videoEl = document.getElementById('poster-video');
  const modeEl = document.getElementById('ar-mode');

  function setLoading(text, hint) {
    const p = loadingEl.querySelector('p');
    const h = loadingEl.querySelector('.loading-hint');
    if (p) p.textContent = text;
    if (h) h.textContent = hint || '';
  }

  function showError(msg) {
    setLoading(msg, '');
    const spinner = loadingEl.querySelector('.spinner');
    if (spinner) spinner.style.display = 'none';
  }

  // WebXR Image Tracking 지원 체크
  async function checkWebXRSupport() {
    if (!navigator.xr) return false;
    try {
      const supported = await navigator.xr.isSessionSupported('immersive-ar');
      return supported;
    } catch (e) {
      return false;
    }
  }

  // 스크립트 동적 로드
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  // 메인 초기화
  try {
    setLoading('기기 확인 중...', '');

    const webxrSupported = await checkWebXRSupport();

    if (webxrSupported) {
      // Android Chrome + ARCore → WebXR 모드
      console.log('WebXR Image Tracking 지원 → WebXR 모드');
      if (modeEl) modeEl.textContent = 'WebXR (ARCore)';
      setLoading('AR 로딩 중...', 'WebXR 모드 (최고 품질)');
      await loadScript('js/webxr-handler.js');
    } else {
      // iOS Safari / 미지원 → MindAR 모드
      console.log('WebXR 미지원 → MindAR 모드');
      if (modeEl) modeEl.textContent = 'MindAR';
      setLoading('AR 로딩 중...', 'MindAR 모드');
      await loadScript('js/mindar-handler.js');
    }
  } catch (err) {
    console.error('AR 초기화 실패:', err);
    showError('AR을 시작할 수 없습니다');
  }
})();
