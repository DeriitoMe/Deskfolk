import {open, readdir, stat} from 'node:fs/promises';
import {join, basename} from 'node:path';
import type {PetEvent} from '../shared/types';

/** Only structural lifecycle records are consumed; message/tool bodies are ignored. */
export function lifecycleEvent(record:any, sessionId:string, cwd?:string, subagent=false):PetEvent|null {
  const p=record?.payload;
  if(record?.type!=='event_msg' || !p?.turn_id || !['task_started','task_complete','turn_aborted'].includes(p.type))return null;
  if(!Number.isFinite(Date.parse(record.timestamp)))return null;
  const type=p.type==='task_started'?'work_started':p.type==='turn_aborted'||p.error?'interrupted':'turn_ended';
  return {id:`log:${sessionId}:${p.turn_id}:${p.type}`,source:'codex-log',type,
    sessionId,turnId:p.turn_id,projectPath:cwd,project:cwd?basename(cwd):undefined,
    isSubagent:subagent,createdAt:record.timestamp,read:false};
}

interface InputCall {
  turnId:string;
  asynchronous:boolean;
  remaining:Set<number>;
}
interface ObservedSession {
  file?:string;offset:number;pending:string;cwd?:string;subagent?:boolean;turnId?:string;
  inputs:Map<string,InputCall>;
  search?:{end:number;size:number};
}

export class CodexLifecycleObserver {
  private sessions=new Map<string,ObservedSession>();
  private files:string[]=[];private refreshed=0;private timer?:ReturnType<typeof setInterval>;private busy=false;
  private seenFiles=new Map<string,{size:number;mtime:number}>();
  private metadataCache=new Map<string,any>();
  private discoveryQueue:string[]=[];
  private root:string;private emit:(event:PetEvent)=>void;
  constructor(root:string,emit:(event:PetEvent)=>void){this.root=root;this.emit=emit;}
  track(id?:string){if(id&&/^[a-z0-9-]{20,80}$/i.test(id)&&!this.sessions.has(id))this.sessions.set(id,{offset:0,pending:'',inputs:new Map()});}
  start(){this.timer=setInterval(()=>void this.poll(),750);void this.poll();}
  stop(){clearInterval(this.timer);}
  private async catalog(dir:string,depth=0):Promise<string[]>{
    if(depth>4)return [];const out:string[]=[];
    for(const x of await readdir(dir,{withFileTypes:true}).catch(()=>[])){
      const p=join(dir,x.name);if(x.isDirectory())out.push(...await this.catalog(p,depth+1));
      else if(x.name.endsWith('.jsonl'))out.push(p);
    }return out;
  }
  private async metadata(file:string):Promise<any>{
    if(this.metadataCache.has(file))return this.metadataCache.get(file);
    // Desktop session_meta embeds instructions; the observed header is ~20 KB.
    // A fixed 16 KB read silently discarded otherwise valid lifecycle logs.
    const f=await open(file,'r'),parts:Buffer[]=[];let offset=0;
    try{
      while(offset<16*1024*1024){
        const chunk=Buffer.alloc(64*1024),n=(await f.read(chunk,0,chunk.length,offset)).bytesRead;
        if(!n)return undefined;
        const end=chunk.subarray(0,n).indexOf(10);
        parts.push(chunk.subarray(0,end<0?n:end));offset+=n;
        if(end>=0){
          const record=JSON.parse(Buffer.concat(parts).toString('utf8'));
          if(record.type!=='session_meta')return undefined;
          // Cache identity only. Instructions and other header content are not
          // needed for observing lifecycle transitions and can be very large.
          const metadata={id:record.payload?.id,cwd:record.payload?.cwd,
            source:typeof record.payload?.source==='object'&&record.payload.source?.subagent?{subagent:{}}:undefined};
          this.metadataCache.set(file,metadata);return metadata;
        }
      }
      return undefined;
    }catch{return undefined;}finally{await f.close();}
  }
  private async discover(){
    const entries=await Promise.all(this.files.map(async file=>{
      const value=await stat(file).catch(()=>undefined);
      return value?{file,size:value.size,mtime:value.mtimeMs}:undefined;
    }));
    const latest=entries.filter((x):x is NonNullable<typeof x>=>!!x).sort((a,b)=>b.mtime-a.mtime);
    // Startup examines a bounded set of recent files. Afterward every newly
    // created or changed file is queued; mtime only schedules reads, never WORK.
    const candidates=this.seenFiles.size===0?latest.slice(0,32):latest.filter(x=>{
      const prior=this.seenFiles.get(x.file);return !prior||prior.size!==x.size||prior.mtime!==x.mtime;
    });
    this.seenFiles=new Map(latest.map(x=>[x.file,{size:x.size,mtime:x.mtime}]));
    const present=new Set(latest.map(x=>x.file));
    for(const file of this.metadataCache.keys())if(!present.has(file))this.metadataCache.delete(file);
    this.discoveryQueue=[...new Set([...candidates.map(x=>x.file),...this.discoveryQueue])].filter(file=>present.has(file));
    for(const file of this.discoveryQueue.splice(0,8)){
      const meta=await this.metadata(file).catch(()=>undefined);
      if(typeof meta?.source==='object'&&meta.source?.subagent)continue;
      this.track(meta?.id);
    }
  }
  private async initialOffset(file:string,end:number):Promise<{offset?:number;end:number}>{
    // A long tool/message body may fill the tail after task_started. Search
    // backward for actual lifecycle evidence rather than guessing from age.
    const width=4*1024*1024,f=await open(file,'r');let read=0;
    try{while(end>0&&read<8*1024*1024){
      const start=Math.max(0,end-width),buffer=Buffer.alloc(end-start);
      const n=(await f.read(buffer,0,buffer.length,start)).bytesRead;read+=n;
      const lines=buffer.subarray(0,n).toString('utf8').split('\n');if(start)lines.shift();
      // Replay from the latest actual start so request call IDs can be paired
      // with native replies, including when the pet starts during that turn.
      if(lines.some(line=>{if(!line.includes('"event_msg"')||!line.includes('"task_started"'))return false;try{const r=JSON.parse(line);return !!lifecycleEvent(r,'scan')&&r.payload.type==='task_started'}catch{return false}}))return {offset:start,end:0};
      if(start===0)return {offset:0,end:0};end=start+Math.min(16384,width/2);
    }return end?{end}:{offset:0,end:0};}finally{await f.close();}
  }
  private inputEvent(record:any,id:string,s:ObservedSession,type:'needs_input'|'input_resolved',callId:string,turnId:string):PetEvent {
    return {id:`log:${id}:${turnId}:${type}:${callId}`,source:'codex-log',type,
      sessionId:id,turnId,projectPath:s.cwd,project:s.cwd?basename(s.cwd):undefined,
      isSubagent:s.subagent,nativeQuestion:type==='needs_input',createdAt:record.timestamp,read:false};
  }
  private consume(record:any,id:string,s:ObservedSession){
    const lifecycle=lifecycleEvent(record,id,s.cwd,s.subagent);
    if(lifecycle){
      if(lifecycle.type==='work_started'){
        if(s.turnId!==lifecycle.turnId)s.inputs.clear();s.turnId=lifecycle.turnId;
      }else if(lifecycle.type==='interrupted')s.inputs.clear();
      this.emit(lifecycle);return;
    }
    if(record?.type==='turn_context'&&record.payload?.turn_id===s.turnId&&typeof record.payload.cwd==='string'&&Number.isFinite(Date.parse(record.timestamp))){
      s.cwd=record.payload.cwd;
      this.emit({id:`log:${id}:${s.turnId}:context:${record.timestamp}`,source:'codex-log',type:'work_progress',
        sessionId:id,turnId:s.turnId,projectPath:s.cwd,project:basename(record.payload.cwd),isSubagent:s.subagent,createdAt:record.timestamp,read:false});
      return;
    }
    if(record?.type!=='response_item'||!Number.isFinite(Date.parse(record.timestamp)))return;
    const p=record.payload;
    if(p?.type==='function_call'&&/^(?:functions\.)?request_user_input(?:_async)?$/.test(p.name??'')&&s.turnId&&typeof p.call_id==='string'){
      let argumentsValue;try{argumentsValue=JSON.parse(p.arguments)}catch{return}
      if(!Array.isArray(argumentsValue?.questions)||!argumentsValue.questions.length)return;
      const asynchronous=p.name.endsWith('_async');
      s.inputs.set(p.call_id,{turnId:s.turnId,asynchronous,remaining:new Set(argumentsValue.questions.map((_:unknown,index:number)=>index))});
      if(!asynchronous)this.emit(this.inputEvent(record,id,s,'needs_input',p.call_id,s.turnId));
      return;
    }
    if(p?.type==='function_call_output'){
      const input=s.inputs.get(p.call_id);if(!input)return;
      if(input.asynchronous){
        let output;try{output=JSON.parse(p.output)}catch{output=undefined}
        if(output?.accepted===true)this.emit(this.inputEvent(record,id,s,'needs_input',p.call_id,input.turnId));
        else {
          s.inputs.delete(p.call_id);
          if(![...s.inputs.values()].some(x=>x.turnId===input.turnId))this.emit(this.inputEvent(record,id,s,'input_resolved',p.call_id,input.turnId));
        }
        return; // An asynchronous acknowledgement contains no user answer.
      }
      s.inputs.delete(p.call_id);
      if(![...s.inputs.values()].some(x=>x.turnId===input.turnId))this.emit(this.inputEvent(record,id,s,'input_resolved',p.call_id,input.turnId));
      return;
    }
    if(p?.type!=='message'||p.role!=='user'||!Array.isArray(p.content))return;
    // The native desktop reply has a dedicated envelope and an encoded call ID.
    // Ordinary user messages and inter-agent messages cannot resolve questions.
    const content=p.content.filter((x:any)=>x.type==='input_text').map((x:any)=>x.text??'').join('\n').trim();
    const envelope=/^<send_user_message_question_reply>\s*([\s\S]*?)\s*<\/send_user_message_question_reply>$/.exec(content);
    if(!envelope)return;
    let replies;try{replies=JSON.parse(envelope[1])}catch{return}
    if(!Array.isArray(replies))return;
    let resolved:{callId:string;turnId:string}|undefined;
    const replyTurn=p.internal_chat_message_metadata_passthrough?.turn_id;
    for(const reply of replies){
      if(typeof reply?.answer!=='string'||!reply.answer.trim())continue;
      let tuple;try{tuple=JSON.parse(reply.questionItemId)}catch{continue}
      if(!Array.isArray(tuple)||tuple.length!==3||tuple[0]!=='request_user_input_async'||typeof tuple[1]!=='string'||!Number.isInteger(tuple[2]))continue;
      const input=s.inputs.get(tuple[1]);
      if(!input?.asynchronous||input.turnId!==s.turnId||(replyTurn&&replyTurn!==input.turnId)||!input.remaining.has(tuple[2]))continue;
      input.remaining.delete(tuple[2]);
      if(!input.remaining.size){s.inputs.delete(tuple[1]);resolved={callId:tuple[1],turnId:input.turnId};}
    }
    if(resolved&&![...s.inputs.values()].some(x=>x.turnId===resolved!.turnId))this.emit(this.inputEvent(record,id,s,'input_resolved',resolved.callId,resolved.turnId));
  }
  private relevant(line:string,s:ObservedSession):boolean {
    if(line.includes('"turn_context"'))return true;
    if(line.includes('"event_msg"')&&/(?:"task_started"|"task_complete"|"turn_aborted")/.test(line))return true;
    if(!line.includes('"response_item"'))return false;
    if(line.includes('send_user_message_question_reply'))return true;
    if(line.includes('"function_call"')&&/request_user_input(?:_async)?"/.test(line))return true;
    return line.includes('"function_call_output"')&&[...s.inputs.keys()].some(id=>line.includes(`"${id}"`));
  }
  async poll(){
    if(this.busy)return;this.busy=true;
    try{
      if(Date.now()-this.refreshed>5000){this.files=await this.catalog(this.root);await this.discover();this.refreshed=Date.now();}
      else for(const file of this.discoveryQueue.splice(0,8)){
        const meta=await this.metadata(file).catch(()=>undefined);
        if(!(typeof meta?.source==='object'&&meta.source?.subagent))this.track(meta?.id);
      }
      for(const [id,s] of this.sessions){
        const entries=await Promise.all(this.files.filter(f=>basename(f).includes(id)).map(async file=>{
          const value=await stat(file).catch(()=>undefined);return value?{file,mtime:value.mtimeMs}:undefined;
        }));
        const candidates=entries.filter((x):x is NonNullable<typeof x>=>!!x);
        candidates.sort((a,b)=>b.mtime-a.mtime);
        let selected:{file:string;meta:any}|undefined;
        for(const candidate of candidates){
          if(candidate.file===s.file){selected={file:candidate.file,meta:{id,cwd:s.cwd,source:s.subagent?{subagent:{}}:'vscode'}};break;}
          const meta=await this.metadata(candidate.file);
          if(meta?.id===id){selected={file:candidate.file,meta};break;}
        }
        if(!selected)continue;
        const {file,meta}=selected,size=(await stat(file)).size;
        if(file!==s.file || size<s.offset || (s.search&&size<s.search.size)){
          s.cwd=meta.cwd;s.subagent=typeof meta.source==='object'&&!!meta.source?.subagent;
          s.file=file;s.pending='';s.offset=0;s.search={end:size,size};s.turnId=undefined;s.inputs.clear();
        }
        if(s.search){
          const result=await this.initialOffset(file,s.search.end);
          if(result.offset===undefined){s.search.end=result.end;continue;}
          s.offset=result.offset;s.search=undefined;
          if(s.offset>0)s.pending='__skip_partial__';
        }
        if(size===s.offset)continue;
        const f=await open(file,'r');const data=Buffer.alloc(Math.min(size-s.offset,8*1024*1024));
        const n=(await f.read(data,0,data.length,s.offset)).bytesRead;await f.close();s.offset+=n;
        let chunk=data.subarray(0,n).toString('utf8');
        if(s.pending==='__skip_partial__'){const i=chunk.indexOf('\n');if(i<0)continue;chunk=chunk.slice(i+1);s.pending='';}
        const lines=(s.pending+chunk).split('\n');s.pending=lines.pop()??'';
        for(const line of lines){
          // Skip large conversation bodies before parsing. Lifecycle records are small.
          if(!this.relevant(line,s))continue;
          try{this.consume(JSON.parse(line),id,s);}catch{}
        }
      }
    }catch(error){console.warn('Codex lifecycle read deferred:',(error as Error).message);}finally{this.busy=false;}
  }
}
