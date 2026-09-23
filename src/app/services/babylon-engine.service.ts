import { Injectable, NgZone, OnDestroy } from '@angular/core';
import {
  Engine,
  Scene,
  ArcRotateCamera,
  Vector3,
  HemisphericLight,
  DirectionalLight,
  TransformNode,
  PBRMetallicRoughnessMaterial,
  Color3,
  Color4,
  Tools,
  Texture,
  Layer,
} from '@babylonjs/core';
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';

@Injectable({
  providedIn: 'root',
})
export class BabylonEngineService implements OnDestroy {
  private engine!: Engine;
  private scene!: Scene;
  private camera!: ArcRotateCamera;
  private mainPivot!: TransformNode;
  private childPivot!: TransformNode;
  private pbrMaterial!: PBRMetallicRoughnessMaterial;
  private backgroundLayer?: Layer;

  private rotationSpeed = 0.02;
  private autoRotate = true;
  private tiltAngleDeg = 0;

  constructor(private ngZone: NgZone) {}

  public initialize(canvas: HTMLCanvasElement): void {
    // Run outside Angular zone to prevent triggering change detection on every frame
    this.ngZone.runOutsideAngular(() => {
      this.engine = new Engine(canvas, true, {
        preserveDrawingBuffer: true,
        stencil: true,
        antialias: true,
      });

      this.scene = new Scene(this.engine);
      this.scene.useRightHandedSystem = true;
      this.scene.clearColor = new Color4(0, 0, 0, 0); // Transparent to show 2D Stadium Background Layer

      // Create high-res Stadium Background Layer inside 3D scene (rendered in WebGL & exported in MP4/screenshots)
      this.backgroundLayer = new Layer('StadiumBackground', 'stadium_bg.jpg', this.scene, true);

      // Camera setup
      this.camera = new ArcRotateCamera(
        'MainCamera',
        Tools.ToRadians(90),
        Tools.ToRadians(65),
        65,
        Vector3.Zero(),
        this.scene
      );
      this.camera.lowerRadiusLimit = 20;
      this.camera.upperRadiusLimit = 150;
      this.camera.wheelPrecision = 20;
      this.camera.attachControl(canvas, true);

      // Lighting setup matching stadium floodlights & environment reflection
      const hemiLight = new HemisphericLight('HemiLight', new Vector3(0, 1, 0), this.scene);
      hemiLight.intensity = 1.0;
      hemiLight.groundColor = new Color3(0.2, 0.25, 0.2);

      const dirLight1 = new DirectionalLight('DirLight1', new Vector3(-1, -2, -1), this.scene);
      dirLight1.position = new Vector3(20, 50, 20);
      dirLight1.intensity = 1.5;

      const dirLight2 = new DirectionalLight('DirLight2', new Vector3(1, 2, 1), this.scene);
      dirLight2.position = new Vector3(-20, -50, -20);
      dirLight2.intensity = 0.8;

      // Create hierarchy transform nodes matching methods.js
      this.mainPivot = new TransformNode('root', this.scene);
      this.childPivot = new TransformNode('root2', this.scene);
      this.childPivot.setParent(this.mainPivot);

      // Create default PBR material matching methods.js
      this.pbrMaterial = new PBRMetallicRoughnessMaterial('pbr', this.scene);
      this.pbrMaterial.metallic = 0;
      this.pbrMaterial.roughness = 0.22;
      this.pbrMaterial.baseColor = new Color3(1, 1, 1); // Pure white base so textures render at full brightness
      this.pbrMaterial.backFaceCulling = false;

      // Register render loop matching methods.js
      this.scene.registerBeforeRender(() => {
        if (this.autoRotate && this.mainPivot) {
          this.mainPivot.addRotation(0, this.rotationSpeed, 0);
        }
      });

      this.engine.runRenderLoop(() => {
        this.scene.render();
      });

      // Window resize listener
      window.addEventListener('resize', this.onResize);
    });
  }

  private onResize = (): void => {
    if (this.engine) {
      this.engine.resize();
    }
  };

  public getScene(): Scene {
    return this.scene;
  }

  public getChildPivot(): TransformNode {
    return this.childPivot;
  }

  public getPBRMaterial(): PBRMetallicRoughnessMaterial {
    return this.pbrMaterial;
  }

  public setTilt(angleDegrees: number): void {
    this.tiltAngleDeg = angleDegrees;
    if (this.childPivot) {
      this.childPivot.rotation.z = Tools.ToRadians(angleDegrees);
    }
  }

  public setRotationSpeed(speed: number): void {
    this.rotationSpeed = speed;
  }

  public setAutoRotate(enabled: boolean): void {
    this.autoRotate = enabled;
  }

  public setMetallic(value: number): void {
    if (this.pbrMaterial) {
      this.pbrMaterial.metallic = value;
    }
  }

  public setRoughness(value: number): void {
    if (this.pbrMaterial) {
      this.pbrMaterial.roughness = value;
    }
  }

  public setWireframe(enabled: boolean): void {
    if (this.pbrMaterial) {
      this.pbrMaterial.wireframe = enabled;
    }
  }

  public setStadiumBgEnabled(enabled: boolean): void {
    if (this.backgroundLayer) {
      this.backgroundLayer.isEnabled = enabled;
    }
  }

  public setTextureInvertY(invertY: boolean): void {
    if (this.pbrMaterial && this.pbrMaterial.baseTexture && this.pbrMaterial.baseTexture instanceof Texture) {
      const tex = this.pbrMaterial.baseTexture;
      if (invertY) {
        tex.vScale = 1;
        tex.vOffset = 0;
      } else {
        tex.vScale = -1;
        tex.vOffset = 1;
      }
    }
  }

  public setTextureAngle(angleDegrees: number): void {
    if (this.pbrMaterial && this.pbrMaterial.baseTexture && this.pbrMaterial.baseTexture instanceof Texture) {
      this.pbrMaterial.baseTexture.wAng = Tools.ToRadians(angleDegrees);
    }
  }

  public setUVScale(uScale: number, vScale: number): void {
    if (this.pbrMaterial && this.pbrMaterial.baseTexture && this.pbrMaterial.baseTexture instanceof Texture) {
      this.pbrMaterial.baseTexture.uScale = uScale;
      this.pbrMaterial.baseTexture.vScale = vScale;
    }
  }

  public resetCamera(): void {
    if (this.camera) {
      this.camera.alpha = Tools.ToRadians(90);
      this.camera.beta = Tools.ToRadians(65);
      this.camera.radius = 65;
      this.camera.setTarget(Vector3.Zero());
    }
  }

  public async captureScreenshot(): Promise<string> {
    return new Promise((resolve, reject) => {
      try {
        Tools.CreateScreenshot(this.engine, this.camera, { precision: 1.5 }, (data) => {
          resolve(data);
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Export smooth 360-degree rotation video in MP4 format (H.264)
   */
  public async record360MP4Video(
    durationSeconds = 6,
    onProgress?: (percent: number) => void
  ): Promise<Blob> {
    const canvas = this.engine.getRenderingCanvas();
    if (!canvas) {
      throw new Error('Canvas element not available for video recording');
    }

    // High performance WebCodecs + MP4-Muxer encoding
    if (typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined') {
      try {
        return await this.record360MP4WebCodecs(canvas, durationSeconds, onProgress);
      } catch (err) {
        console.warn('WebCodecs MP4 encoding failed, falling back to MediaRecorder:', err);
      }
    }

    // MediaRecorder fallback
    return this.record360VideoMediaRecorder(canvas, durationSeconds, 'video/mp4', onProgress);
  }

  /**
   * WebCodecs + mp4-muxer frame-by-frame 60FPS H.264 MP4 Encoder
   */
  private async record360MP4WebCodecs(
    canvas: HTMLCanvasElement,
    durationSeconds: number,
    onProgress?: (percent: number) => void
  ): Promise<Blob> {
    return new Promise(async (resolve, reject) => {
      try {
        const fps = 60;
        const totalFrames = durationSeconds * fps;
        const width = canvas.width % 2 === 0 ? canvas.width : canvas.width - 1;
        const height = canvas.height % 2 === 0 ? canvas.height : canvas.height - 1;

        const target = new ArrayBufferTarget();
        const muxer = new Muxer({
          target,
          video: {
            codec: 'avc',
            width,
            height,
          },
          fastStart: 'in-memory',
        });

        const encoder = new VideoEncoder({
          output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
          error: (e) => reject(e),
        });

        encoder.configure({
          codec: 'avc1.42001f', // H.264 Baseline profile
          width,
          height,
          bitrate: 8_000_000, // 8 Mbps high quality
          framerate: fps,
        });

        const initialMainY = this.mainPivot.rotation.y;
        const initialChildX = this.childPivot.rotation.x;
        const initialChildZ = this.childPivot.rotation.z;
        const initialAutoRotate = this.autoRotate;

        this.autoRotate = false;

        for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
          const progress = frameIndex / (totalFrames - 1);

          // Smooth 360-degree rotation on Y-axis and X-axis tilt wave
          this.mainPivot.rotation.y = progress * Math.PI * 2;
          this.childPivot.rotation.x = Math.sin(progress * Math.PI * 2) * (Math.PI / 4);

          // Force synchronous scene render for exact frame capture
          this.scene.render();

          const timestampUs = Math.round((frameIndex / fps) * 1_000_000);
          const durationUs = Math.round((1 / fps) * 1_000_000);

          const frame = new VideoFrame(canvas, {
            timestamp: timestampUs,
            duration: durationUs,
          });

          const keyFrame = frameIndex % 30 === 0;
          encoder.encode(frame, { keyFrame });
          frame.close();

          if (onProgress) {
            onProgress(Math.round(progress * 100));
          }

          if (frameIndex % 10 === 0) {
            await new Promise((r) => setTimeout(r, 0));
          }
        }

        await encoder.flush();
        muxer.finalize();

        const mp4Blob = new Blob([target.buffer], { type: 'video/mp4' });

        // Restore initial state
        this.mainPivot.rotation.y = initialMainY;
        this.childPivot.rotation.x = initialChildX;
        this.childPivot.rotation.z = initialChildZ;
        this.autoRotate = initialAutoRotate;

        resolve(mp4Blob);
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * MediaRecorder fallback for video recording
   */
  public record360VideoMediaRecorder(
    canvas: HTMLCanvasElement,
    durationSeconds = 6,
    preferredMime = 'video/mp4',
    onProgress?: (percent: number) => void
  ): Promise<Blob> {
    return new Promise((resolve, reject) => {
      let mimeType = preferredMime;
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = MediaRecorder.isTypeSupported('video/mp4;codecs=avc1')
          ? 'video/mp4;codecs=avc1'
          : MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
          ? 'video/webm;codecs=vp9'
          : 'video/webm';
      }

      const stream = (canvas as any).captureStream(60);
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: 8000000,
      });

      const chunks: Blob[] = [];
      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunks.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const videoBlob = new Blob(chunks, { type: mimeType });
        resolve(videoBlob);
      };

      mediaRecorder.onerror = (err) => {
        reject(err);
      };

      const initialMainY = this.mainPivot.rotation.y;
      const initialChildX = this.childPivot.rotation.x;
      const initialChildZ = this.childPivot.rotation.z;
      const initialAutoRotate = this.autoRotate;

      this.autoRotate = false;
      this.mainPivot.rotation.y = 0;
      this.childPivot.rotation.x = 0;

      mediaRecorder.start();

      const durationMs = durationSeconds * 1000;
      const startTime = performance.now();

      const observer = this.scene.onBeforeRenderObservable.add(() => {
        const elapsed = performance.now() - startTime;
        const progress = Math.min(1, elapsed / durationMs);

        this.mainPivot.rotation.y = progress * Math.PI * 2;
        this.childPivot.rotation.x = Math.sin(progress * Math.PI * 2) * (Math.PI / 4);

        if (onProgress) {
          onProgress(Math.round(progress * 100));
        }

        if (progress >= 1) {
          this.scene.onBeforeRenderObservable.remove(observer);
          mediaRecorder.stop();

          this.mainPivot.rotation.y = initialMainY;
          this.childPivot.rotation.x = initialChildX;
          this.childPivot.rotation.z = initialChildZ;
          this.autoRotate = initialAutoRotate;
        }
      });
    });
  }

  ngOnDestroy(): void {
    window.removeEventListener('resize', this.onResize);
    if (this.engine) {
      this.engine.dispose();
    }
  }
}
