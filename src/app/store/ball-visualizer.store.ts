import { signalStore, withState, withMethods, withComputed, patchState } from '@ngrx/signals';
import { computed } from '@angular/core';

export interface BallVisualizerState {
  modelFileName: string | null;
  modelFileSize: number | null;
  textureFileName: string | null;
  textureFileSize: number | null;
  tiltAngle: number; // in degrees (-90 to 90)
  rotationSpeed: number; // 0 to 0.2
  autoRotate: boolean;
  metallic: number; // 0 to 1
  roughness: number; // 0 to 1
  wireframe: boolean;
  invertY: boolean; // default true matching methods.js
  textureAngle: number; // 0, 90, 180, 270 degrees
  uScale: number;
  vScale: number;
  stadiumBgEnabled: boolean;
  exportFormat: 'mp4' | 'webm';
  isLoading: boolean;
  isRecording: boolean;
  recordingProgress: number; // 0 to 100
  statusMessage: string;
  isModelLoaded: boolean;
  isTextureLoaded: boolean;
}

const initialState: BallVisualizerState = {
  modelFileName: null,
  modelFileSize: null,
  textureFileName: null,
  textureFileSize: null,
  tiltAngle: 0,
  rotationSpeed: 0.02,
  autoRotate: true,
  metallic: 0,
  roughness: 0.22,
  wireframe: false,
  invertY: true,
  textureAngle: 0,
  uScale: 1,
  vScale: 1,
  stadiumBgEnabled: true,
  exportFormat: 'mp4',
  isLoading: false,
  isRecording: false,
  recordingProgress: 0,
  statusMessage: 'Ready. Drop an OBJ 3D Ball model and Face Filter texture.',
  isModelLoaded: false,
  isTextureLoaded: false,
};

export const BallVisualizerStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),
  withComputed((store) => ({
    formattedTilt: computed(() => `${Math.round(store.tiltAngle())}°`),
    formattedSpeed: computed(() => store.rotationSpeed().toFixed(3)),
    hasModel: computed(() => store.isModelLoaded()),
    hasTexture: computed(() => store.isTextureLoaded()),
    formattedModelSize: computed(() => {
      const bytes = store.modelFileSize();
      if (!bytes) return '';
      if (bytes < 1024) return `${bytes} B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }),
    formattedTextureSize: computed(() => {
      const bytes = store.textureFileSize();
      if (!bytes) return '';
      if (bytes < 1024) return `${bytes} B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }),
  })),
  withMethods((store) => ({
    setModelInfo(fileName: string, fileSize: number) {
      patchState(store, {
        modelFileName: fileName,
        modelFileSize: fileSize,
        isModelLoaded: true,
        isLoading: false,
        statusMessage: `Model '${fileName}' loaded successfully.`,
      });
    },
    setTextureInfo(fileName: string, fileSize: number) {
      patchState(store, {
        textureFileName: fileName,
        textureFileSize: fileSize,
        isTextureLoaded: true,
        isLoading: false,
        statusMessage: `Texture '${fileName}' applied to ball model.`,
      });
    },
    setTilt(tiltAngle: number) {
      patchState(store, { tiltAngle });
    },
    setSpeed(rotationSpeed: number) {
      patchState(store, { rotationSpeed });
    },
    setAutoRotate(autoRotate: boolean) {
      patchState(store, { autoRotate });
    },
    setMetallic(metallic: number) {
      patchState(store, { metallic });
    },
    setRoughness(roughness: number) {
      patchState(store, { roughness });
    },
    setWireframe(wireframe: boolean) {
      patchState(store, { wireframe });
    },
    setInvertY(invertY: boolean) {
      patchState(store, { invertY });
    },
    setTextureAngle(textureAngle: number) {
      patchState(store, { textureAngle });
    },
    setUVScale(uScale: number, vScale: number) {
      patchState(store, { uScale, vScale });
    },
    setStadiumBgEnabled(stadiumBgEnabled: boolean) {
      patchState(store, { stadiumBgEnabled });
    },
    setExportFormat(exportFormat: 'mp4' | 'webm') {
      patchState(store, { exportFormat });
    },
    setIsRecording(isRecording: boolean, recordingProgress = 0) {
      patchState(store, {
        isRecording,
        recordingProgress,
        statusMessage: isRecording
          ? `Encoding 360° Video... ${recordingProgress}%`
          : '360° Video export completed.',
      });
    },
    setRecordingProgress(recordingProgress: number) {
      patchState(store, {
        recordingProgress,
        statusMessage: `Encoding 360° Video... ${recordingProgress}%`,
      });
    },
    setLoading(isLoading: boolean, statusMessage?: string) {
      patchState(store, {
        isLoading,
        ...(statusMessage ? { statusMessage } : {}),
      });
    },
    setStatus(statusMessage: string) {
      patchState(store, { statusMessage });
    },
    resetState() {
      patchState(store, initialState);
    },
  }))
);
