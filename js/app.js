document.addEventListener('DOMContentLoaded', () => {
  const loadingEl = document.getElementById('loading');
  const scanGuideEl = document.getElementById('scan-guide');
  const sceneEl = document.querySelector('a-scene');
  const videoEl = document.getElementById('poster-video');

  // Scene 로드 완료
  sceneEl.addEventListener('loaded', () => {
    console.log('Scene loaded');
    loadingEl.classList.add('hidden');
    scanGuideEl.classList.remove('hidden');
  });

  // 타겟 인식/해제 시 안내 UI 토글
  sceneEl.addEventListener('zappar-visible', () => {
    console.log('Target Found');
    scanGuideEl.classList.add('hidden');
  });

  sceneEl.addEventListener('zappar-notvisible', () => {
    console.log('Target Lost');
    scanGuideEl.classList.remove('hidden');
  });

  // 모바일에서 터치시 비디오 재생 (autoplay 정책 우회)
  document.body.addEventListener('click', () => {
    if (videoEl && videoEl.paused) {
      videoEl.play().catch(err => {
        console.log('Video play failed:', err);
      });
    }
  }, { once: true });
});
