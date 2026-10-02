import type { PetEvent } from '../shared/types';

/** Events accepted during document startup wait for its installed listeners. */
export class RendererEventQueue {
  private ready=false;
  private pending:PetEvent[]=[];
  private send:(event:PetEvent)=>void;

  constructor(send:(event:PetEvent)=>void) { this.send=send; }

  deliver(event:PetEvent):void {
    if(this.ready)this.send(event);
    else this.pending.push(event);
  }

  reset():void { this.ready=false; }

  makeReady(accept:(event:PetEvent)=>boolean=()=>true):number {
    const events=this.pending;
    this.pending=[];
    this.ready=true;
    let delivered=0;
    for(const event of events)if(accept(event)){this.send(event);delivered++;}
    return delivered;
  }
}
