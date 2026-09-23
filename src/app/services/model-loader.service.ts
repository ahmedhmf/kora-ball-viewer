import { Injectable, inject } from '@angular/core';
import {
  SceneLoader,
  Vector3,
  BoundingInfo,
  AbstractMesh,
  Mesh,
  Node,
  Texture,
  Material,
} from '@babylonjs/core';
import { OBJFileLoader } from '@babylonjs/loaders/OBJ';
import { BabylonEngineService } from './babylon-engine.service';
import { BallVisualizerStore } from '../store/ball-visualizer.store';

// Tell OBJ Loader to skip internal material files (.mtl) to allow application PBR override
OBJFileLoader.SKIP_MATERIALS = true;

@Injectable({
  providedIn: 'root',
})
export class ModelLoaderService {
  private babylonEngine = inject(BabylonEngineService);
  private store = inject(BallVisualizerStore);

  /**
   * Load default KORA 32-Panel Ball model from public assets
   */
  public async loadDefaultModel(modelPath = '3d-models/32-CLB.obj'): Promise<void> {
    this.store.setLoading(true, 'Loading default 32-Panel Ball model...');

    const scene = this.babylonEngine.getScene();
    const pivot = this.babylonEngine.getChildPivot();
    const pbrMaterial = this.babylonEngine.getPBRMaterial();

    const existingChildren = pivot.getChildren();
    existingChildren.forEach((child) => child.dispose());

    let blobUrl: string | null = null;

    try {
      // 1. Fetch file directly to convert to Blob URL to guarantee Electron file:// compatibility
      try {
        const response = await fetch('./' + modelPath);
        if (response.ok) {
          const blob = await response.blob();
          blobUrl = URL.createObjectURL(blob);
        }
      } catch (fetchErr) {
        console.warn('Direct fetch of default model failed, using direct path:', fetchErr);
      }

      const targetPath = blobUrl || ('./' + modelPath);
      const result = await SceneLoader.ImportMeshAsync('', '', targetPath, scene, undefined, '.obj');

      const meshes = result.meshes;
      if (meshes && meshes.length > 0) {
        const totalBInfo = this.calculateTotalBoundingInfo(meshes);
        const offset = totalBInfo.boundingBox.centerWorld.negate();
        const radius = Math.max(0.1, totalBInfo.boundingSphere.radius);
        const scale = 19 / radius;

        meshes.forEach((mesh) => {
          if (mesh instanceof AbstractMesh) {
            mesh.position.addInPlace(offset);
            if (mesh instanceof Mesh) {
              mesh.bakeCurrentTransformIntoVertices();
            }
            mesh.scaling = new Vector3(scale, scale, scale);
            mesh.material = pbrMaterial;

            if (!mesh.parent || !(mesh.parent instanceof AbstractMesh) || !meshes.includes(mesh.parent as AbstractMesh)) {
              mesh.parent = pivot;
            }
          }
        });

        pivot.getChildren().forEach((child) => {
          this.applyMaterialRecursively(child, pbrMaterial);
        });
      }

      this.store.setModelInfo('KORA 32-CLB Ball (Default)', 33006926);
    } catch (err: any) {
      console.error('Error loading default 3D ball model:', err);
      this.store.setLoading(false, `Failed to load 32-Panel Ball: ${err.message || err}`);
    } finally {
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl);
      }
    }
  }

  /**
   * Load an OBJ or GLB 3D model file, center and scale ALL meshes, and parent them to pivot
   * so no stray meshes are left behind at origin when moving/rotating the ball.
   */
  public async loadModelFile(file: File): Promise<void> {
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext !== 'obj' && ext !== 'glb' && ext !== 'gltf') {
      throw new Error(`Unsupported model format: .${ext}. Please provide an .obj or .glb file.`);
    }

    this.store.setLoading(true, `Loading 3D model: ${file.name}...`);

    const scene = this.babylonEngine.getScene();
    const pivot = this.babylonEngine.getChildPivot();
    const pbrMaterial = this.babylonEngine.getPBRMaterial();

    // 1. Dispose all existing children of pivot before loading new model
    const existingChildren = pivot.getChildren();
    existingChildren.forEach((child) => child.dispose());

    const blobUrl = URL.createObjectURL(file);

    try {
      const pluginExtension = ext === 'obj' ? '.obj' : ext === 'glb' ? '.glb' : '.gltf';
      const result = await SceneLoader.ImportMeshAsync('', '', blobUrl, scene, undefined, pluginExtension);

      const meshes = result.meshes;
      if (meshes && meshes.length > 0) {
        // 2. Calculate combined bounding info across ALL valid meshes
        const totalBInfo = this.calculateTotalBoundingInfo(meshes);
        const offset = totalBInfo.boundingBox.centerWorld.negate();
        const radius = Math.max(0.1, totalBInfo.boundingSphere.radius);
        const scale = 19 / radius; // Standard size 5 ball radius scaling

        // 3. Center, scale, and parent EVERY mesh in the model so no unparented mesh stays at origin
        meshes.forEach((mesh) => {
          if (mesh instanceof AbstractMesh) {
            mesh.position.addInPlace(offset);
            if (mesh instanceof Mesh) {
              mesh.bakeCurrentTransformIntoVertices();
            }
            mesh.scaling = new Vector3(scale, scale, scale);
            mesh.material = pbrMaterial;

            // If the mesh is top-level (not parented to another mesh in this model), parent it to pivot
            if (!mesh.parent || !(mesh.parent instanceof AbstractMesh) || !meshes.includes(mesh.parent as AbstractMesh)) {
              mesh.parent = pivot;
            }
          }
        });

        // 4. Recursively apply PBR material to all nodes under pivot
        pivot.getChildren().forEach((child) => {
          this.applyMaterialRecursively(child, pbrMaterial);
        });
      }

      this.store.setModelInfo(file.name, file.size);
    } catch (err: any) {
      console.error('Error loading 3D model file:', err);
      this.store.setLoading(false, `Failed to load 3D model: ${err.message || err}`);
      throw err;
    } finally {
      URL.revokeObjectURL(blobUrl);
    }
  }

  /**
   * Load a face filter image file (JPG/PNG) and apply it to the PBR material
   */
  public async loadTextureFile(file: File): Promise<void> {
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (!['jpg', 'jpeg', 'png', 'webp'].includes(ext || '')) {
      throw new Error(`Unsupported image format: .${ext}. Please provide a JPG or PNG image file.`);
    }

    this.store.setLoading(true, `Applying face filter texture: ${file.name}...`);

    const scene = this.babylonEngine.getScene();
    const pivot = this.babylonEngine.getChildPivot();
    const pbrMaterial = this.babylonEngine.getPBRMaterial();

    const blobUrl = URL.createObjectURL(file);

    try {
      const texture = new Texture(
        blobUrl,
        scene,
        false, // noMipmap
        this.store.invertY(), // invertY setting
        Texture.TRILINEAR_SAMPLINGMODE,
        () => {
          // Success callback
          const isNormalMap = file.name.toLowerCase().includes('_normal') || file.name.toLowerCase().includes('_nrm');
          if (isNormalMap) {
            pbrMaterial.normalTexture = texture;
          } else {
            pbrMaterial.baseTexture = texture;
          }

          // Apply PBR material to all items in pivot hierarchy
          pivot.getChildren().forEach((item) => {
            this.applyMaterialRecursively(item, pbrMaterial);
          });

          this.store.setTextureInfo(file.name, file.size);
        },
        (message, exception) => {
          console.error('Texture load error:', message, exception);
          this.store.setLoading(false, `Failed to load texture image.`);
        }
      );
    } catch (err: any) {
      console.error('Error applying face filter texture:', err);
      this.store.setLoading(false, `Error applying texture: ${err.message || err}`);
      throw err;
    }
  }

  /**
   * Recursively assign material to mesh and all its children/sub-children
   */
  private applyMaterialRecursively(node: Node, material: Material): void {
    if (node instanceof AbstractMesh) {
      node.material = material;
    }
    const children = node.getChildren();
    children.forEach((child) => this.applyMaterialRecursively(child, material));
  }

  /**
   * Calculate total bounding info across all geometry meshes
   */
  private calculateTotalBoundingInfo(meshes: AbstractMesh[]): BoundingInfo {
    const validMeshes = meshes.filter((m) => m.getTotalVertices() > 0);
    const targetMeshes = validMeshes.length > 0 ? validMeshes : meshes;

    let boundingInfo = targetMeshes[0].getBoundingInfo();
    let min = boundingInfo.boundingBox.minimumWorld;
    let max = boundingInfo.boundingBox.maximumWorld;

    for (let i = 1; i < targetMeshes.length; i++) {
      boundingInfo = targetMeshes[i].getBoundingInfo();
      min = Vector3.Minimize(min, boundingInfo.boundingBox.minimumWorld);
      max = Vector3.Maximize(max, boundingInfo.boundingBox.maximumWorld);
    }

    return new BoundingInfo(min, max);
  }
}
