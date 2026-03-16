// WebXR Image Tracking Handler (Android Chrome + ARCore)
// 6-DOF 포즈 추정으로 최고 품질 트래킹
(async function () {
  const loadingEl = document.getElementById('loading');
  const scanGuideEl = document.getElementById('scan-guide');
  const videoEl = document.getElementById('poster-video');

  const POSTER_WIDTH_METERS = 0.42;  // 포스터 실제 가로 크기 (미터)
  const POSTER_ASPECT = 1702 / 1208; // 세로/가로 비율 = 1.409

  let xrSession = null;
  let xrRefSpace = null;
  let gl = null;
  let renderer = null;
  let scene = null;
  let camera = null;
  let videoMesh = null;
  let videoTexture = null;
  let isTracking = false;

  // Three.js 동적 로드
  async function loadThreeJS() {
    return new Promise((resolve, reject) => {
      if (window.THREE) return resolve();
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/three@0.150.0/build/three.min.js';
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  try {
    // 1. Three.js 로드
    await loadThreeJS();

    // 2. 포스터 이미지를 ImageBitmap으로 로드
    const response = await fetch('assets/poster/poster.jpg');
    const blob = await response.blob();
    const imageBitmap = await createImageBitmap(blob);
    console.log('포스터 이미지 로드 완료:', imageBitmap.width, 'x', imageBitmap.height);

    // 3. WebXR 세션 요청
    const canvas = document.createElement('canvas');
    canvas.style.position = 'fixed';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.zIndex = '1';
    document.body.appendChild(canvas);

    gl = canvas.getContext('webgl2', { xrCompatible: true });
    if (!gl) {
      gl = canvas.getContext('webgl', { xrCompatible: true });
    }

    xrSession = await navigator.xr.requestSession('immersive-ar', {
      requiredFeatures: ['image-tracking', 'dom-overlay'],
      trackedImages: [{
        image: imageBitmap,
        widthInMeters: POSTER_WIDTH_METERS
      }],
      domOverlay: { root: document.getElementById('overlay') }
    });

    // 4. Three.js 렌더러 설정
    renderer = new THREE.WebGLRenderer({ canvas, context: gl, alpha: true });
    renderer.autoClear = false;
    renderer.xr.enabled = true;
    renderer.xr.setReferenceSpaceType('local');
    await renderer.xr.setSession(xrSession);

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera();

    // 5. 비디오 텍스처 + 메시 생성
    videoTexture = new THREE.VideoTexture(videoEl);
    videoTexture.minFilter = THREE.LinearFilter;
    videoTexture.magFilter = THREE.LinearFilter;

    const videoWidth = POSTER_WIDTH_METERS;
    const videoHeight = POSTER_WIDTH_METERS * POSTER_ASPECT;
    const geometry = new THREE.PlaneGeometry(videoWidth, videoHeight);
    const material = new THREE.MeshBasicMaterial({
      map: videoTexture,
      side: THREE.DoubleSide
    });
    videoMesh = new THREE.Mesh(geometry, material);
    videoMesh.visible = false;
    scene.add(videoMesh);

    // 6. 레퍼런스 스페이스
    xrRefSpace = await xrSession.requestReferenceSpace('local');

    // UI 업데이트
    loadingEl.classList.add('hidden');
    scanGuideEl.classList.remove('hidden');

    console.log('WebXR Image Tracking 초기화 완료');

    // 7. 렌더 루프
    renderer.setAnimationLoop((time, frame) => {
      if (!frame) return;

      const results = frame.getImageTrackingResults();

      if (results.length > 0) {
        const result = results[0];
        const state = result.trackingState;

        if (state === 'tracked' || state === 'emulated') {
          const pose = frame.getPose(result.imageSpace, xrRefSpace);

          if (pose) {
            if (!isTracking) {
              isTracking = true;
              videoMesh.visible = true;
              scanGuideEl.classList.add('hidden');
              videoEl.play().catch(err => console.log('Autoplay blocked:', err));
            }

            // 6-DOF 포즈 적용
            const pos = pose.transform.position;
            const ori = pose.transform.orientation;

            videoMesh.position.set(pos.x, pos.y, pos.z);
            videoMesh.quaternion.set(ori.x, ori.y, ori.z, ori.w);
          }
        } else {
          if (isTracking) {
            isTracking = false;
            videoMesh.visible = false;
            scanGuideEl.classList.remove('hidden');
            videoEl.pause();
          }
        }
      }

      renderer.render(scene, camera);
    });

    // 세션 종료 처리
    xrSession.addEventListener('end', () => {
      console.log('WebXR 세션 종료');
      renderer.setAnimationLoop(null);
    });

  } catch (err) {
    console.error('WebXR 초기화 실패:', err);

    // WebXR 실패 시 MindAR로 폴백
    console.log('MindAR로 폴백합니다...');
    const script = document.createElement('script');
    script.src = 'js/mindar-handler.js';
    document.head.appendChild(script);
  }

  // 터치로 비디오 재생 (autoplay 정책)
  document.body.addEventListener('click', () => {
    if (videoEl && videoEl.paused) {
      videoEl.play().catch(err => console.log('Video play failed:', err));
    }
  }, { once: true });
})();
