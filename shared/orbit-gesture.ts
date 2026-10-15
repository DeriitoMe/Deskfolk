const TAU=Math.PI*2;
const REQUIRED_LAPS=3;
const REVERSAL_ANGLE=.18; // About ten degrees: allow small hand jitter before changing direction.
const MOVEMENT_PAUSE_MS=900;
const MIN_RADIUS=.22,MAX_RADIUS=1.65; // About 49–366 DIPs for the usual 222-DIP canvas.
/** Three real laps around the pet; traversals and jumps do not count. */
export class OrbitGesture {
  private previous?:{angle:number;at:number};
  private lastMovementAt=0;
  private direction=0;
  private travelled=0;
  private reversed=0;
  private cooldownUntil=0;
  reset(){this.previous=undefined;this.lastMovementAt=0;this.direction=0;this.travelled=0;this.reversed=0;}
  sample(x:number,y:number,size:number,now:number,enabled:boolean):boolean {
    if(!enabled||now<this.cooldownUntil||!Number.isFinite(x+y+size+now)||size<=0){this.reset();return false;}
    const radius=Math.hypot(x,y)/size;
    if(radius<MIN_RADIUS||radius>MAX_RADIUS){this.reset();return false;}
    const angle=Math.atan2(y,x),last=this.previous;
    if(!last||now-this.lastMovementAt>MOVEMENT_PAUSE_MS||now<last.at){this.reset();this.previous={angle,at:now};this.lastMovementAt=now;return false;}
    let delta=angle-last.angle;
    if(delta>Math.PI)delta-=TAU;if(delta< -Math.PI)delta+=TAU;
    const elapsed=Math.max(1,now-last.at);
    this.previous={angle,at:now};
    // Keep small continuous movement when updating the previous sample every frame.
    if(Math.abs(delta)<.000001)return false;
    this.lastMovementAt=now;
    if(Math.abs(delta)>Math.PI/3||Math.abs(delta)/elapsed>.025){this.travelled=0;this.direction=0;this.reversed=0;return false;}
    const sign=Math.sign(delta);
    if(!this.direction)this.direction=sign;
    const progress=delta*this.direction;
    if(progress<0){
      this.reversed-=progress;
      this.travelled=Math.max(0,this.travelled+progress);
      if(this.reversed>=REVERSAL_ANGLE){
        this.direction=sign;
        this.travelled=this.reversed;
        this.reversed=0;
      }
    }else{
      this.reversed=Math.max(0,this.reversed-progress);
      this.travelled+=progress;
    }
    if(this.travelled>=TAU*REQUIRED_LAPS-.001){this.reset();this.cooldownUntil=now+6000;return true;}
    return false;
  }
  get laps(){return this.travelled/TAU;}
}
