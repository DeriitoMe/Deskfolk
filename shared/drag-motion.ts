export const DRAG_CYCLE_SECONDS=4.6;
const smooth=(v:number)=>{v=Math.max(0,Math.min(1,v));return v*v*(3-2*v);};
/** Two distinct efforts, each returning to rest; the seam is fully passive. */
export function dragCycle(t:number){
 const phase=((t%DRAG_CYCLE_SECONDS)+DRAG_CYCLE_SECONDS)%DRAG_CYCLE_SECONDS;
 const effort=(start:number)=>{const u=(phase-start)/.6;return u>0&&u<1?Math.sin(Math.PI*u)**2:0;};
 const kick=effort(1.35)+effort(2.03);
 const squeeze=smooth((phase-1.2)/.15)*(1-smooth((phase-2.63)/.24));
 return {phase,kick,squeeze};
}
