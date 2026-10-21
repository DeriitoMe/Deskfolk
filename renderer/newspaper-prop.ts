import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import paperUrl from '../assets/characters/wakaba-mutsumi/newspaper-20261021/runtime/morning-paper.glb?url';

/**
 * The open Morning Brief held for the reading action. The Blender model
 * (scripts/build-morning-paper.py) leans back so the reading side faces her
 * face, with the two pages folded into a V and two inner sheets behind. Its
 * light and shadow are baked into vertex colours; the printed outside is
 * painted here and multiplied by that shading. The front page with the
 * masthead sits on the screen-left half, the back page with a little trend
 * chart on the right. Large blocks instead of real text stay legible at
 * desktop size.
 */
const PAPER = '#f4efe2', INK = '#3b3a37', RULE = '#8d887c', TEXT = '#b3ad9f', SAGE = '#9fbf93';
const smooth = (v: number) => { v = Math.max(0, Math.min(1, v)); return v * v * (3 - 2 * v); };

export class NewspaperProp {
  readonly group = new T.Group();
  /** Model offset so the midpoint of its two grip markers sits at the group origin. */
  private sheet = new T.Group();
  private canvas = document.createElement('canvas');
  private texture: T.CanvasTexture;
  private materials: T.MeshBasicMaterial[] = [];
  /** How far the centre crease sits in front of the line between the hands. */
  private creaseDepth = 0;
  constructor() {
    this.group.name = 'MorningPaper'; this.group.add(this.sheet);
    this.canvas.width = 768; this.canvas.height = 512;
    this.texture = new T.CanvasTexture(this.canvas); this.texture.colorSpace = T.SRGBColorSpace;
    // glTF texture coordinates start at the top edge.
    this.texture.flipY = false; this.texture.anisotropy = 4;
  }
  async load() {
    const gltf = await new GLTFLoader().loadAsync(paperUrl);
    const gripL = gltf.scene.getObjectByName('GripL') ?? gltf.scene.getObjectByName('Grip.L');
    const gripR = gltf.scene.getObjectByName('GripR') ?? gltf.scene.getObjectByName('Grip.R');
    if (!gripL || !gripR) throw Error('Newspaper grip markers missing');
    // A hair in front of the grips keeps the curled bottom corners off her hem.
    this.sheet.position.copy(gripL.position).add(gripR.position).multiplyScalar(-.5);
    this.sheet.position.z += .03;
    this.creaseDepth = this.sheet.position.z;
    gltf.scene.traverse(o => {
      if (!(o instanceof T.Mesh)) return;
      const printed = o.geometry.hasAttribute('uv');
      const material = new T.MeshBasicMaterial({map: printed ? this.texture : null, color: printed ? '#ffffff' : '#ece5d4',
        vertexColors: true, side: T.DoubleSide, transparent: true, toneMapped: false});
      o.material = material; o.frustumCulled = false; this.materials.push(material);
    });
    this.sheet.add(gltf.scene);
  }
  /** Paint the static spread. */
  paint(date = new Date()) {
    const c = this.canvas.getContext('2d')!, w = 768, h = 512, half = w / 2;
    c.fillStyle = PAPER; c.fillRect(0, 0, w, h);
    // Front page (screen-left): masthead, date rule, headline and a picture.
    c.fillStyle = INK; c.textAlign = 'center'; c.textBaseline = 'alphabetic';
    let size = 60; c.font = `700 ${size}px Georgia, "Times New Roman", serif`;
    while (c.measureText('Morning Brief').width > half - 44 && size > 30) { size -= 2; c.font = `700 ${size}px Georgia, "Times New Roman", serif`; }
    c.fillText('Morning Brief', half / 2, 76);
    c.fillStyle = RULE; c.fillRect(22, 92, half - 44, 4); c.fillRect(22, 100, half - 44, 1.5);
    c.font = '600 17px Georgia, serif'; c.fillStyle = '#6d695f'; c.textAlign = 'left';
    c.fillText(date.toISOString().slice(0, 10), 24, 123); c.textAlign = 'right'; c.fillText('Skills · Agents', half - 24, 123);
    c.fillStyle = INK; c.fillRect(24, 142, half - 48, 20); c.fillRect(24, 170, (half - 48) * .66, 20);
    c.fillStyle = SAGE; c.fillRect(24, 208, 158, 116);
    c.fillStyle = '#7fa277'; c.beginPath(); c.moveTo(24, 324); c.lineTo(84, 256); c.lineTo(124, 292); c.lineTo(150, 270); c.lineTo(182, 324); c.fill();
    c.fillStyle = '#f2d98b'; c.beginPath(); c.arc(148, 238, 14, 0, Math.PI * 2); c.fill();
    this.lines(c, 198, 212, half - 222, 6);
    this.lines(c, 24, 348, half - 48, 6);
    // Back page (screen-right): column text and a little star-growth chart.
    c.fillStyle = INK; c.fillRect(half + 24, 34, half - 48, 16);
    this.lines(c, half + 24, 66, (half - 60) / 2, 11); this.lines(c, half + 36 + (half - 60) / 2, 66, (half - 60) / 2, 5);
    const cx = half + 36 + (half - 60) / 2, cw = (half - 60) / 2;
    c.strokeStyle = RULE; c.lineWidth = 2; c.strokeRect(cx, 190, cw, 128);
    [.35, .55, .48, .78, .92].forEach((v, k) => { c.fillStyle = k === 4 ? '#e3a35f' : SAGE; c.fillRect(cx + 12 + k * (cw - 24) / 5, 310 - v * 104, (cw - 24) / 5 - 8, v * 104); });
    this.lines(c, half + 24, 348, half - 48, 6);
    c.strokeStyle = '#d8d1bf'; c.lineWidth = 3; c.strokeRect(1.5, 1.5, w - 3, h - 3);
    this.texture.needsUpdate = true;
  }
  private lines(c: CanvasRenderingContext2D, x: number, y: number, width: number, count: number) {
    c.fillStyle = TEXT;
    for (let k = 0; k < count; k++) c.fillRect(x, y + k * 22, width * (k === count - 1 ? .58 : .9 + .1 * Math.sin(k * 2.7 + x)), 9);
  }
  showAll() { this.group.visible = true; }
  /**
   * Hold the sheet by its side edges between both mittens. `yaw` follows the
   * body turn, `weight` fades the prop. `snap` is the flick between pages
   * (gather below 0, sharp pull at 1) and `stretch` the hands' span against
   * their resting span: pulling the sheet taut widens it and flattens the
   * V of the fold, the gather deepens it a little.
   */
  update(weight: number, gripL: T.Vector3, gripR: T.Vector3, yaw: number, snap: number, stretch: number, t: number) {
    // The sheet only appears once the arms are mostly in place, so a blend
    // from another action never shows half-faded props through it.
    const show = smooth((weight - .45) / .55);
    this.group.visible = show > .005;
    if (!this.group.visible) return;
    for (const m of this.materials) { m.opacity = show; m.depthWrite = show > .99; }
    this.group.position.copy(gripL).add(gripR).multiplyScalar(.5);
    const pull = Math.max(0, snap), gather = Math.max(0, -snap);
    // A taut pull dips the sheet a touch instead of lifting it into her face.
    this.group.position.y += Math.sin(t * 1.6) * .008 - .03 * pull;
    // The flick pivots on the line between the hands. The tilt only swings
    // the bottom edge forward, never back into her dress.
    this.group.rotation.set(-Math.abs(snap) * .05, yaw, snap * .015, 'YXZ');
    const size = .88 + .12 * show, depth = 1 - .32 * pull + .1 * gather;
    this.group.scale.set(size * Math.max(1, stretch), size, size * depth);
    // Flattening brings the side edges forward; the crease stays where it is
    // so the top of the sheet never moves back toward her chin.
    this.group.translateZ(this.creaseDepth * size * (1 - depth));
  }
}
