// MindAR Handler (iOS Safari / WebXR 미지원 폴백)
// 칼만 필터 + MindAR 내장 One Euro Filter 극한 튜닝
(async function () {
  const loadingEl = document.getElementById('loading');
  const scanGuideEl = document.getElementById('scan-guide');
  const videoEl = document.getElementById('poster-video');

  // ==========================================
  // 1D 칼만 필터
  // ==========================================
  class KalmanFilter1D {
    constructor(Q, R, x0) {
      this.Q = Q;
      this.R = R;
      this.x = x0 || 0;
      this.P = 1;
    }
    update(z) {
      const pPred = this.P + this.Q;
      const K = pPred / (pPred + this.R);
      this.x = this.x + K * (z - this.x);
      this.P = (1 - K) * pPred;
      return this.x;
    }
    reset(v) { this.x = v; this.P = 1; }
  }

  class KalmanFilter3D {
    constructor(Q, R) {
      this.f = [new KalmanFilter1D(Q, R), new KalmanFilter1D(Q, R), new KalmanFilter1D(Q, R)];
    }
    update(x, y, z) {
      return { x: this.f[0].update(x), y: this.f[1].update(y), z: this.f[2].update(z) };
    }
    reset(x, y, z) { this.f[0].reset(x); this.f[1].reset(y); this.f[2].reset(z); }
    last() { return { x: this.f[0].x, y: this.f[1].x, z: this.f[2].x }; }
  }

  const posK = new KalmanFilter3D(0.00001, 0.01);
  const rotK = new KalmanFilter3D(0.00005, 0.02);
  const GRACE = 1000;
  let isTracking = false;
  let lastTrackTime = 0;
  let initialized = false;

  // MindAR + A-Frame 동적 로드
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  try {
    await loadScript('https://aframe.io/releases/1.4.2/aframe.min.js');
    await loadScript('https://cdn.jsdelivr.net/npm/mind-ar@1.2.5/dist/mindar-image-aframe.prod.js');

    // A-Frame scene 동적 생성
    const sceneEl = document.createElement('a-scene');
    sceneEl.setAttribute('mindar-image',
      'imageTargetSrc: assets/marker/targets.mind; autoStart: true; uiLoading: no; uiScanning: no; uiError: no; filterMinCF: 0.0001; filterBeta: 0.1; missTolerance: 5; warmupTolerance: 5;'
    );
    sceneEl.setAttribute('color-space', 'sRGB');
    sceneEl.setAttribute('renderer', 'colorManagement: true; physicallyCorrectLights: true;');
    sceneEl.setAttribute('vr-mode-ui', 'enabled: false');
    sceneEl.setAttribute('device-orientation-permission-ui', 'enabled: false');

    // Assets
    const assets = document.createElement('a-assets');
    const vid = document.createElement('video');
    vid.id = 'mindar-video';
    vid.src = 'assets/video/video.mp4';
    vid.setAttribute('preload', 'auto');
    vid.setAttribute('loop', 'true');
    vid.setAttribute('crossorigin', 'anonymous');
    vid.setAttribute('playsinline', '');
    vid.setAttribute('webkit-playsinline', '');
    vid.setAttribute('muted', '');
    assets.appendChild(vid);
    sceneEl.appendChild(assets);

    // Camera
    const cam = document.createElement('a-camera');
    cam.setAttribute('position', '0 0 0');
    cam.setAttribute('look-controls', 'enabled: false');
    sceneEl.appendChild(cam);

    // Image Target + Video
    const target = document.createElement('a-entity');
    target.setAttribute('mindar-image-target', 'targetIndex: 0');
    const aVideo = document.createElement('a-video');
    aVideo.setAttribute('src', '#mindar-video');
    aVideo.setAttribute('position', '0 0 0');
    aVideo.setAttribute('width', '1');
    aVideo.setAttribute('height', '1.409');
    aVideo.setAttribute('rotation', '0 0 0');
    target.appendChild(aVideo);
    sceneEl.appendChild(target);

    document.body.appendChild(sceneEl);

    // 이벤트 바인딩
    sceneEl.addEventListener('arReady', () => {
      console.log('MindAR Ready');
      loadingEl.classList.add('hidden');
      scanGuideEl.classList.remove('hidden');
    });

    sceneEl.addEventListener('arError', () => {
      loadingEl.querySelector('p').textContent = '카메라를 사용할 수 없습니다';
      loadingEl.querySelector('.loading-hint').textContent = '카메라 권한을 확인해주세요';
      loadingEl.querySelector('.spinner').style.display = 'none';
    });

    target.addEventListener('targetFound', () => {
      console.log('Target Found (MindAR)');
      scanGuideEl.classList.add('hidden');
      isTracking = true;
      lastTrackTime = Date.now();

      const obj = target.object3D;
      if (!initialized) {
        posK.reset(obj.position.x, obj.position.y, obj.position.z);
        rotK.reset(obj.rotation.x, obj.rotation.y, obj.rotation.z);
        initialized = true;
      }

      vid.play().catch(err => console.log('Autoplay blocked:', err));
    });

    target.addEventListener('targetLost', () => {
      console.log('Target Lost (MindAR)');
      isTracking = false;
    });

    // 칼만 필터 매 프레임 적용
    sceneEl.addEventListener('renderstart', () => {
      const tick = () => {
        if (target) {
          const obj = target.object3D;
          const now = Date.now();

          if (isTracking) {
            lastTrackTime = now;
            const fp = posK.update(obj.position.x, obj.position.y, obj.position.z);
            const fr = rotK.update(obj.rotation.x, obj.rotation.y, obj.rotation.z);
            obj.position.set(fp.x, fp.y, fp.z);
            obj.rotation.set(fr.x, fr.y, fr.z);
          } else if (now - lastTrackTime < GRACE && initialized) {
            const lp = posK.last();
            const lr = rotK.last();
            posK.update(lp.x, lp.y, lp.z);
            rotK.update(lr.x, lr.y, lr.z);
            obj.position.set(lp.x, lp.y, lp.z);
            obj.rotation.set(lr.x, lr.y, lr.z);
          } else if (now - lastTrackTime >= GRACE && !isTracking) {
            scanGuideEl.classList.remove('hidden');
          }
        }
        requestAnimationFrame(tick);
      };
      tick();
    });

  } catch (err) {
    console.error('MindAR 초기화 실패:', err);
    loadingEl.querySelector('p').textContent = 'AR을 시작할 수 없습니다';
    loadingEl.querySelector('.spinner').style.display = 'none';
  }

  // 터치로 비디오 재생
  document.body.addEventListener('click', () => {
    const v = document.getElementById('mindar-video');
    if (v && v.paused) v.play().catch(() => {});
  }, { once: true });
})();
