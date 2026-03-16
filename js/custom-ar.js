/**
 * 커스텀 6-DOF AR 메인 컨트롤러 v3
 * 카메라 + OpenCV Detect-Then-Track + Canvas 2D 렌더링
 * Optical Flow 추적 = 프레임간 안정성, 경량 EMA = 미세 떨림 제거
 */

let cvReady = false;
function onOpenCvReady() {
  console.log('[CustomAR] OpenCV.js loaded');
  cvReady = true;
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    startAR();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  if (cvReady) startAR();
});

async function startAR() {
  if (startAR._started) return;
  startAR._started = true;

  const loadingEl = document.getElementById('loading');
  const loadingText = document.getElementById('loading-text');
  const loadingHint = document.getElementById('loading-hint');
  const scanGuideEl = document.getElementById('scan-guide');
  const cameraVideo = document.getElementById('camera-feed');
  const arCanvas = document.getElementById('ar-canvas');
  const cvCanvas = document.getElementById('cv-canvas');
  const posterVideo = document.getElementById('poster-video');
  const debugEl = document.getElementById('debug-info');

  let showDebug = true;

  // 성능 통계
  const stats = {
    totalFrames: 0,
    detectFrames: 0,
    trackFrames: 0,
    failFrames: 0,
    lastFps: 0,
    fpsFrames: 0,
    fpsStart: performance.now(),
    avgDetectMs: 0,
    avgTrackMs: 0,
    detectMsSum: 0,
    trackMsSum: 0,
    logLines: [],
    maxLogLines: 8
  };

  function addLog(msg) {
    const ts = ((performance.now() / 1000) % 1000).toFixed(1);
    stats.logLines.push(`[${ts}s] ${msg}`);
    if (stats.logLines.length > stats.maxLogLines) stats.logLines.shift();
  }

  function debug(text) {
    if (!debugEl || !showDebug) return;

    // FPS 계산
    stats.fpsFrames++;
    const now = performance.now();
    if (now - stats.fpsStart >= 1000) {
      stats.lastFps = stats.fpsFrames;
      stats.fpsFrames = 0;
      stats.fpsStart = now;
    }

    const avgD = stats.detectFrames > 0 ? (stats.detectMsSum / stats.detectFrames).toFixed(0) : '-';
    const avgT = stats.trackFrames > 0 ? (stats.trackMsSum / stats.trackFrames).toFixed(0) : '-';

    const header =
      `FPS: ${stats.lastFps} | Total: ${stats.totalFrames}\n` +
      `Detect: ${stats.detectFrames} (avg ${avgD}ms) | Track: ${stats.trackFrames} (avg ${avgT}ms) | Fail: ${stats.failFrames}\n` +
      `---\n`;

    const logSection = stats.logLines.join('\n');

    // tracker 내부 로그도 표시 (최근 5개)
    let trackerLog = '';
    if (typeof tracker !== 'undefined' && tracker.getLog) {
      const tl = tracker.getLog();
      trackerLog = '\n--- tracker ---\n' + tl.slice(-5).join('\n');
    }

    debugEl.textContent = header + text + '\n---\n' + logSection + trackerLog;
  }

  // OpenCV.js 대기
  if (typeof cv === 'undefined' || !cv.Mat) {
    loadingHint.textContent = 'OpenCV.js 초기화 대기 중...';
    await new Promise((resolve) => {
      const check = () => {
        if (typeof cv !== 'undefined' && cv.Mat) resolve();
        else setTimeout(check, 100);
      };
      check();
    });
  }

  console.log('[CustomAR] OpenCV ready');
  loadingText.textContent = '카메라 연결 중...';
  loadingHint.textContent = '카메라 권한을 허용해주세요';

  // ==========================================
  // 1. 카메라 시작
  // ==========================================
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'environment',
        width: { ideal: 640 },
        height: { ideal: 480 }
      },
      audio: false
    });
  } catch (err) {
    loadingText.textContent = '카메라를 사용할 수 없습니다';
    loadingHint.textContent = err.message || '카메라 권한을 확인해주세요';
    return;
  }

  cameraVideo.srcObject = stream;
  await cameraVideo.play();

  const camW = cameraVideo.videoWidth;
  const camH = cameraVideo.videoHeight;
  console.log(`[CustomAR] Camera: ${camW}x${camH}`);

  cvCanvas.width = camW;
  cvCanvas.height = camH;
  const cvCtx = cvCanvas.getContext('2d', { willReadFrequently: true });

  const screenW = window.innerWidth;
  const screenH = window.innerHeight;
  arCanvas.width = screenW;
  arCanvas.height = screenH;
  const arCtx = arCanvas.getContext('2d');

  // 카메라→화면 스케일 (cover 모드)
  const scaleX = screenW / camW;
  const scaleY = screenH / camH;
  const coverScale = Math.max(scaleX, scaleY);
  const offsetX = (screenW - camW * coverScale) / 2;
  const offsetY = (screenH - camH * coverScale) / 2;

  function camToScreen(cx, cy) {
    return {
      x: cx * coverScale + offsetX,
      y: cy * coverScale + offsetY
    };
  }

  // ==========================================
  // 2. 트래커 초기화
  // ==========================================
  loadingText.textContent = '포스터 특징점 추출 중...';
  loadingHint.textContent = '잠시만 기다려주세요';

  const tracker = new CVTracker();
  try {
    await tracker.init('assets/poster/poster.jpg');
  } catch (err) {
    loadingText.textContent = '포스터 이미지 로드 실패';
    loadingHint.textContent = err.message;
    return;
  }

  // ==========================================
  // 3. 비디오 준비
  // ==========================================
  const vidCanvas = document.createElement('canvas');
  const vidCtx = vidCanvas.getContext('2d');
  await new Promise((resolve) => {
    if (posterVideo.readyState >= 1) { resolve(); return; }
    posterVideo.addEventListener('loadedmetadata', resolve, { once: true });
    posterVideo.load();
  });
  vidCanvas.width = posterVideo.videoWidth || 640;
  vidCanvas.height = posterVideo.videoHeight || 480;

  // ==========================================
  // 4. 코너 스무딩 비활성화 (Optical Flow가 이미 부드러움)
  // ==========================================
  function emaSmooth(newCorners) {
    // Optical Flow 추적은 본질적으로 연속적이므로 추가 스무딩 없이 직접 사용
    return newCorners.map(c => ({ x: c.x, y: c.y }));
  }

  // ==========================================
  // 5. 로딩 완료
  // ==========================================
  loadingEl.classList.add('hidden');
  scanGuideEl.classList.remove('hidden');

  // ==========================================
  // 6. 렌더 루프
  // ==========================================
  let lastDetectTime = 0;
  let isTracking = false;
  const TRACKING_LOSS_TIMEOUT = 1500;
  let consecutiveLoss = 0;
  const LOSS_THRESHOLD = 15;  // Optical Flow는 더 빈번한 추적이므로 여유
  let lastCorners = null;

  function renderLoop() {
    requestAnimationFrame(renderLoop);

    arCtx.clearRect(0, 0, screenW, screenH);

    // 매 프레임 트래킹 (Optical Flow는 빠르므로 스킵 불필요)
    cvCtx.drawImage(cameraVideo, 0, 0, camW, camH);

    stats.totalFrames++;

    const t0 = performance.now();
    const result = tracker.processFrame(cvCanvas);
    const dt = performance.now() - t0;

    if (result && result.corners) {
      consecutiveLoss = 0;
      lastDetectTime = Date.now();

      // 통계 수집
      if (result.mode === 'detect') {
        stats.detectFrames++;
        stats.detectMsSum += dt;
        addLog(`DETECT ok: ${result.matchCount} matches, ${result.inlierCount} inliers, ${dt.toFixed(0)}ms`);
      } else {
        stats.trackFrames++;
        stats.trackMsSum += dt;
      }

      if (!isTracking) {
        isTracking = true;
        scanGuideEl.classList.add('hidden');
        posterVideo.play().catch(() => {});

        addLog('TRACKING START');
      }

      // 카메라→화면 변환 + EMA 스무딩
      const screenCorners = result.corners.map(c => camToScreen(c.x, c.y));
      lastCorners = emaSmooth(screenCorners);

      drawOverlay(lastCorners);

      const modeLabel = result.mode === 'track' ? 'OptFlow' : 'ORB';
      debug(
        `[${modeLabel}] Pts: ${result.matchCount} | Inlier: ${result.inlierCount} | ${dt.toFixed(0)}ms\n` +
        `TL:(${lastCorners[0].x.toFixed(0)},${lastCorners[0].y.toFixed(0)}) ` +
        `TR:(${lastCorners[1].x.toFixed(0)},${lastCorners[1].y.toFixed(0)})\n` +
        `BL:(${lastCorners[3].x.toFixed(0)},${lastCorners[3].y.toFixed(0)}) ` +
        `BR:(${lastCorners[2].x.toFixed(0)},${lastCorners[2].y.toFixed(0)})`
      );
    } else {
      stats.failFrames++;
      consecutiveLoss++;

      if (consecutiveLoss === 1) {
        addLog(`FAIL: ${dt.toFixed(0)}ms`);
      }
      if (consecutiveLoss % 10 === 0) {
        addLog(`FAIL streak: ${consecutiveLoss}, ${dt.toFixed(0)}ms`);
      }

      if (isTracking && lastCorners && consecutiveLoss <= LOSS_THRESHOLD) {
        drawOverlay(lastCorners);
      } else if (consecutiveLoss > LOSS_THRESHOLD) {
        if (isTracking && Date.now() - lastDetectTime > TRACKING_LOSS_TIMEOUT) {
          isTracking = false;
          lastCorners = null;
  
          tracker.resetTracking();
          scanGuideEl.classList.remove('hidden');
          addLog('TRACKING LOST');
        }
      }
      debug(`Searching... loss=${consecutiveLoss} | ${dt.toFixed(0)}ms`);
    }
  }

  /**
   * 디버그 오버레이: 외곽선 + 코너 점
   */
  function drawOverlay(corners) {
    // 외곽선
    arCtx.strokeStyle = 'lime';
    arCtx.lineWidth = 3;
    arCtx.beginPath();
    arCtx.moveTo(corners[0].x, corners[0].y);
    arCtx.lineTo(corners[1].x, corners[1].y);
    arCtx.lineTo(corners[2].x, corners[2].y);
    arCtx.lineTo(corners[3].x, corners[3].y);
    arCtx.closePath();
    arCtx.stroke();

    // 코너 점
    const colors = ['red', 'green', 'blue', 'yellow'];
    const labels = ['TL', 'TR', 'BR', 'BL'];
    for (let i = 0; i < 4; i++) {
      arCtx.fillStyle = colors[i];
      arCtx.beginPath();
      arCtx.arc(corners[i].x, corners[i].y, 6, 0, Math.PI * 2);
      arCtx.fill();
      arCtx.fillStyle = 'white';
      arCtx.font = '11px monospace';
      arCtx.fillText(labels[i], corners[i].x + 10, corners[i].y + 4);
    }

    // 대각선
    arCtx.strokeStyle = 'rgba(0,255,0,0.2)';
    arCtx.lineWidth = 1;
    arCtx.beginPath();
    arCtx.moveTo(corners[0].x, corners[0].y);
    arCtx.lineTo(corners[2].x, corners[2].y);
    arCtx.moveTo(corners[1].x, corners[1].y);
    arCtx.lineTo(corners[3].x, corners[3].y);
    arCtx.stroke();
  }

  renderLoop();

  // 터치시 비디오 재생
  document.body.addEventListener('click', () => {
    if (posterVideo.paused) posterVideo.play().catch(() => {});
  }, { once: true });

  // 리사이즈
  window.addEventListener('resize', () => {
    arCanvas.width = window.innerWidth;
    arCanvas.height = window.innerHeight;
  });
}
