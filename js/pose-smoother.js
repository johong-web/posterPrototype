/**
 * 6-DOF 포즈 스무딩 (적응형 칼만 필터)
 * 기존 mindar-tuned.js의 AdaptiveKalman1D 패턴 확장
 */

// 적응형 1D 칼만 필터 (속도 기반 Q 조절)
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
    // 큰 변화 = 실제 움직임 → Q 증가 (반응성 ↑)
    // 작은 변화 = 노이즈 → Q 감소 (안정성 ↑)
    const adaptiveQ = this.baseQ + (this.maxQ - this.baseQ) * Math.min(diff * 5, 1);

    const pPred = this.P + adaptiveQ;
    const K = pPred / (pPred + this.R);
    this.prevX = this.x;
    this.x = this.x + K * (z - this.x);
    this.P = (1 - K) * pPred;
    this.velocity = this.x - this.prevX;
    return this.x;
  }

  reset(v) {
    this.x = v;
    this.prevX = v;
    this.P = 1;
    this.velocity = 0;
  }
}

// 6-DOF 포즈 스무더 (position 3 + rotation 3)
class PoseSmoother6DOF {
  constructor(opts) {
    opts = opts || {};
    const posBaseQ = opts.posBaseQ || 0.00001;
    const posR = opts.posR || 0.015;
    const posMaxQ = opts.posMaxQ || 0.005;
    const rotBaseQ = opts.rotBaseQ || 0.0001;
    const rotR = opts.rotR || 0.02;
    const rotMaxQ = opts.rotMaxQ || 0.01;

    this.posOutlierThreshold = opts.posOutlierThreshold || 50;
    this.rotOutlierThreshold = opts.rotOutlierThreshold || 0.3;

    // Position XYZ 필터
    this.posFilters = [
      new AdaptiveKalman1D(posBaseQ, posR, posMaxQ),
      new AdaptiveKalman1D(posBaseQ, posR, posMaxQ),
      new AdaptiveKalman1D(posBaseQ, posR, posMaxQ)
    ];

    // Rotation XYZ 필터 (Euler angles)
    this.rotFilters = [
      new AdaptiveKalman1D(rotBaseQ, rotR, rotMaxQ),
      new AdaptiveKalman1D(rotBaseQ, rotR, rotMaxQ),
      new AdaptiveKalman1D(rotBaseQ, rotR, rotMaxQ)
    ];

    this.frameCount = 0;
    this.initialized = false;
  }

  update(pose) {
    const { position, rotation } = pose;
    this.frameCount++;

    if (!this.initialized) {
      this.reset(pose);
      this.initialized = true;
      return pose;
    }

    // 이상치 제거 (position)
    if (this.frameCount > 10) {
      const dpx = Math.abs(position.x - this.posFilters[0].x);
      const dpy = Math.abs(position.y - this.posFilters[1].x);
      const dpz = Math.abs(position.z - this.posFilters[2].x);
      const posDist = Math.sqrt(dpx * dpx + dpy * dpy + dpz * dpz);

      if (posDist > this.posOutlierThreshold) {
        return this.last();
      }

      // 이상치 제거 (rotation)
      const drx = Math.abs(rotation.x - this.rotFilters[0].x);
      const dry = Math.abs(rotation.y - this.rotFilters[1].x);
      const drz = Math.abs(rotation.z - this.rotFilters[2].x);
      const rotDist = Math.sqrt(drx * drx + dry * dry + drz * drz);

      if (rotDist > this.rotOutlierThreshold) {
        return this.last();
      }
    }

    return {
      position: {
        x: this.posFilters[0].update(position.x),
        y: this.posFilters[1].update(position.y),
        z: this.posFilters[2].update(position.z)
      },
      rotation: {
        x: this.rotFilters[0].update(rotation.x),
        y: this.rotFilters[1].update(rotation.y),
        z: this.rotFilters[2].update(rotation.z)
      }
    };
  }

  reset(pose) {
    this.posFilters[0].reset(pose.position.x);
    this.posFilters[1].reset(pose.position.y);
    this.posFilters[2].reset(pose.position.z);
    this.rotFilters[0].reset(pose.rotation.x);
    this.rotFilters[1].reset(pose.rotation.y);
    this.rotFilters[2].reset(pose.rotation.z);
    this.frameCount = 0;
  }

  last() {
    return {
      position: {
        x: this.posFilters[0].x,
        y: this.posFilters[1].x,
        z: this.posFilters[2].x
      },
      rotation: {
        x: this.rotFilters[0].x,
        y: this.rotFilters[1].x,
        z: this.rotFilters[2].x
      }
    };
  }
}
