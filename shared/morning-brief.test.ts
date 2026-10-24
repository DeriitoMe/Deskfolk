import test from 'node:test';
import assert from 'node:assert/strict';
import {MISSING_BRIEF_NOTE,clip,pickBriefNote,rememberNote,sourceName,type BriefData} from './morning-brief.ts';

const now=Date.parse('2026-10-21T02:00:00Z');
const data=():BriefData=>({
  tibo:[
    {id:'x:old',event_status:'in_progress',published_at:'2026-10-07'},
    {id:'official:doc',event_status:'documented',published_at:'2026-10-20'},
    {id:'x:new',event_status:'announced',published_at:'2026-10-20',title:'Tibo：额度刷新已宣布'},
  ],
  news:[
    {id:'n1',title:'Claude Code 2.3 发布：新增插件市场与更快的子代理调度',source:'Claude Code 更新日志',collected_at:'2026-10-20T05:00:00Z'},
    {id:'n0',title:'旧新闻',source:'OpenAI 官方动态',collected_at:'2026-10-01T05:00:00Z'},
  ],
  skills:[
    {id:'s1',name:'adobe-create-mockups',repository:'openai/plugins',stars:7431,stars_delta_7d:93},
    {id:'s2',name:'superpowers-brainstorm',repository:'obra/superpowers',stars:9000,stars_delta_7d:240},
  ],
});

test('a fresh Tibo reset outranks news and skills, and never claims a time',()=>{
  const note=pickBriefNote(data(),[],now);
  assert.equal(note.kind,'tibo');assert.equal(note.id,'tibo:x:new');
  assert.equal(note.message,'Codex\n又要重置了......');
  assert.doesNotMatch(note.message+note.meta,/\d{1,2}:\d{2}|点|PST|UTC/);
});

test('stale or merely documented Tibo items are not news',()=>{
  const d=data();d.tibo=d.tibo.filter(i=>i.id!=='x:new');
  assert.equal(pickBriefNote(d,[],now).kind,'news');
});

test('each reading moves down the list: Tibo, then Agent news, then hot skills in rotation',()=>{
  let seen:string[]=[];const kinds:string[]=[];
  for(let i=0;i<5;i++){const note=pickBriefNote(data(),seen,now);kinds.push(note.kind+':'+note.id);seen=rememberNote(seen,note.id);}
  assert.deepEqual(kinds,['tibo:tibo:x:new','news:news:n1','skill:skill:s2','skill:skill:s1','skill:skill:s2']);
});

test('news copy names the source briefly and keeps the title short',()=>{
  const d=data();d.tibo=[];
  const note=pickBriefNote(d,[],now);
  assert.equal(note.message,'Claude Code\n有新动态......');
  assert([...note.meta].length<=24&&note.meta.endsWith('…'));
});

test('source names lose their "release / official news" suffixes',()=>{
  assert.equal(sourceName('Claude Code 发布'),'Claude Code');
  assert.equal(sourceName('Codex 发布'),'Codex');
  assert.equal(sourceName('OpenAI 官方动态'),'OpenAI');
  assert.equal(sourceName('DeepSeek 官方更新'),'DeepSeek');
  assert.equal(sourceName('Claude Code 更新日志'),'Claude Code');
});

test('a missing brief still gives Mutsumi something to say',()=>{
  assert.equal(pickBriefNote(null,[],now),MISSING_BRIEF_NOTE);
  assert.equal(pickBriefNote({tibo:[],news:[],skills:[]},[],now).message,'今天的晨报\n很安静......');
  assert.deepEqual(rememberNote(['a'],'missing'),['a']);
});

test('clip counts characters, not UTF-16 units',()=>{
  assert.equal(clip('今天的热门技能列表',5),'今天的热…');
  assert.equal(clip('  a   b  ',10),'a b');
  assert.equal(rememberNote(Array.from({length:5},(_,i)=>'x'+i),'x9',3).join(),'x3,x4,x9');
});
