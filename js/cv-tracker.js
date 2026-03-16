/**
 * OpenCV.js 기반 이미지 트래커 v3
 * Detect-Then-Track 파이프라인:
 *   - 탐지(Detection): ORB 매칭 → Homography → 코너 추출
 *   - 추적(Tracking): Lucas-Kanade Optical Flow로 프레임 간 포인트 추적
 *   - 재탐지: 추적 품질 저하시 ORB로 리셋
 */

class CVTracker {
  constructor() {
    this.ready = false;
    this.refKeypoints = null;
    this.refDescriptors = null;
    this.refWidth = 0;
    this.refHeight = 0;
    this.orb = null;
    this.matcher = null;

    // 프레임 재사용 버퍼
    this._frameMat = null;
    this._grayMat = null;
    this._prevGray = null;
    this._clahe = null;

    // Optical Flow 추적 상태
    this._tracking = false;
    this._trackPoints = null;
    this._trackRefPts = null;
    this._lastCorners = null;
    this._trackFrameCount = 0;
    this._maxTrackFrames = 60;
    this._redetectInterval = 90; // ~1.5초마다 추적 포인트 갱신
    this._minTrackPoints = 8;

    // 품질 체크용
    this._prevCorners = null;

    // 디버그 로그
    this._log = [];
    this._maxLog = 30;
  }

  /** 내부 디버그 로그 추가 */
  _addLog(msg) {
    this._log.push(msg);
    if (this._log.length > this._maxLog) this._log.shift();
  }

  /** 외부에서 로그 가져가기 */
  getLog() {
    return this._log;
  }

  async init(imageSrc) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          this._initFromImage(img);
          resolve();
        } catch (e) {
          reject(e);
        }
      };
      img.onerror = () => reject(new Error('Failed to load reference image'));
      img.src = imageSrc;
    });
  }

  _initFromImage(img) {
    const canvas = document.createElement('canvas');
    const maxDim = 640;
    let w = img.naturalWidth;
    let h = img.naturalHeight;
    if (Math.max(w, h) > maxDim) {
      const scale = maxDim / Math.max(w, h);
      w = Math.round(w * scale);
      h = Math.round(h * scale);
    }
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);

    this.refWidth = w;
    this.refHeight = h;

    const imgData = ctx.getImageData(0, 0, w, h);
    const refMat = cv.matFromImageData(imgData);
    const refGray = new cv.Mat();
    cv.cvtColor(refMat, refGray, cv.COLOR_RGBA2GRAY);

    // CLAHE
    this._clahe = new cv.CLAHE(2.0, new cv.Size(8, 8));
    const refEnhanced = new cv.Mat();
    this._clahe.apply(refGray, refEnhanced);

    // ORB: 2000개 특징점
    this.orb = new cv.ORB(2000);

    this.refKeypoints = new cv.KeyPointVector();
    this.refDescriptors = new cv.Mat();
    this.orb.detectAndCompute(refEnhanced, new cv.Mat(), this.refKeypoints, this.refDescriptors);

    console.log(`[CVTracker v3] Reference: ${w}x${h}, keypoints: ${this.refKeypoints.size()}`);

    this.matcher = new cv.BFMatcher(cv.NORM_HAMMING, false);

    refMat.delete();
    refGray.delete();
    refEnhanced.delete();
    this.ready = true;
  }

  /**
   * 카메라 프레임 처리 → 코너 + 메타데이터 반환
   */
  processFrame(canvas) {
    if (!this.ready || this.refDescriptors.rows < 10) return null;

    const w = canvas.width;
    const h = canvas.height;

    // Mat 재사용
    if (!this._frameMat || this._frameMat.cols !== w || this._frameMat.rows !== h) {
      if (this._frameMat) this._frameMat.delete();
      if (this._grayMat) this._grayMat.delete();
      if (this._prevGray) this._prevGray.delete();
      this._frameMat = new cv.Mat(h, w, cv.CV_8UC4);
      this._grayMat = new cv.Mat(h, w, cv.CV_8UC1);
      this._prevGray = null;
      this._tracking = false;
    }

    const ctx = canvas.getContext('2d');
    const imgData = ctx.getImageData(0, 0, w, h);
    this._frameMat.data.set(imgData.data);
    cv.cvtColor(this._frameMat, this._grayMat, cv.COLOR_RGBA2GRAY);

    let result = null;

    const isInTrackMode = this._tracking && this._prevGray && this._trackPoints;

    if (isInTrackMode) {
      // ===== 추적 모드 (Optical Flow) =====
      const t1 = performance.now();
      result = this._trackFrame();
      const trackMs = performance.now() - t1;

      if (result) {
        this._trackFrameCount++;
        this._addLog(`FLOW ok: ${result.matchCount}pts ${trackMs.toFixed(1)}ms fc=${this._trackFrameCount}`);
      } else {
        this._addLog(`FLOW FAIL: ${trackMs.toFixed(1)}ms → fallback to ORB`);
      }

      // 재탐지 없음 — Optical Flow가 실패할 때만 ORB로 복구

      // 추적 실패 → 재탐지
      if (!result) {
        this._tracking = false;
        const t3 = performance.now();
        result = this._detectFrame(w, h);
        const detectMs = performance.now() - t3;
        if (result) {
          this._initTrackingPoints(result.corners, result.H, w, h);
          this._addLog(`RECOVER ok: ${result.matchCount}m ${detectMs.toFixed(0)}ms`);
        } else {
          this._addLog(`RECOVER fail: ${detectMs.toFixed(0)}ms`);
        }
      }
    } else {
      // ===== 탐지 모드 (ORB 매칭) =====
      const why = !this._tracking ? 'notTracking' : !this._prevGray ? 'noPrevGray' : 'noTrackPts';
      const t4 = performance.now();
      result = this._detectFrame(w, h);
      const detectMs = performance.now() - t4;
      if (result) {
        this._initTrackingPoints(result.corners, result.H, w, h);
        this._addLog(`DETECT ok(${why}): ${result.matchCount}m ${result.inlierCount}i ${detectMs.toFixed(0)}ms → tracking=${this._tracking}`);
      } else {
        this._addLog(`DETECT fail(${why}): ${detectMs.toFixed(0)}ms`);
      }
    }

    // 현재 그레이 프레임을 다음 프레임용으로 저장
    if (!this._prevGray) {
      this._prevGray = new cv.Mat();
    }
    this._grayMat.copyTo(this._prevGray);

    if (result) {
      // 시간적 일관성 체크 — detect 모드에서만 (Optical Flow는 본질적으로 연속적)
      if (result.mode === 'detect' && this._prevCorners) {
        let maxShift = 0;
        for (let i = 0; i < 4; i++) {
          const dx = result.corners[i].x - this._prevCorners[i].x;
          const dy = result.corners[i].y - this._prevCorners[i].y;
          maxShift = Math.max(maxShift, Math.sqrt(dx * dx + dy * dy));
        }
        if (maxShift > 120) {
          this._addLog(`JUMP rejected(detect): ${maxShift.toFixed(1)}px > 120px`);
          return null;
        }
      }
      this._prevCorners = result.corners;
      return {
        corners: result.corners,
        matchCount: result.matchCount || 0,
        inlierCount: result.inlierCount || 0,
        mode: result.mode
      };
    }

    return null;
  }

  /**
   * ORB 기반 탐지 (느리지만 정확)
   */
  _detectFrame(w, h) {
    // CLAHE 전처리
    const enhanced = new cv.Mat();
    this._clahe.apply(this._grayMat, enhanced);

    const frameKp = new cv.KeyPointVector();
    const frameDesc = new cv.Mat();
    this.orb.detectAndCompute(enhanced, new cv.Mat(), frameKp, frameDesc);
    enhanced.delete();

    if (frameDesc.rows < 10) {
      frameKp.delete();
      frameDesc.delete();
      return null;
    }

    // knnMatch
    const matches = new cv.DMatchVectorVector();
    try {
      this.matcher.knnMatch(this.refDescriptors, frameDesc, matches, 2);
    } catch (e) {
      frameKp.delete();
      frameDesc.delete();
      matches.delete();
      return null;
    }

    // Lowe's Ratio Test (0.7)
    const goodMatches = [];
    for (let i = 0; i < matches.size(); i++) {
      const match = matches.get(i);
      if (match.size() >= 2) {
        const m = match.get(0);
        const n = match.get(1);
        if (m.distance < 0.7 * n.distance) {
          goodMatches.push(m);
        }
      }
    }
    matches.delete();

    if (goodMatches.length < 20) {
      frameKp.delete();
      frameDesc.delete();
      return null;
    }

    // 매칭 포인트 수집
    const srcPts = [];
    const dstPts = [];
    for (const m of goodMatches) {
      const refPt = this.refKeypoints.get(m.queryIdx).pt;
      const frmPt = frameKp.get(m.trainIdx).pt;
      srcPts.push(refPt.x, refPt.y);
      dstPts.push(frmPt.x, frmPt.y);
    }

    // findHomography (RANSAC)
    const srcMat = cv.matFromArray(goodMatches.length, 1, cv.CV_32FC2, srcPts);
    const dstMat = cv.matFromArray(goodMatches.length, 1, cv.CV_32FC2, dstPts);
    const mask = new cv.Mat();
    const H = cv.findHomography(srcMat, dstMat, cv.RANSAC, 3.0, mask);

    srcMat.delete();
    dstMat.delete();
    frameKp.delete();
    frameDesc.delete();

    if (H.empty() || H.rows !== 3 || H.cols !== 3) {
      H.delete();
      mask.delete();
      return null;
    }

    let inlierCount = 0;
    for (let i = 0; i < mask.rows; i++) {
      if (mask.data[i]) inlierCount++;
    }
    mask.delete();

    if (inlierCount < 20) {
      H.delete();
      return null;
    }

    // Homography 품질 체크
    const hData = H.data64F;
    const det = hData[0] * hData[4] - hData[1] * hData[3];
    if (det < 0.1 || det > 10) {
      H.delete();
      return null;
    }

    // 코너 변환
    const corners = this._transformCorners(H, this.refWidth, this.refHeight);

    // 품질 체크들
    if (!this._isConvex(corners)) {
      H.delete();
      return null;
    }

    const area = this._quadArea(corners);
    const frameArea = w * h;
    if (area < frameArea * 0.01 || area > frameArea * 4) {
      H.delete();
      return null;
    }

    const topEdge = Math.sqrt((corners[1].x - corners[0].x) ** 2 + (corners[1].y - corners[0].y) ** 2);
    const leftEdge = Math.sqrt((corners[3].x - corners[0].x) ** 2 + (corners[3].y - corners[0].y) ** 2);
    const detectedRatio = topEdge / leftEdge;
    const expectedRatio = this.refWidth / this.refHeight;
    if (detectedRatio < expectedRatio * 0.4 || detectedRatio > expectedRatio * 2.5) {
      H.delete();
      return null;
    }

    // H를 저장하여 추적 포인트 초기화에 사용
    const result = {
      corners: corners,
      matchCount: goodMatches.length,
      inlierCount: inlierCount,
      mode: 'detect',
      H: H  // 나중에 delete 필요
    };

    return result;
  }

  /**
   * 포스터 내부에 균일한 그리드 포인트를 생성하고
   * Homography로 카메라 좌표로 변환하여 추적 포인트 초기화
   */
  _initTrackingPoints(corners, H, frameW, frameH) {
    // 기존 추적 포인트 해제
    if (this._trackPoints) this._trackPoints.delete();
    if (this._trackRefPts) this._trackRefPts.delete();

    // 포스터 내부에 5x7 그리드 포인트 생성 (레퍼런스 좌표)
    const gridCols = 5;
    const gridRows = 7;
    const refPts = [];
    const camPts = [];
    const hData = H.data64F;

    for (let r = 0; r <= gridRows; r++) {
      for (let c = 0; c <= gridCols; c++) {
        const rx = (c / gridCols) * this.refWidth;
        const ry = (r / gridRows) * this.refHeight;

        // Homography로 카메라 좌표로 변환
        const ww = hData[6] * rx + hData[7] * ry + hData[8];
        const cx = (hData[0] * rx + hData[1] * ry + hData[2]) / ww;
        const cy = (hData[3] * rx + hData[4] * ry + hData[5]) / ww;

        // 프레임 내부에 있는지 체크
        if (cx >= 0 && cx < frameW && cy >= 0 && cy < frameH) {
          refPts.push(rx, ry);
          camPts.push(cx, cy);
        }
      }
    }

    // 4개 코너도 반드시 포함
    const cornerRef = [
      [0, 0], [this.refWidth, 0],
      [this.refWidth, this.refHeight], [0, this.refHeight]
    ];
    for (let i = 0; i < 4; i++) {
      const rx = cornerRef[i][0];
      const ry = cornerRef[i][1];
      const cx = corners[i].x;
      const cy = corners[i].y;
      if (cx >= 0 && cx < frameW && cy >= 0 && cy < frameH) {
        refPts.push(rx, ry);
        camPts.push(cx, cy);
      }
    }

    H.delete(); // H 메모리 해제

    if (camPts.length < this._minTrackPoints * 2) {
      this._tracking = false;
      return;
    }

    const numPts = camPts.length / 2;
    this._trackPoints = cv.matFromArray(numPts, 1, cv.CV_32FC2, camPts);
    this._trackRefPts = cv.matFromArray(numPts, 1, cv.CV_32FC2, refPts);
    this._tracking = true;
    this._trackFrameCount = 0;
  }

  /**
   * Optical Flow 기반 프레임 추적 (빠르고 안정적)
   */
  _trackFrame() {
    if (!this._trackPoints || !this._prevGray) return null;

    const nextPts = new cv.Mat();
    const status = new cv.Mat();
    const err = new cv.Mat();

    // Lucas-Kanade Pyramidal Optical Flow
    const winSize = new cv.Size(21, 21);
    const maxLevel = 3;
    const criteria = new cv.TermCriteria(
      cv.TermCriteria_COUNT + cv.TermCriteria_EPS,
      30, 0.01
    );

    try {
      cv.calcOpticalFlowPyrLK(
        this._prevGray,
        this._grayMat,
        this._trackPoints,
        nextPts,
        status,
        err,
        winSize,
        maxLevel,
        criteria
      );
    } catch (e) {
      nextPts.delete();
      status.delete();
      err.delete();
      this._tracking = false;
      this._addLog(`FLOW exception: ${e.message || e}`);
      return null;
    }

    // 성공적으로 추적된 포인트만 필터링
    const goodRef = [];
    const goodCam = [];
    const statusData = status.data;
    const errData = err.data32F;
    let totalPts = statusData.length;
    let statusOk = 0, errFiltered = 0, oobFiltered = 0;

    for (let i = 0; i < statusData.length; i++) {
      if (statusData[i] === 1) {
        statusOk++;
        // 에러가 너무 큰 포인트 제외
        if (errData && errData[i] > 20) { errFiltered++; continue; }

        const rx = this._trackRefPts.data32F[i * 2];
        const ry = this._trackRefPts.data32F[i * 2 + 1];
        const cx = nextPts.data32F[i * 2];
        const cy = nextPts.data32F[i * 2 + 1];

        // 프레임 밖으로 나간 포인트 제외
        if (cx < 0 || cx >= this._grayMat.cols || cy < 0 || cy >= this._grayMat.rows) { oobFiltered++; continue; }

        goodRef.push(rx, ry);
        goodCam.push(cx, cy);
      }
    }

    status.delete();
    err.delete();

    const numGood = goodCam.length / 2;

    if (numGood < this._minTrackPoints) {
      this._addLog(`FLOW pts low: ${numGood}/${totalPts} (ok=${statusOk} errF=${errFiltered} oob=${oobFiltered})`);
      nextPts.delete();
      this._tracking = false;
      return null;
    }

    // 추적 포인트 갱신
    this._trackPoints.delete();
    this._trackRefPts.delete();
    this._trackPoints = cv.matFromArray(numGood, 1, cv.CV_32FC2, goodCam);
    this._trackRefPts = cv.matFromArray(numGood, 1, cv.CV_32FC2, goodRef);

    nextPts.delete();

    // 추적 포인트로 Homography 계산
    const srcMat = cv.matFromArray(numGood, 1, cv.CV_32FC2, goodRef);
    const dstMat = cv.matFromArray(numGood, 1, cv.CV_32FC2, goodCam);
    const mask = new cv.Mat();
    const H = cv.findHomography(srcMat, dstMat, cv.RANSAC, 3.0, mask);

    srcMat.delete();
    dstMat.delete();

    if (H.empty() || H.rows !== 3 || H.cols !== 3) {
      this._addLog(`FLOW H empty`);
      H.delete();
      mask.delete();
      this._tracking = false;
      return null;
    }

    let inlierCount = 0;
    for (let i = 0; i < mask.rows; i++) {
      if (mask.data[i]) inlierCount++;
    }
    mask.delete();

    if (inlierCount < this._minTrackPoints) {
      this._addLog(`FLOW inlier low: ${inlierCount}/${numGood}`);
      H.delete();
      this._tracking = false;
      return null;
    }

    // Homography 품질 체크
    const hData = H.data64F;
    const det = hData[0] * hData[4] - hData[1] * hData[3];
    if (det < 0.1 || det > 10) {
      this._addLog(`FLOW det bad: ${det.toFixed(3)}`);
      H.delete();
      this._tracking = false;
      return null;
    }

    const corners = this._transformCorners(H, this.refWidth, this.refHeight);
    H.delete();

    if (!this._isConvex(corners)) {
      this._addLog(`FLOW not convex`);
      this._tracking = false;
      return null;
    }

    return {
      corners: corners,
      matchCount: numGood,
      inlierCount: inlierCount,
      mode: 'track'
    };
  }

  /**
   * 포스터 코너를 카메라 프레임 좌표로 변환
   */
  _transformCorners(H, refW, refH) {
    const h = H.data64F;
    const pts = [
      [0, 0], [refW, 0], [refW, refH], [0, refH]
    ];
    const result = [];
    for (const [px, py] of pts) {
      const w = h[6] * px + h[7] * py + h[8];
      const x = (h[0] * px + h[1] * py + h[2]) / w;
      const y = (h[3] * px + h[4] * py + h[5]) / w;
      result.push({ x, y });
    }
    return result;
  }

  _isConvex(c) {
    for (let i = 0; i < 4; i++) {
      const a = c[i];
      const b = c[(i + 1) % 4];
      const d = c[(i + 2) % 4];
      const cross = (b.x - a.x) * (d.y - b.y) - (b.y - a.y) * (d.x - b.x);
      if (cross < 0) return false;
    }
    return true;
  }

  _quadArea(c) {
    return 0.5 * Math.abs(
      (c[0].x * c[1].y - c[1].x * c[0].y) +
      (c[1].x * c[2].y - c[2].x * c[1].y) +
      (c[2].x * c[3].y - c[3].x * c[2].y) +
      (c[3].x * c[0].y - c[0].x * c[3].y)
    );
  }

  resetTracking() {
    this._prevCorners = null;
    this._tracking = false;
    this._trackFrameCount = 0;
    if (this._trackPoints) {
      this._trackPoints.delete();
      this._trackPoints = null;
    }
    if (this._trackRefPts) {
      this._trackRefPts.delete();
      this._trackRefPts = null;
    }
  }

  dispose() {
    if (this.refKeypoints) this.refKeypoints.delete();
    if (this.refDescriptors) this.refDescriptors.delete();
    if (this.orb) this.orb.delete();
    if (this.matcher) this.matcher.delete();
    if (this._frameMat) this._frameMat.delete();
    if (this._grayMat) this._grayMat.delete();
    if (this._prevGray) this._prevGray.delete();
    if (this._clahe) this._clahe.delete();
    if (this._trackPoints) this._trackPoints.delete();
    if (this._trackRefPts) this._trackRefPts.delete();
  }
}
