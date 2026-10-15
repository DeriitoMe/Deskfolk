/** A short press, release and small rebound; all values are rigid head offsets. */
export const TOUCH_SECONDS = .38;
export const TOUCH_HEAD_DROP = .13;
const clamp=(v:number)=>Math.max(0,Math.min(1,v));
const smooth=(v:number)=>{v=clamp(v);return v*v*(3-2*v);};

export function touchPressure(seconds:number,initial=0):number {
  initial=Math.max(-.11,Math.min(1,initial));
  const t=Math.max(0,seconds);
  // A new tap during compression briefly releases the head before pressing
  // again, so fast clicking produces separate pulses instead of a held pose.
  if(t<.025&&initial>.2)return initial*(1-.65*smooth(t/.025));
  if(t<.075){
    const start=initial>.2?.025:0,from=initial>.2?initial*.35:initial;
    const u=clamp((t-start)/(.075-start));
    return from+(1-from)*(1-(1-u)**3);
  }
  if(t<.095)return 1;
  if(t<.24)return 1-smooth((t-.095)/.145);
  if(t<.35)return -.11*Math.sin(Math.PI*(t-.24)/.11)**2;
  return 0;
}
