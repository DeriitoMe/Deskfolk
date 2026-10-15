/** Clear catchlights quiver as the tear film gently wells and settles. */
export function tearfulReflection(t:number,reduced=false){
 const phase=t*Math.PI*2/(reduced?7.2:2.6),amount=reduced?.28:1;
 return {alpha:.96,
  water:Math.sin(phase)*6*amount,
  tilt:Math.sin(phase+.75)*5*amount,
  bulge:5+Math.sin(phase*.83+.4)*3*amount,
  sheen:Math.sin(phase*.71-.7)*30*amount};
}
export function tearfulWeight(t:number,duration=4){
 const smooth=(v:number)=>{v=Math.max(0,Math.min(1,v));return v*v*(3-2*v)};
 return smooth(t/.18)*(1-smooth((t-(duration-.45))/.45));
}
