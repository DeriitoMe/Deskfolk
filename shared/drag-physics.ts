export const MAX_DRAG_ANGLE = 70 * Math.PI / 180;
const clamp = (v:number,lo:number,hi:number) => Math.max(lo,Math.min(hi,v));

/** Screen-plane suspension: pointer motion supplies force, gravity restores rest. */
export class DragPendulum {
  angle=0;
  angularVelocity=0;
  private speed=0;
  private offset=0;
  private sinceInput=10;
  begin(){this.speed=0;this.offset=0;this.sinceInput=10;}
  input(dx:number,elapsedMs:number,displacementX:number){
    if (![dx,elapsedMs,displacementX].every(Number.isFinite) || Math.abs(dx)<.01) return;
    const seconds=clamp(elapsedMs/1000,1/240,.1);
    const blend=1-Math.exp(-seconds/.09);
    this.speed+=(clamp(dx/seconds,-6000,6000)-this.speed)*blend;
    this.offset=clamp(displacementX,-2400,2400);
    this.sinceInput=0;
  }
  step(seconds:number,held:boolean){
    let remaining=clamp(seconds,0,.1);
    while(remaining>0){
      const dt=Math.min(1/120,remaining);remaining-=dt;this.sinceInput+=dt;
      // Distance reinforces the latest drag direction, rather than holding a
      // static tilt forever after the pointer stops.
      const direction=Math.sign(this.speed);
      const force=held?clamp(this.speed/2400+direction*Math.abs(this.offset)/1200,-1,1)*Math.exp(-Math.max(0,this.sinceInput-.05)/.22):0;
      const target=-MAX_DRAG_ANGLE*force;
      const acceleration=(target-this.angle)*40-this.angularVelocity*16;
      this.angularVelocity+=acceleration*dt;
      this.angle+=this.angularVelocity*dt;
      if(Math.abs(this.angle)>MAX_DRAG_ANGLE){
        this.angle=clamp(this.angle,-MAX_DRAG_ANGLE,MAX_DRAG_ANGLE);
        if(Math.sign(this.angularVelocity)===Math.sign(this.angle))this.angularVelocity=0;
      }
    }
    return this.angle;
  }
}
