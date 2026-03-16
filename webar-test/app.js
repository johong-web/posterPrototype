import 'normalize.css';
import {
  WebGLRenderer,
  Scene,
  PerspectiveCamera,
  PlaneGeometry,
  MeshBasicMaterial,
  Mesh,
  VideoTexture,
  LinearFilter,
  DoubleSide,
  Quaternion
} from 'three';
import WAS, {
  ANCHOR_TYPE_CENTER,
  DEVICE_ERROR,
  EVENT_DETECTED,
  EVENT_ERROR,
  EVENT_FRAME,
  EVENT_LOST,
  EVENT_SCREEN_ORIENTATION,
  EVENT_POSE,
  EVENT_PROCESS,
  EVENT_RESIZE,
  EVENT_VISIBILITY,
  GL_ERROR,
  HTML_ERROR,
  PROJECT_MODE_IMAGE,
  TRIGGER_MODE_IMAGE,
  VIDEO_ERROR,
  WORKER_ERROR,
  CAMERA_MODE_ENVIRONMENT,
} from '@web-ar-studio/webar-engine-sdk';

// Constants
const CAMERA_FOV = 45;
const CAMERA_NEAR = 1;
const CAMERA_FAR = 100000;
const POSTER_ASPECT = 1702 / 1208; // 세로/가로 비율 = 1.409

const container = document.querySelector('.App');
const triggerSource = new URL('./assets/trigger.jpg', import.meta.url).href;
const videoSource = new URL('./assets/video.mp4', import.meta.url).href;

if (!container) {
  throw new Error('Element not found!');
}

// 로딩 UI 생성
const loadingDiv = document.createElement('div');
loadingDiv.id = 'loading-overlay';
loadingDiv.innerHTML = `
  <div style="text-align:center;color:white;">
    <div style="width:50px;height:50px;border:4px solid rgba(255,255,255,0.3);border-top-color:white;border-radius:50%;animation:spin 1s linear infinite;margin:0 auto 20px;"></div>
    <p id="loading-text">AR 로딩 중...</p>
    <p id="loading-hint" style="font-size:14px;color:rgba(255,255,255,0.6);">카메라 권한을 허용해주세요</p>
    <p id="debug-log" style="font-size:11px;color:rgba(255,255,255,0.4);margin-top:20px;max-width:300px;word-break:break-all;"></p>
  </div>
`;
loadingDiv.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.95);display:flex;justify-content:center;align-items:center;z-index:9999;transition:opacity 0.5s ease;';
document.body.appendChild(loadingDiv);

// 스캔 가이드 UI
const guideDiv = document.createElement('div');
guideDiv.id = 'scan-guide';
guideDiv.innerHTML = '<div style="background:rgba(0,0,0,0.7);color:white;padding:12px 24px;border-radius:25px;font-size:14px;backdrop-filter:blur(10px);">포스터를 카메라에 비춰주세요</div>';
guideDiv.style.cssText = 'position:fixed;bottom:30px;left:50%;transform:translateX(-50%);z-index:1000;pointer-events:none;display:none;';
document.body.appendChild(guideDiv);

// spin 애니메이션
const styleEl = document.createElement('style');
styleEl.textContent = '@keyframes spin{to{transform:rotate(360deg)}}';
document.head.appendChild(styleEl);

// 비디오 엘리먼트 생성
const videoEl = document.createElement('video');
videoEl.src = videoSource;
videoEl.crossOrigin = 'anonymous';
videoEl.loop = true;
videoEl.muted = true;
videoEl.playsInline = true;
videoEl.setAttribute('webkit-playsinline', '');
videoEl.preload = 'auto';
videoEl.style.display = 'none';
document.body.appendChild(videoEl);

// 화면 디버그 로그
function debugLog(msg) {
  console.log('[DEBUG]', msg);
  const el = document.getElementById('debug-log');
  if (el) el.textContent += msg + '\n';
}

// Web-AR.Studio SDK 초기화
debugLog('SDK 초기화 시작');
debugLog('API Key: ' + (import.meta.env.VITE_API_KEY ? '설정됨' : '없음'));
debugLog('트리거: ' + triggerSource.slice(-20));

const was = new WAS();

const configData = {
  apiKey: import.meta.env.VITE_API_KEY,
  mode: PROJECT_MODE_IMAGE,
  cameraMode: CAMERA_MODE_ENVIRONMENT,
  container: container,
  fov: CAMERA_FOV,
  triggers: [{ id: 1, mode: TRIGGER_MODE_IMAGE, source: triggerSource }],
  isMultiTracking: false,
  anchor: ANCHOR_TYPE_CENTER,
};

debugLog('container: ' + container.clientWidth + 'x' + container.clientHeight);
debugLog('was.init() 호출...');

// 15초 타임아웃
const initTimeout = setTimeout(() => {
  debugLog('TIMEOUT: init 15초 초과');
  document.getElementById('loading-text').textContent = 'SDK 초기화 타임아웃';
  document.getElementById('loading-hint').textContent = '페이지를 새로고침 해주세요';
}, 15000);

was
  .init(configData)
  .then(({ canvas, context, viewportSizes }) => {
    clearTimeout(initTimeout);
    debugLog('init 성공! canvas:' + !!canvas);

    // 에러 이벤트는 init 이후에 등록
    was.on(EVENT_ERROR, (error) => {
      debugLog('EVENT_ERROR: ' + JSON.stringify(error));
      errorHandler(error);
    }).catch(() => {});
    let videoMesh = null;
    let videoTexture = null;

    // Three.js 렌더러
    const renderer = new WebGLRenderer({
      canvas: canvas,
      context: context || undefined,
      antialias: true,
      alpha: true,
    });

    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setViewport(
      -(viewportSizes.width / 2 - container.clientWidth / 2),
      -(viewportSizes.height / 2 - container.clientHeight / 2),
      viewportSizes.width,
      viewportSizes.height,
    );
    renderer.setClearColor(0xffffff, 0);
    renderer.clearColor();

    const scene = new Scene();
    const camera = new PerspectiveCamera(
      CAMERA_FOV,
      viewportSizes.width / viewportSizes.height,
      CAMERA_NEAR,
      CAMERA_FAR,
    );

    const applySdkCamera = (data) => {
      if (data.projectionMatrix && data.projectionMatrix.length === 16) {
        camera.projectionMatrix.fromArray(data.projectionMatrix);
        camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
        return;
      }
      const params = data.cameraParams;
      if (!params) return;
      const { fx, fy, cx, cy, width, height } = params;
      if (!(fx > 0 && fy > 0 && width > 0 && height > 0)) return;
      const near = camera.near;
      const far = camera.far;
      const left = (-cx * near) / fx;
      const right = ((width - cx) * near) / fx;
      const top = (cy * near) / fy;
      const bottom = (-(height - cy) * near) / fy;
      camera.projectionMatrix.makePerspective(left, right, top, bottom, near, far);
      camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    };

    scene.add(camera);

    // 비디오 텍스처 + 메시 생성
    videoTexture = new VideoTexture(videoEl);
    videoTexture.minFilter = LinearFilter;
    videoTexture.magFilter = LinearFilter;

    // 비디오 plane (포스터 비율에 맞춤)
    const planeWidth = 200;  // SDK 단위에 맞춤 (나중에 조정 가능)
    const planeHeight = planeWidth * POSTER_ASPECT;
    const geometry = new PlaneGeometry(planeWidth, planeHeight);
    const material = new MeshBasicMaterial({
      map: videoTexture,
      side: DoubleSide,
      transparent: false,
    });
    videoMesh = new Mesh(geometry, material);
    videoMesh.visible = false;
    scene.add(videoMesh);

    // 로딩 완료 → UI 전환
    loadingDiv.style.opacity = '0';
    setTimeout(() => { loadingDiv.style.display = 'none'; }, 500);
    guideDiv.style.display = 'block';

    debugLog('렌더러+비디오 메시 준비 완료');

    // 이미지 감지 이벤트
    was.on(EVENT_DETECTED, (detectedData) => {
      for (const data of detectedData) {
        applySdkCamera(data);
        if (videoMesh) {
          videoMesh.visible = true;
          videoMesh.position.set(
            data.positionVector.x,
            data.positionVector.y,
            data.positionVector.z,
          );
          videoMesh.rotation.setFromQuaternion(
            new Quaternion(
              data.rotationQuaternion.x,
              data.rotationQuaternion.y,
              data.rotationQuaternion.z,
              data.rotationQuaternion.w,
            )
          );
        }
        guideDiv.style.display = 'none';
        videoEl.play().catch(err => console.log('Autoplay blocked:', err));
      }
    }).catch(errorHandler);

    // 이미지 로스트 이벤트
    was.on(EVENT_LOST, (lostData) => {
      for (const data of lostData) {
        if (videoMesh) {
          videoMesh.visible = false;
        }
      }
      guideDiv.style.display = 'block';
    }).catch(errorHandler);

    // 포즈 업데이트 (트래킹 중 매 프레임)
    was.on(EVENT_POSE, (poseData) => {
      for (const data of poseData) {
        applySdkCamera(data);
        if (videoMesh) {
          videoMesh.position.set(
            data.positionVector.x,
            data.positionVector.y,
            data.positionVector.z,
          );
          videoMesh.rotation.setFromQuaternion(
            new Quaternion(
              data.rotationQuaternion.x,
              data.rotationQuaternion.y,
              data.rotationQuaternion.z,
              data.rotationQuaternion.w,
            )
          );
        }
      }
    }).catch(errorHandler);

    // 프레임 렌더링
    was.on(EVENT_FRAME, (deltaTime) => {
      if (videoTexture && !videoEl.paused) {
        videoTexture.needsUpdate = true;
      }
      renderer.render(scene, camera);
    }).catch(errorHandler);

    // 리사이즈
    was.on(EVENT_RESIZE, () => {
      const vp = was.getViewportSizes();
      renderer.setSize(container.clientWidth, container.clientHeight);
      renderer.setViewport(
        -(vp.width / 2 - container.clientWidth / 2),
        -(vp.height / 2 - container.clientHeight / 2),
        vp.width,
        vp.height,
      );
      camera.aspect = vp.width / vp.height;
      camera.updateProjectionMatrix();
    }).catch(errorHandler);

    was.on(EVENT_SCREEN_ORIENTATION, () => {}).catch(errorHandler);
    was.on(EVENT_VISIBILITY, () => {}).catch(errorHandler);
    was.on(EVENT_PROCESS, () => {}).catch(errorHandler);
  })
  .catch((err) => {
    clearTimeout(initTimeout);
    debugLog('init CATCH: ' + (err.message || err.name || JSON.stringify(err)));
    errorHandler(err);
  });

// 터치로 비디오 재생 (autoplay 정책)
document.body.addEventListener('click', () => {
  if (videoEl && videoEl.paused) {
    videoEl.muted = false;
    videoEl.play().catch(() => {});
  }
}, { once: true });

function errorHandler(error) {
  debugLog('ERROR: ' + (error.message || error.name || JSON.stringify(error)));
  const loadingText = document.getElementById('loading-text');
  if (loadingText) {
    loadingText.textContent = 'AR 오류: ' + (error.message || error.name || '알 수 없는 오류');
  }
  switch (error.name) {
    case DEVICE_ERROR:
      console.error('Device error - DevTools에서 모바일 디바이스를 선택하세요');
      break;
    case VIDEO_ERROR:
      console.error('Camera access denied');
      break;
    case GL_ERROR:
      console.error('WebGL error');
      break;
    case WORKER_ERROR:
      console.error('Worker error');
      break;
    default:
      break;
  }
}
