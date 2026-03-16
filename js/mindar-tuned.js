document.addEventListener('DOMContentLoaded', () => {
  const loadingEl = document.getElementById('loading');
  const scanGuideEl = document.getElementById('scan-guide');
  const sceneEl = document.querySelector('a-scene');
  const unmuteOverlay = document.getElementById('unmute-overlay');
  const unmuteBtn = document.getElementById('unmute-btn');

  // 비디오 요소들
  const videos = [
    document.getElementById('poster-video-0'),
    document.getElementById('poster-video-1')
  ];

  // ==========================================
  // 적응형 1D 칼만 필터 (속도 기반 Q 조절)
  // ==========================================
  class AdaptiveKalman1D {
    constructor(baseQ, R, maxQ) {
      this.baseQ = baseQ;
      this.maxQ = maxQ || baseQ * 100;
      this.R = R;
      this.x = 0;
      this.P = 1;
      this.prevX = 0;
      this.velocity = 0;
    }

    update(z) {
      const diff = Math.abs(z - this.x);
      const adaptiveQ = this.baseQ + (this.maxQ - this.baseQ) * Math.min(diff * 5, 1);

      const pPred = this.P + adaptiveQ;
      const K = pPred / (pPred + this.R);
      this.prevX = this.x;
      this.x = this.x + K * (z - this.x);
      this.P = (1 - K) * pPred;
      this.velocity = this.x - this.prevX;
      return this.x;
    }

    reset(v) { this.x = v; this.prevX = v; this.P = 1; this.velocity = 0; }
  }

  // ==========================================
  // 3D 적응형 칼만 필터 + 이상치 제거
  // ==========================================
  class SmoothedFilter3D {
    constructor(baseQ, R, maxQ, outlierThreshold) {
      this.f = [
        new AdaptiveKalman1D(baseQ, R, maxQ),
        new AdaptiveKalman1D(baseQ, R, maxQ),
        new AdaptiveKalman1D(baseQ, R, maxQ)
      ];
      this.outlierThreshold = outlierThreshold || Infinity;
      this.frameCount = 0;
    }

    update(x, y, z) {
      this.frameCount++;

      if (this.frameCount > 10) {
        const dx = Math.abs(x - this.f[0].x);
        const dy = Math.abs(y - this.f[1].x);
        const dz = Math.abs(z - this.f[2].x);
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

        if (dist > this.outlierThreshold) {
          return { x: this.f[0].x, y: this.f[1].x, z: this.f[2].x };
        }
      }

      return {
        x: this.f[0].update(x),
        y: this.f[1].update(y),
        z: this.f[2].update(z)
      };
    }

    reset(x, y, z) {
      this.f[0].reset(x); this.f[1].reset(y); this.f[2].reset(z);
      this.frameCount = 0;
    }

    last() { return { x: this.f[0].x, y: this.f[1].x, z: this.f[2].x }; }
  }

  // ==========================================
  // 타겟별 필터 & 상태
  // ==========================================
  const NUM_TARGETS = 2;

  const targets = [];
  for (let i = 0; i < NUM_TARGETS; i++) {
    targets.push({
      posFilter: new SmoothedFilter3D(0.000005, 0.02, 0.001, 0.5),
      rotFilter: new SmoothedFilter3D(0.00002, 0.03, 0.002, 0.8),
      isTracking: false,
      lastTrackingTime: 0,
      initialized: false,
      el: null
    });
  }

  const TRACKING_LOSS_GRACE = 2000;

  // ==========================================
  // 오디오 상태 관리
  // ==========================================
  let audioUnlocked = false;

  function unlockAudio() {
    if (audioUnlocked) return;
    audioUnlocked = true;

    // 모든 비디오 음소거 해제
    videos.forEach(v => {
      if (v) v.muted = false;
    });

    unmuteOverlay.classList.add('hidden');
    console.log('[Audio] Unmuted all videos');
  }

  // 음소거 해제 버튼
  if (unmuteBtn) {
    unmuteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      unlockAudio();
      // 현재 트래킹 중인 비디오 재생
      videos.forEach(v => {
        if (v && v.paused) v.play().catch(() => {});
      });
    });
  }

  // 화면 터치로도 오디오 해제
  document.body.addEventListener('click', () => {
    unlockAudio();
    videos.forEach(v => {
      if (v && v.paused) v.play().catch(() => {});
    });
  }, { once: true });

  // ==========================================
  // AR 시스템 이벤트
  // ==========================================
  sceneEl.addEventListener('arReady', () => {
    console.log('[AR] Ready (Multi-Target + Audio)');
    loadingEl.classList.add('hidden');
    scanGuideEl.classList.remove('hidden');

    // 타겟 엘리먼트 바인딩
    const targetEls = document.querySelectorAll('[mindar-image-target]');
    targetEls.forEach((el) => {
      const idx = parseInt(el.getAttribute('mindar-image-target').targetIndex);
      if (idx >= 0 && idx < NUM_TARGETS) {
        targets[idx].el = el;
      }
    });

    // MindAR 컴포넌트에서 targetIndex 파싱이 안될 수 있으므로 순서로도 할당
    if (!targets[0].el && targetEls.length >= 1) targets[0].el = targetEls[0];
    if (!targets[1].el && targetEls.length >= 2) targets[1].el = targetEls[1];
  });

  sceneEl.addEventListener('arError', (event) => {
    console.error('[AR] Error:', event);
    loadingEl.querySelector('p').textContent = '카메라를 사용할 수 없습니다';
    loadingEl.querySelector('.loading-hint').textContent = '카메라 권한을 확인해주세요';
    loadingEl.querySelector('.spinner').style.display = 'none';
  });

  // ==========================================
  // 타겟별 이벤트 바인딩
  // ==========================================
  const targetEls = document.querySelectorAll('[mindar-image-target]');

  targetEls.forEach((el, idx) => {
    if (idx >= NUM_TARGETS) return;

    el.addEventListener('targetFound', () => {
      console.log(`[Target ${idx}] Found`);
      const t = targets[idx];
      t.isTracking = true;
      t.lastTrackingTime = Date.now();

      scanGuideEl.classList.add('hidden');

      const obj = el.object3D;
      if (!t.initialized) {
        t.posFilter.reset(obj.position.x, obj.position.y, obj.position.z);
        t.rotFilter.reset(obj.rotation.x, obj.rotation.y, obj.rotation.z);
        t.initialized = true;
      }

      // 다른 타겟의 비디오 정지 & 숨김 (한 번에 하나만 표시)
      for (let j = 0; j < NUM_TARGETS; j++) {
        if (j !== idx && videos[j]) {
          videos[j].pause();
          // 다른 타겟 엔티티의 비디오 숨김
          const otherEl = targetEls[j];
          if (otherEl) {
            const otherVideo = otherEl.querySelector('a-video');
            if (otherVideo) otherVideo.setAttribute('visible', 'false');
          }
        }
      }

      // 현재 타겟 비디오 표시
      const currentVideoEl = el.querySelector('a-video');
      if (currentVideoEl) currentVideoEl.setAttribute('visible', 'true');

      // 비디오 재생 (처음에는 muted로 시작, 사용자 인터랙션 후 unmute)
      const video = videos[idx];
      if (video) {
        if (!audioUnlocked) {
          video.muted = true;
          unmuteOverlay.classList.remove('hidden');
        }
        video.play().catch(err => console.log(`[Video ${idx}] Autoplay blocked:`, err));
      }
    });

    el.addEventListener('targetLost', () => {
      console.log(`[Target ${idx}] Lost`);
      targets[idx].isTracking = false;
      // 잃은 타겟의 비디오 정지
      if (videos[idx]) videos[idx].pause();
    });
  });

  // ==========================================
  // 매 프레임: 타겟별 적응형 필터 적용
  // ==========================================
  sceneEl.addEventListener('renderstart', () => {
    const tick = () => {
      const now = Date.now();
      let anyTracking = false;

      for (let i = 0; i < NUM_TARGETS; i++) {
        const t = targets[i];
        if (!t.el) continue;

        const obj = t.el.object3D;

        if (t.isTracking) {
          anyTracking = true;
          t.lastTrackingTime = now;

          const fp = t.posFilter.update(obj.position.x, obj.position.y, obj.position.z);
          const fr = t.rotFilter.update(obj.rotation.x, obj.rotation.y, obj.rotation.z);
          obj.position.set(fp.x, fp.y, fp.z);
          obj.rotation.set(fr.x, fr.y, fr.z);

        } else if (now - t.lastTrackingTime < TRACKING_LOSS_GRACE && t.initialized) {
          anyTracking = true;
          const lp = t.posFilter.last();
          const lr = t.rotFilter.last();
          obj.position.set(lp.x, lp.y, lp.z);
          obj.rotation.set(lr.x, lr.y, lr.z);

        } else if (now - t.lastTrackingTime >= TRACKING_LOSS_GRACE && !t.isTracking) {
          // 이 타겟은 완전히 잃음
        }
      }

      // 모든 타겟이 잃어졌을 때만 스캔 가이드 표시
      if (!anyTracking) {
        const allLost = targets.every(t =>
          !t.isTracking && (Date.now() - t.lastTrackingTime >= TRACKING_LOSS_GRACE || !t.initialized)
        );
        if (allLost) {
          scanGuideEl.classList.remove('hidden');
        }
      }

      requestAnimationFrame(tick);
    };
    tick();
  });
});
