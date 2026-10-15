/** Local interaction only. It never changes Codex task or question state. */
export const TOUCH_THRESHOLD=10;
export const TOUCH_GAP_MS=3000;
export const TEARFUL_SECONDS=4;

export class RepeatedTouchResponse {
 private taps=0;
 private lastTap=-Infinity;
 private tearfulUntil=0;
 readonly gapMs:number;
 readonly durationMs:number;
 constructor(gapMs=TOUCH_GAP_MS,durationMs=TEARFUL_SECONDS*1000){this.gapMs=gapMs;this.durationMs=durationMs;}
 get count(){return this.taps;}
 get deadline(){return this.tearfulUntil;}
 active(now:number){return this.tearfulUntil>now;}
 tap(now:number):boolean {
  // Taps during the reaction retain their physical feedback but do not start
  // another count or extend the original deadline.
  if(this.active(now))return false;
  if(now<this.lastTap||now-this.lastTap>this.gapMs)this.taps=0;
  this.lastTap=now;
  if(++this.taps<TOUCH_THRESHOLD)return false;
  this.taps=0;this.lastTap=-Infinity;this.tearfulUntil=now+this.durationMs;
  return true;
 }
 clear(){this.taps=0;this.lastTap=-Infinity;this.tearfulUntil=0;}
}
