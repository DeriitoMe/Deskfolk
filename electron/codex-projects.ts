import {readFile, stat} from 'node:fs/promises';
import {isAbsolute, join, win32} from 'node:path';

const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const identity=(value:unknown):string|undefined=>typeof value==='string'&&uuid.test(value)?value.toLowerCase():undefined;
const rootPath=(value:unknown):boolean=>typeof value==='string'&&value.length>0&&!value.includes('\0')&&(isAbsolute(value)||win32.isAbsolute(value));

function validSections(value:unknown):value is Record<string,unknown>{
  if(!record(value))return false;
  // Missing sections are a valid empty catalog. Wrong section types can be an
  // incomplete Codex write and must not replace the last successful snapshot.
  return ['local-projects','thread-project-assignments','thread-project-membership-host-ids'].every(key=>value[key]===undefined||record(value[key]));
}

/** Select stable local project IDs only; never retain chat bodies or names. */
export function parseCodexProjectAssignments(value:unknown):Map<string,string>{
  const assignments=new Map<string,string>();
  if(!validSections(value))return assignments;
  const projects=value['local-projects']??{};
  const threads=value['thread-project-assignments']??{};
  const hosts=value['thread-project-membership-host-ids'] as Record<string,unknown>|undefined;
  const memberships=new Map<string,unknown>();
  for(const [key,host] of Object.entries(hosts??{})){
    const sessionId=identity(key);if(sessionId)memberships.set(sessionId,host);
  }
  const available=new Set<string>();
  for(const [key,project] of Object.entries(projects)){
    const id=identity(key);
    if(!id||!record(project)||identity(project.id)!==id||!Array.isArray(project.rootPaths)||!project.rootPaths.some(rootPath))continue;
    available.add(id);
  }
  for(const [key,assignment] of Object.entries(threads)){
    const sessionId=identity(key);
    if(!sessionId||!record(assignment)||assignment.projectKind!=='local')continue;
    const host=memberships.get(sessionId);
    // Missing membership is used by older local chats. Explicit remote/unknown
    // hosts and malformed memberships cannot establish a local sidebar ID.
    if(memberships.has(sessionId)&&(typeof host!=='string'||(host!=='local'&&!host.startsWith('local:'))))continue;
    const projectId=identity(assignment.projectId);
    if(projectId&&available.has(projectId))assignments.set(sessionId,`codex-local:${projectId}`);
  }
  return assignments;
}

/** Read Codex's local sidebar assignments without changing its state file. */
export class CodexProjectCatalog {
  private file:string;
  private signature?:string;
  private assignments=new Map<string,string>();
  private refreshing?:Promise<void>;

  constructor(home:string){this.file=join(home,'.codex-global-state.json');}

  refresh():Promise<void>{
    if(this.refreshing)return this.refreshing;
    const pending=this.read();
    this.refreshing=pending;
    void pending.finally(()=>{if(this.refreshing===pending)this.refreshing=undefined;});
    return pending;
  }

  private async read():Promise<void>{
    try{
      const before=await stat(this.file);
      const signature=`${before.mtimeMs}:${before.size}`;
      if(signature===this.signature||before.size>32*1024*1024)return;
      const value:unknown=JSON.parse(await readFile(this.file,'utf8'));
      if(!validSections(value))return;
      const after=await stat(this.file);
      // Codex can replace this file while it is read. Retry on the next poll
      // instead of installing a snapshot assembled across different writes.
      if(after.mtimeMs!==before.mtimeMs||after.size!==before.size)return;
      this.assignments=parseCodexProjectAssignments(value);
      this.signature=signature;
    }catch{
      // Atomic replacement and partially written JSON are transient. Keep only
      // the last verified ID map, leave the signature untouched, and retry even
      // if the next stat reports the same size/mtime. A valid deletion applies.
    }
  }

  projectId(sessionId:string,_cwd?:string):string|undefined{
    const id=identity(sessionId);
    // Worktrees and turns can change cwd while retaining a sidebar project.
    // Directory fallbacks remain the lifecycle consumer's responsibility.
    return id?this.assignments.get(id):undefined;
  }
}
