import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import guitarUrl from '../assets/characters/wakaba-mutsumi/guitar-20261021/runtime/mutsumi-guitar.glb?url';

/**
 * Mutsumi's pink 7-string guitar for the idle pastime
 * (scripts/build-mutsumi-guitar.py). Colours and shading are baked into
 * vertex colours. The picking hand carries it at the body grip. Size and
 * shape of the hold come from the resting pose; each frame the guitar turns
 * with the line between both hands, so it never leaves either of them when
 * she tips it to look it over or breathes.
 */
const TILT = 0, PICK_DEPTH = .03, NECK_FORWARD = -.28;
const smooth = (v: number) => { v = Math.max(0, Math.min(1, v)); return v * v * (3 - 2 * v); };

export class GuitarProp {
  readonly group = new T.Group();
  private model = new T.Group();
  private materials: T.MeshBasicMaterial[] = [];
  private gripBody = new T.Vector3(); private gripNeck = new T.Vector3();
  private hold = new T.Quaternion(); private size = 1;
  private tmp = new T.Vector3(); private restDir = new T.Vector3(); private follow = new T.Quaternion(); private up = new T.Vector3(0, 1, 0);
  constructor() { this.group.name = 'MutsumiGuitar'; this.group.add(this.model); }
  async load() {
    const gltf = await new GLTFLoader().loadAsync(guitarUrl);
    const body = gltf.scene.getObjectByName('GripBody') ?? gltf.scene.getObjectByName('Grip.Body');
    const neck = gltf.scene.getObjectByName('GripNeck') ?? gltf.scene.getObjectByName('Grip.Neck');
    if (!body || !neck) throw Error('Guitar grip markers missing');
    this.gripBody.copy(body.position); this.gripNeck.copy(neck.position);
    gltf.scene.traverse(o => {
      if (!(o instanceof T.Mesh)) return;
      const material = new T.MeshBasicMaterial({vertexColors: true, transparent: true, toneMapped: false, side: T.DoubleSide});
      o.material = material; o.frustumCulled = false; this.materials.push(material);
    });
    // The model's body grip sits at the group origin, with the guitar a little
    // behind it so the picking mitten rests on the strings instead of sinking in.
    gltf.scene.position.copy(this.gripBody).multiplyScalar(-1);
    gltf.scene.position.z -= PICK_DEPTH;
    this.model.add(gltf.scene);
  }
  /** Fit the resting hold: neck grip toward the fretting hand, face tilted up. */
  fit(picking: T.Vector3, fretting: T.Vector3) {
    const modelDir = this.tmp.copy(this.gripNeck).sub(this.gripBody);
    const modelLength = modelDir.length();
    const worldDir = fretting.clone().sub(picking);
    this.restDir.copy(worldDir).normalize();
    this.size = worldDir.length() / modelLength;
    const align = new T.Quaternion().setFromUnitVectors(modelDir.normalize(), worldDir.clone().normalize());
    this.hold.setFromAxisAngle(worldDir.normalize(), TILT).multiply(align);
    // Angle the neck toward the viewer so the headstock passes in front of her
    // hair and the fretting hand holds the neck from behind.
    this.hold.premultiply(new T.Quaternion().setFromAxisAngle(this.up, NECK_FORWARD));
  }
  showAll() { this.group.visible = true; }
  /**
   * `weight` fades the prop with the pose; `picking` and `fretting` are the
   * two mitten centres.
   */
  update(weight: number, picking: T.Vector3, fretting: T.Vector3) {
    // Appears only once the hands are nearly in place, so it never fades in
    // around arms that are still on their way.
    const show = smooth((weight - .62) / .38);
    this.group.visible = show > .005;
    if (!this.group.visible) return;
    for (const m of this.materials) { m.opacity = show; m.depthWrite = show > .99; }
    this.group.position.copy(picking);
    this.follow.setFromUnitVectors(this.restDir, this.tmp.copy(fretting).sub(picking).normalize());
    this.group.quaternion.copy(this.follow).multiply(this.hold);
    this.group.scale.setScalar(this.size * (.92 + .08 * show));
  }
}
