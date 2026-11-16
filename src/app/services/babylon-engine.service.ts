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
   * Capture an 8-angle pack of high-resolution screenshots of the 3D ball:
   * 1. Front view – straight at the ball
   * 2. Back view – opposite side
   * 3. Left side – rotated 90°
   * 4. Right side – rotated 90° the other way
   * 5. Top view – looking down
   * 6. Bottom view – underneath
   * 7. 45° diagonal view – front and side visible
   * 8. Opposite diagonal view – showing the opposite panels
   */
  public async captureMultiAnglePack(
    onProgress?: (percent: number, label: string) => void
  ): Promise<{ name: string; fileName: string; dataUrl: string; blob: Blob }[]> {
    if (!this.engine || !this.scene || !this.camera) {
      throw new Error('3D Engine is not initialized');
    }

    const initialAutoRotate = this.autoRotate;
    const initialMainRot = this.mainPivot.rotation.clone();
    const initialChildRot = this.childPivot.rotation.clone();
    const initialAlpha = this.camera.alpha;
    const initialBeta = this.camera.beta;
    const initialRadius = this.camera.radius;
    const initialTarget = this.camera.target.clone();
    const initialBgEnabled = this.backgroundLayer ? this.backgroundLayer.isEnabled : false;
    const initialClearColor = this.scene.clearColor.clone();

    this.autoRotate = false;
    if (this.backgroundLayer) {
      this.backgroundLayer.isEnabled = false;
    }
    this.scene.clearColor = new Color4(0, 0, 0, 0);

    const views = [
      {
        name: 'Front View (Straight)',
        fileName: '01_front_view.png',
        alpha: Tools.ToRadians(90),
        beta: Tools.ToRadians(90),
        rotY: 0,
        rotX: 0,
        rotZ: 0,
      },
      {
        name: 'Back View (Opposite Side)',
        fileName: '02_back_view.png',
        alpha: Tools.ToRadians(90),
        beta: Tools.ToRadians(90),
        rotY: Math.PI,
        rotX: 0,
        rotZ: 0,
      },
      {
        name: 'Left Side (Rotated 90°)',
        fileName: '03_left_side_view.png',
        alpha: Tools.ToRadians(90),
        beta: Tools.ToRadians(90),
        rotY: Math.PI / 2,
        rotX: 0,
        rotZ: 0,
      },
      {
        name: 'Right Side (Rotated -90°)',
        fileName: '04_right_side_view.png',
        alpha: Tools.ToRadians(90),
        beta: Tools.ToRadians(90),
        rotY: -Math.PI / 2,
        rotX: 0,
        rotZ: 0,
      },
      {
        name: 'Top View (Looking Down)',
        fileName: '05_top_view.png',
        alpha: Tools.ToRadians(90),
        beta: Tools.ToRadians(90),
        rotY: 0,
        rotX: Math.PI / 2,
        rotZ: 0,
      },
      {
        name: 'Bottom View (Underneath)',
        fileName: '06_bottom_view.png',
        alpha: Tools.ToRadians(90),
        beta: Tools.ToRadians(90),
        rotY: 0,
        rotX: -Math.PI / 2,
        rotZ: 0,
      },
      {
        name: '45° Diagonal View (Front & Side)',
        fileName: '07_diagonal_front_side.png',
        alpha: Tools.ToRadians(90),
        beta: Tools.ToRadians(65),
        rotY: Math.PI / 4,
        rotX: Math.PI / 8,
        rotZ: 0,
      },
      {
        name: 'Opposite Diagonal View (Opposite Panels)',
        fileName: '08_diagonal_opposite_panels.png',
        alpha: Tools.ToRadians(90),
        beta: Tools.ToRadians(115),
        rotY: Math.PI + Math.PI / 4,
        rotX: -Math.PI / 8,
        rotZ: 0,
      },
    ];

    const results: { name: string; fileName: string; dataUrl: string; blob: Blob }[] = [];

    try {
      this.camera.setTarget(Vector3.Zero());
      this.camera.radius = 62;

      for (let i = 0; i < views.length; i++) {
        const v = views[i];
        if (onProgress) {
          onProgress(Math.round((i / views.length) * 100), v.name);
        }

        this.camera.alpha = v.alpha;
        this.camera.beta = v.beta;
        this.mainPivot.rotation.set(0, v.rotY, 0);
        this.childPivot.rotation.set(v.rotX, 0, v.rotZ);

        // Render 2 frames to ensure matrices and transparent clear buffer are updated
        this.scene.render();
        this.scene.render();

        const dataUrl = await new Promise<string>((resolve, reject) => {
          try {
            Tools.CreateScreenshot(
              this.engine,
              this.camera,
              { precision: 1.5 },
              (data) => {
                resolve(data);
              },
              'image/png'
            );
          } catch (err) {
            reject(err);
          }
        });

        const res = await fetch(dataUrl);
        const blob = await res.blob();

        results.push({
          name: v.name,
          fileName: v.fileName,
          dataUrl,
          blob,
        });

        await new Promise((r) => setTimeout(r, 20));
      }

      if (onProgress) {
        onProgress(100, 'Completed');
      }
    } finally {
      // Restore camera, background layer, clearColor, and pivots
      this.mainPivot.rotation.copyFrom(initialMainRot);
      this.childPivot.rotation.copyFrom(initialChildRot);
      this.camera.alpha = initialAlpha;
      this.camera.beta = initialBeta;
      this.camera.radius = initialRadius;
      this.camera.setTarget(initialTarget);
      if (this.backgroundLayer) {
        this.backgroundLayer.isEnabled = initialBgEnabled;
      }
      this.scene.clearColor = initialClearColor;
      this.autoRotate = initialAutoRotate;
      this.scene.render();
    }

    return results;
  }

  /**
   * Build a standard uncompressed ZIP archive from an array of files
   */
  public async createZipArchive(
    files: { fileName: string; blob: Blob }[]
  ): Promise<Blob> {
    const fileEntries: {
      nameBytes: Uint8Array;
      data: Uint8Array;
      crc: number;
      offset: number;
    }[] = [];

    const encoder = new TextEncoder();
    let offset = 0;

    for (const f of files) {
      const arrayBuffer = await f.blob.arrayBuffer();
      const data = new Uint8Array(arrayBuffer);
      const nameBytes = encoder.encode(f.fileName);
      const crc = this.crc32(data);

      fileEntries.push({
        nameBytes,
        data,
        crc,
        offset,
      });

      // Local file header (30 bytes + fileName length) + file data
      offset += 30 + nameBytes.length + data.length;
    }

    const centralDirStart = offset;
    let centralDirSize = 0;
    for (const entry of fileEntries) {
      centralDirSize += 46 + entry.nameBytes.length;
    }

    const totalSize = centralDirStart + centralDirSize + 22;
    const zipBuffer = new ArrayBuffer(totalSize);
    const view = new DataView(zipBuffer);
    const bytes = new Uint8Array(zipBuffer);

    let ptr = 0;

    // 1. Write Local File Headers + Data
    for (const entry of fileEntries) {
      view.setUint32(ptr, 0x04034b50, true); // Local file header signature
      view.setUint16(ptr + 4, 20, true); // Version needed to extract
      view.setUint16(ptr + 6, 0, true); // General purpose bit flag
      view.setUint16(ptr + 8, 0, true); // Compression method (0 = store)
      view.setUint16(ptr + 10, 0, true); // Last mod file time
      view.setUint16(ptr + 12, 0, true); // Last mod file date
      view.setUint32(ptr + 14, entry.crc, true); // CRC-32
      view.setUint32(ptr + 18, entry.data.length, true); // Compressed size
      view.setUint32(ptr + 22, entry.data.length, true); // Uncompressed size
      view.setUint16(ptr + 26, entry.nameBytes.length, true); // File name length
      view.setUint16(ptr + 28, 0, true); // Extra field length
      ptr += 30;

      bytes.set(entry.nameBytes, ptr);
      ptr += entry.nameBytes.length;

      bytes.set(entry.data, ptr);
      ptr += entry.data.length;
    }

    // 2. Write Central Directory Headers
    for (const entry of fileEntries) {
      view.setUint32(ptr, 0x02014b50, true); // Central file header signature
      view.setUint16(ptr + 4, 20, true); // Version made by
      view.setUint16(ptr + 6, 20, true); // Version needed to extract
      view.setUint16(ptr + 8, 0, true); // General purpose bit flag
      view.setUint16(ptr + 10, 0, true); // Compression method (0 = store)
      view.setUint16(ptr + 12, 0, true); // Last mod file time
      view.setUint16(ptr + 14, 0, true); // Last mod file date
      view.setUint32(ptr + 16, entry.crc, true); // CRC-32
      view.setUint32(ptr + 20, entry.data.length, true); // Compressed size
      view.setUint32(ptr + 24, entry.data.length, true); // Uncompressed size
      view.setUint16(ptr + 28, entry.nameBytes.length, true); // File name length
      view.setUint16(ptr + 30, 0, true); // Extra field length
      view.setUint16(ptr + 32, 0, true); // File comment length
      view.setUint16(ptr + 34, 0, true); // Disk number start
      view.setUint16(ptr + 36, 0, true); // Internal file attributes
      view.setUint32(ptr + 38, 0, true); // External file attributes
      view.setUint32(ptr + 42, entry.offset, true); // Relative offset of local header
      ptr += 46;

      bytes.set(entry.nameBytes, ptr);
      ptr += entry.nameBytes.length;
    }

    // 3. Write End of Central Directory Record (EOCD)
    view.setUint32(ptr, 0x06054b50, true); // End of central dir signature
    view.setUint16(ptr + 4, 0, true); // Number of this disk
    view.setUint16(ptr + 6, 0, true); // Disk where central directory starts
    view.setUint16(ptr + 8, fileEntries.length, true); // Number of central directory records on this disk
    view.setUint16(ptr + 10, fileEntries.length, true); // Total number of central directory records
    view.setUint32(ptr + 12, centralDirSize, true); // Size of central directory
    view.setUint32(ptr + 16, centralDirStart, true); // Offset of start of central directory
    view.setUint16(ptr + 20, 0, true); // Comment length

    return new Blob([zipBuffer], { type: 'application/zip' });
  }

  private crc32(data: Uint8Array): number {
    let crc = 0xffffffff;
    for (let i = 0; i < data.length; i++) {
      crc ^= data[i];
      for (let j = 0; j < 8; j++) {
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
      }
    }
    return (crc ^ 0xffffffff) >>> 0;
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
