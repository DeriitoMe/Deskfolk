export const MAX_HAIR_SWAY_ANGLE = .18;
const SPRING = 64;
const DAMPING = 18;
const clamp = (value:number,low:number,high:number) => Math.max(low,Math.min(high,value));

/** Small, overdamped relative bend for the suspended hair tips. */
export class HairSway {
  angle=0;
  angularVelocity=0;

  step(seconds:number,bodyAngle:number,bodyVelocity:number,held:boolean):number {
    if(![seconds,bodyAngle,bodyVelocity].every(Number.isFinite))return this.angle;
    const target=held?clamp(-.36*bodyAngle-.022*bodyVelocity,-MAX_HAIR_SWAY_ANGLE,MAX_HAIR_SWAY_ANGLE):0;
    let remaining=clamp(seconds,0,.10);
    while(remaining>0){
      const dt=Math.min(1/240,remaining);remaining-=dt;
      this.angularVelocity+=((target-this.angle)*SPRING-this.angularVelocity*DAMPING)*dt;
      this.angle+=this.angularVelocity*dt;
      if(Math.abs(this.angle)>MAX_HAIR_SWAY_ANGLE){
        this.angle=clamp(this.angle,-MAX_HAIR_SWAY_ANGLE,MAX_HAIR_SWAY_ANGLE);
        if(Math.sign(this.angularVelocity)===Math.sign(this.angle))this.angularVelocity=0;
      }
    }
    return this.angle;
  }
}
