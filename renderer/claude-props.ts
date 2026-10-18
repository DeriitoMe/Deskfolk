import * as T from 'three';

/**
 * Claude Code tool gestures: a tilted mini keyboard with a floating terminal
 * while Claude runs commands, and a notepad with a pencil while it edits
 * files. The eyes keep the ordinary working code flow.
 *
 * Weights are pose channels (0–1) so every prop blends in and out with the
 * same smoothing as the rest of the rig.
 */
export type ClaudeWeights = {type:number;write:number};
export const CLAUDE_CORAL = '#d97757';
const TAU = Math.PI * 2;
const clamp = T.MathUtils.clamp;
const smooth = (v:number) => { v = clamp(v, 0, 1); return v * v * (3 - 2 * v); };

/** Ten tapered rays of alternating length around a soft centre. */
export function drawSpark(c:CanvasRenderingContext2D, radius:number, rotation:number, fill:string, rays = 10) {
  c.save(); c.rotate(rotation); c.fillStyle = fill; c.beginPath();
  for (let k = 0; k < rays; k++) {
    const a = k * TAU / rays, long = k % 2 ? .66 : 1, r = radius * long, w = radius * (k % 2 ? .15 : .19);
    const tipX = Math.cos(a) * r, tipY = Math.sin(a) * r;
    const sideX = -Math.sin(a) * w, sideY = Math.cos(a) * w;
    const midX = Math.cos(a) * r * .32, midY = Math.sin(a) * r * .32;
    c.moveTo(0, 0);
    c.quadraticCurveTo(midX + sideX, midY + sideY, tipX, tipY);
    c.quadraticCurveTo(midX - sideX, midY - sideY, 0, 0);
  }
  c.fill(); c.beginPath(); c.arc(0, 0, radius * .2, 0, TAU); c.fill(); c.restore();
}

type Basic = (color:string|number, opacity?:number) => T.MeshBasicMaterial;

export class ClaudeProps {
  readonly group = new T.Group();
  private keyboard = new T.Group(); private keys:T.Mesh[] = []; private terminal = new T.Group();
  private terminalCanvas = document.createElement('canvas'); private terminalTexture:T.CanvasTexture;
  private pad = new T.Group(); private padCanvas = document.createElement('canvas'); private padTexture:T.CanvasTexture;
  private pencil = new T.Group();
  private tmp = new T.Vector3();
  constructor(private basic:Basic) {
    this.group.name = 'ClaudeProps';

    // Bash: tilted mini keyboard in front of the hands plus a floating terminal.
    this.keyboard.name = 'ClaudeKeyboard'; this.group.add(this.keyboard);
    this.add(new T.BoxGeometry(.66, .045, .26), '#3d4252', this.keyboard, [0, 0, 0]);
    this.add(new T.BoxGeometry(.68, .02, .28), '#2d313d', this.keyboard, [0, -.03, 0]);
    for (let row = 0; row < 3; row++) for (let col = 0; col < 9; col++) {
      const wide = row === 2 && col === 4;
      if (row === 2 && (col === 3 || col === 5)) continue;
      const key = this.add(new T.BoxGeometry(wide ? .19 : .052, .024, .05), '#f3eee4', this.keyboard, [(col - 4) * .064, .032, (row - 1) * .066]);
      key.userData.seed = row * 9 + col; this.keys.push(key);
    }
    this.keyboard.rotation.x = 1.05; this.keyboard.scale.setScalar(1.45);
    this.terminal.name = 'ClaudeTerminal'; this.group.add(this.terminal);
    this.terminalCanvas.width = 256; this.terminalCanvas.height = 176;
    this.terminalTexture = new T.CanvasTexture(this.terminalCanvas); this.terminalTexture.colorSpace = T.SRGBColorSpace;
    const screen = new T.Mesh(new T.PlaneGeometry(.78, .54), new T.MeshBasicMaterial({map:this.terminalTexture, transparent:true, depthWrite:false, toneMapped:false}));
    screen.userData.baseOpacity = .94; this.terminal.add(screen);

    // Edit/Write: a notepad in one hand and a pencil in the other.
    this.pad.name = 'ClaudeNotepad'; this.group.add(this.pad);
    this.padCanvas.width = 160; this.padCanvas.height = 200;
    this.padTexture = new T.CanvasTexture(this.padCanvas); this.padTexture.colorSpace = T.SRGBColorSpace;
    const paper = new T.Mesh(new T.PlaneGeometry(.36, .45), new T.MeshBasicMaterial({map:this.padTexture, transparent:true, toneMapped:false, side:T.DoubleSide}));
    paper.position.z = .012; this.pad.add(paper);
    this.add(new T.BoxGeometry(.39, .48, .02), '#c98a5e', this.pad, [0, -.005, 0]);
    this.add(new T.BoxGeometry(.2, .04, .03), '#8e9aa6', this.pad, [0, .23, .02]);
    this.pad.rotation.set(-.35, 0, .12); this.pad.scale.setScalar(1.45);
    this.pencil.name = 'ClaudePencil'; this.group.add(this.pencil); this.pencil.scale.setScalar(1.5);
    this.add(new T.CylinderGeometry(.02, .02, .3, 6), '#f2c14e', this.pencil, [0, .15, 0]);
    this.add(new T.CylinderGeometry(.021, .021, .04, 6), '#c9c3b8', this.pencil, [0, .31, 0]);
    this.add(new T.CylinderGeometry(.02, .02, .03, 8), '#ee9aa4', this.pencil, [0, .345, 0]);
    this.add(new T.ConeGeometry(.02, .06, 6), '#f4dcb5', this.pencil, [0, -.03, 0]).rotation.x = Math.PI;
    this.add(new T.ConeGeometry(.007, .022, 6), '#3b3b3b', this.pencil, [0, -.054, 0]).rotation.x = Math.PI;
  }
  private add(g:T.BufferGeometry, color:string, parent:T.Object3D, pos:number[]) {
    const m = new T.Mesh(g, this.basic(color)); m.position.set(pos[0], pos[1], pos[2]); m.frustumCulled = false; parent.add(m); return m;
  }
  private fade(object:T.Object3D, amount:number) {
    object.visible = amount > .005;
    object.traverse(o => {
      if (!(o instanceof T.Mesh)) return;
      const m = o.material as T.MeshBasicMaterial; m.transparent = true;
      m.opacity = (o.userData.baseOpacity ?? 1) * amount; m.depthWrite = m.opacity > .99 && o.userData.baseOpacity === undefined;
    });
  }
  /** Make every prop visible once so shaders compile before first use. */
  showAll() { for (const o of [this.group, this.keyboard, this.terminal, this.pad, this.pencil]) o.visible = true; }
  private paintTerminal(t:number) {
    const c = this.terminalCanvas.getContext('2d')!, w = 256, h = 176;
    c.clearRect(0, 0, w, h);
    c.fillStyle = '#262830'; c.beginPath(); c.roundRect(2, 2, w - 4, h - 4, 18); c.fill();
    c.fillStyle = '#353844'; c.beginPath(); c.roundRect(2, 2, w - 4, 30, [18, 18, 0, 0]); c.fill();
    ['#f08a77', '#f4c562', '#8fcf7e'].forEach((col, k) => { c.fillStyle = col; c.beginPath(); c.arc(22 + k * 20, 17, 6, 0, TAU); c.fill(); });
    c.save(); c.translate(w - 26, 17); drawSpark(c, 10, t * .8, CLAUDE_CORAL); c.restore();
    // Chunky bars instead of text keep the window legible at desktop size.
    const step = Math.floor(t * 2.4), lines = 5;
    for (let k = 0; k < lines; k++) {
      const n = step - (lines - 1 - k), seed = Math.abs(Math.sin(n * 91.7)) % 1, y = 50 + k * 24;
      if (n < 0) continue;
      c.fillStyle = CLAUDE_CORAL; c.fillRect(16, y, 10, 12);
      const full = 60 + seed * 140, grow = k === lines - 1 ? (t * 2.4 % 1) : 1;
      c.fillStyle = k === lines - 1 ? '#fff3df' : '#b9b4aa'; c.fillRect(34, y, full * grow, 12);
      if (k === lines - 1 && Math.floor(t * 3) % 2 === 0) { c.fillStyle = '#fff3df'; c.fillRect(38 + full * grow, y - 2, 9, 16); }
    }
    this.terminalTexture.needsUpdate = true;
  }
  private paintPad(t:number) {
    const c = this.padCanvas.getContext('2d')!, w = 160, h = 200;
    c.fillStyle = '#fffaf0'; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#d5e3ea'; c.lineWidth = 2;
    for (let y = 46; y < h; y += 26) { c.beginPath(); c.moveTo(10, y); c.lineTo(w - 10, y); c.stroke(); }
    c.strokeStyle = '#f2b8a8'; c.beginPath(); c.moveTo(28, 10); c.lineTo(28, h - 6); c.stroke();
    // Scribbles appear line by line, then the page clears and starts again.
    const cycle = t % 6, progress = cycle / 5.2;
    c.strokeStyle = '#4a4a5a'; c.lineWidth = 4; c.lineCap = 'round';
    for (let line = 0; line < 5; line++) {
      const u = clamp(progress * 5 - line, 0, 1); if (u <= 0) break;
      const y = 40 + line * 26, end = 36 + (w - 54 - (line % 2) * 30) * u;
      c.beginPath(); c.moveTo(36, y);
      for (let x = 36; x <= end; x += 3) c.lineTo(x, y - 3 + Math.sin(x * .45 + line) * 4);
      c.stroke();
    }
    if (progress > 1) { c.strokeStyle = CLAUDE_CORAL; c.lineWidth = 6; c.beginPath(); c.moveTo(108, 172); c.lineTo(118, 184); c.lineTo(140, 158); c.stroke(); }
    this.padTexture.needsUpdate = true;
  }
  /** Writing tip position on the pad for the pencil, in pad-local units. */
  private writingTip(t:number) {
    const cycle = t % 6, progress = clamp(cycle / 5.2, 0, 1.08), line = Math.min(4, Math.floor(progress * 5)), u = clamp(progress * 5 - line, 0, 1);
    return {x:-.13 + .23 * u, y:.165 - line * .058 + Math.sin(t * 14) * .006};
  }
  update(w:ClaudeWeights, handL:T.Vector3, handR:T.Vector3, t:number) {
    this.group.visible = Math.max(w.type, w.write) > .005;
    if (!this.group.visible) return;
    // Keyboard sits under both palms, the terminal floats beside her head.
    this.fade(this.keyboard, w.type); this.fade(this.terminal, w.type);
    if (w.type > .005) {
      this.keyboard.position.copy(handL).add(handR).multiplyScalar(.5); this.keyboard.position.y -= .06; this.keyboard.position.z += .2;
      for (const key of this.keys) {
        const hit = Math.max(0, Math.sin(t * 9 + key.userData.seed * 2.3)) ** 14;
        key.position.y = .032 - .012 * hit; (key.material as T.MeshBasicMaterial).color.set(hit > .4 ? '#f0a580' : '#f3eee4');
      }
      this.terminal.position.set(-1.5, 2.55 + Math.sin(t * 1.3) * .03, 1.5); this.terminal.rotation.set(0, .22, -.03);
      this.terminal.scale.setScalar(.75 + .25 * smooth(w.type));
      this.paintTerminal(t);
    }
    // The pad rests in the left (screen-right) hand; the pencil tip follows
    // the line currently being written.
    this.fade(this.pad, w.write); this.fade(this.pencil, w.write);
    if (w.write > .005) {
      this.pad.position.copy(handL).lerp(handR, .38); this.pad.position.y += .2; this.pad.position.z += .22;
      this.pad.updateMatrixWorld(true);
      const tip = this.writingTip(t);
      this.tmp.set(tip.x, tip.y, .03).applyMatrix4(this.pad.matrixWorld);
      this.pencil.position.copy(this.tmp); this.pencil.position.z += .04;
      this.pencil.rotation.set(-.35, 0, .55 + Math.sin(t * 14) * .05);
      this.paintPad(t);
    }
  }
}
