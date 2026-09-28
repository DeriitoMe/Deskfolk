/** Bounded, critically damped gaze. Rendering rate is independent of pointer event frequency. */
export class GazeSpring {
  x = 0; y = 0;
  private vx = 0; private vy = 0;
  private targetX = 0; private targetY = 0;
  target(x: number, y: number) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    this.targetX = Math.max(-1, Math.min(1, x));
    this.targetY = Math.max(-1, Math.min(1, y));
  }
  snap(x: number, y: number) {
    this.target(x, y); this.x = this.targetX; this.y = this.targetY; this.vx = this.vy = 0;
  }
  step(seconds: number) {
    const dt = Math.max(0, Math.min(.05, seconds)), omega = 15;
    const evolve = (value: number, speed: number, goal: number): [number,number] => {
      const delta=value-goal, impulse=speed+omega*delta, decay=Math.exp(-omega*dt);
      return [Math.max(-1,Math.min(1,goal+(delta+impulse*dt)*decay)),(speed-omega*impulse*dt)*decay];
    };
    [this.x,this.vx]=evolve(this.x,this.vx,this.targetX);
    [this.y,this.vy]=evolve(this.y,this.vy,this.targetY);
    return {x:this.x,y:this.y};
  }
}
