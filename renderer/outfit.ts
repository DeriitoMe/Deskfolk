import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import beretOutfitUrl from '../assets/characters/wakaba-mutsumi/beret-outfit-20261024/runtime/beret-outfit.glb?url';
import type {PetOutfit} from '../shared/types';

/**
 * Mutsumi's crimson beret outfit (scripts/export-beret-outfit.py). Every
 * piece is stored in model space with the rig control it follows in
 * `deskfolk_parent`; it is attached to that control at the rest pose, so it
 * moves with the body, arms, feet or head like the part it replaces. Colours
 * and shading are baked into vertex colours. Wearing it hides the school
 * uniform's dress, collar, sleeves and boots; the uniform comes back unchanged.
 */
const UNIFORM_PARTS = ['BodySailorDress', 'BodyConcealedCollar', 'ArmSleeve', 'FootBoot'];

export class Outfit {
  private pieces: T.Mesh[] = [];
  private uniform: T.Object3D[] = [];
  current: PetOutfit = 'uniform';
  /** Call while the model is still at its rest pose. */
  async load(model: T.Object3D, control: (name: string) => T.Object3D) {
    model.traverse(o => { if (o instanceof T.Mesh && UNIFORM_PARTS.some(p => o.name.startsWith(p))) this.uniform.push(o); });
    if (this.uniform.length < UNIFORM_PARTS.length) throw Error('Uniform parts missing');
    const gltf = await new GLTFLoader().loadAsync(beretOutfitUrl);
    const material = new T.MeshBasicMaterial({vertexColors: true, toneMapped: false, side: T.DoubleSide});
    const found: T.Mesh[] = [];
    gltf.scene.traverse(o => { if (o instanceof T.Mesh) found.push(o); });
    model.updateMatrixWorld(true);
    for (const mesh of found) {
      const parent = mesh.userData.deskfolk_parent as string | undefined;
      const target = parent ? control(parent) : undefined;
      if (!target) throw Error(`Outfit piece ${mesh.name} has no control`);
      mesh.material = material; mesh.frustumCulled = false; mesh.visible = false;
      model.add(mesh); mesh.updateMatrixWorld(true); target.attach(mesh);
      this.pieces.push(mesh);
    }
    if (!this.pieces.length) throw Error('Outfit pieces missing');
    this.wear(this.current);
  }
  wear(outfit: PetOutfit) {
    this.current = outfit;
    const beret = outfit === 'beret';
    for (const o of this.pieces) o.visible = beret;
    for (const o of this.uniform) o.visible = !beret;
  }
  /** Make every piece visible once so its buffers are uploaded with the rest. */
  showAll() { for (const o of this.pieces) o.visible = true; }
}
