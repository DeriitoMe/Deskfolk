import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {EN_MESSAGES, normalizeLanguage, resolveLocale, translate} from './i18n.ts';
import {eventMessage, eventVoiceMessage} from './event-copy.ts';
import {quotaLabel} from './quota-copy.ts';
import {deepSeekBalanceQuota, parseCodexQuota, parseClaudeQuota, unknownCodexQuota, unknownClaudeQuota, unknownDeepSeekQuota} from './quota.ts';
import {localizeBriefNote, pickBriefNote} from './morning-brief.ts';
import {projectDashboard} from './project-dashboard.ts';
import type {PetEvent, PetPreferences} from './types';

test('language migration, invalid values, system mapping and explicit overrides', () => {
  for (const value of [undefined,null,'fr',{},'EN']) assert.equal(normalizeLanguage(value),'system');
  assert.equal(normalizeLanguage('invalid','en'),'en');
  for (const value of ['zh-CN','zh-TW','zh-HK','ZH_cn','zh']) assert.equal(resolveLocale('system',value),'zh-CN');
  for (const value of ['en-US','ja-JP','fr-FR','']) assert.equal(resolveLocale('system',value),'en');
  assert.equal(resolveLocale('en','zh-CN'),'en');
  assert.equal(resolveLocale('zh-CN','en-US'),'zh-CN');
});

test('catalog interpolation preserves supplied content, including placeholder-like values', () => {
  assert.equal(translate('en','项目：{project}',{project:'中文 {time} <b>$&'}),'Project: 中文 {time} <b>$&');
  assert.equal(translate('zh-CN','项目：{project}',{project:'Deskfolk'}),'项目：Deskfolk');
  assert.equal(translate('en','__proto__'),'__proto__');
  assert.equal(translate('en','Unknown copy'),'Unknown copy');
});

test('all static settings and accessible labels have an English entry with matching placeholders', () => {
  const html=readFileSync(new URL('../renderer/index.html',import.meta.url),'utf8');
  for(const match of html.matchAll(/data-i18n(?:-aria)?="([^"]+)"/g)) assert(Object.hasOwn(EN_MESSAGES,match[1]),match[1]);
  for(const [key,value] of Object.entries(EN_MESSAGES)) {
    assert(value.trim(),key);
    assert.deepEqual([...key.matchAll(/\{(\w+)\}/g)].map(m=>m[1]).sort(),[...value.matchAll(/\{(\w+)\}/g)].map(m=>m[1]).sort(),key);
    assert.doesNotMatch(value,/\p{Script=Han}/u,key);
  }
});

const event=(type:PetEvent['type'],extra:Partial<PetEvent>={}):PetEvent=>({id:'test',type,source:'codex-log',createdAt:new Date().toISOString(),read:false,...extra});
test('bubbles change language while audio identities and original event content stay stable', () => {
  for(const type of ['work_started','needs_input','task_complete','turn_ended'] as const) {
    const e=event(type,{message:'原始正文'}),original=structuredClone(e);
    assert.notEqual(eventMessage(e,'en').message,eventMessage(e,'zh-CN').message);
    assert(eventVoiceMessage(e));assert.deepEqual(e,original);
  }
  const custom=event('info',{message:'原始正文 {project}',project:'项目名称',stage:'阶段名称'});
  assert.equal(eventMessage(custom,'en').message,custom.message);
  assert.equal(eventMessage(custom,'en').meta,'项目名称 · 阶段名称');
  assert.equal(eventMessage(event('stage_complete',{source:'demo',project:'桌宠预览',stage:'视觉样机'}),'en').meta,'Companion preview · Preview');
  assert.equal(eventVoiceMessage(event('turn_ended',{outcome:'failed'})),'');
  assert.doesNotMatch(eventMessage(event('interrupted',{outcome:'quota_exhausted'}),'en').message,/\p{Script=Han}/u);
});

test('quota labels preserve numbers, host identity and stale/unavailable distinctions', () => {
  const now=Date.now();
  const value=parseCodexQuota({primary:{window_minutes:300,used_percent:27,resets_at:Math.floor(now/1000)+3600}},'codex-log',new Date(now).toISOString(),now)!;
  assert.equal(quotaLabel(value,'en',now),'5-hour remaining: 73%');
  assert.equal(quotaLabel(value,'zh-CN',now),value.label);
  assert.equal(quotaLabel(value,'en',now+3_700_000),'5-hour remaining: Awaiting refresh');
  assert.equal(quotaLabel(unknownCodexQuota(true),'en'),'5-hour remaining: Loading');
  assert.equal(quotaLabel(unknownClaudeQuota(),'en'),'Current session: Unavailable');
  const claude=parseClaudeQuota({five_hour:{used_percentage:27.4,resets_at:Math.floor(now/1000)+3600}},new Date(now).toISOString(),now)!;
  assert.equal(quotaLabel(claude,'en',now),'Current session: 27%');
  assert.equal(quotaLabel(claude,'zh-CN',now),claude.label);
  assert.equal(quotaLabel(unknownDeepSeekQuota(),'en'),'DeepSeek usage: Unavailable');
  const balance=deepSeekBalanceQuota({total:29.2993781,currency:'CNY',observedAt:null,spentSince:null});
  assert.equal(quotaLabel(balance,'zh-CN'),'DeepSeek 余额: ¥29.30');
  assert.equal(quotaLabel(balance,'en'),'DeepSeek balance: ¥29.30');
});

test('morning brief language changes keep the selected item and external titles', () => {
  const now=Date.now();
  for(const data of [null,{tibo:[],news:[],skills:[]},
    {tibo:[{id:'reset',event_status:'announced',collected_at:new Date(now).toISOString()}],news:[],skills:[]},
    {tibo:[],news:[{id:'news',title:'新闻原文',source:'Claude Code',collected_at:new Date(now).toISOString()}],skills:[]},
    {tibo:[],news:[],skills:[{id:'skill',name:'my-skill',repository:'owner/repo',stars_delta_7d:42}]}]) {
    const note=pickBriefNote(data,[],now),before=structuredClone(note),en=localizeBriefNote(note,'en');
    assert.equal(en.id,note.id);assert.equal(en.kind,note.kind);assert.deepEqual(note,before);
    assert.doesNotMatch(en.message,/\p{Script=Han}/u);
    if(note.kind==='news'&&note.id!=='quiet')assert.equal(en.meta,'新闻原文');
    if(note.kind==='skill')assert(en.meta.includes('(7 days)'));
    assert.equal(localizeBriefNote(note,'zh-CN').message,note.message);
  }
});

test('dashboard translates status but preserves project identity and aggregates', () => {
  const preferences:PetPreferences={language:'en',model:'flat-chibi',outfit:'uniform',scale:1,idleDance:true,reducedMotion:false,bubbleSeconds:8,startWithCodex:false,startWithClaudeCode:false,startWithDeepSeekHarness:false,followAgent:'all',doNotDisturb:false,notificationsEnabled:true,easterEggsEnabled:true};
  const sessions={test:{sessionId:'test',phase:'working' as const,turnId:'turn',nativeTurnId:'turn',projectId:'project',updatedAt:new Date().toISOString()}};
  const options={preferences,bridgeReady:true,projectName:()=> '中文项目',monitor:{state:'watching' as const,lastPollAt:null,lastEventAt:null,observedSessions:1,discoveryPending:0}};
  const zh=projectDashboard(sessions,[],{...options,locale:'zh-CN'}),en=projectDashboard(sessions,[],{...options,locale:'en'});
  assert.equal(en.projects[0].name,'中文项目');assert.equal(en.projects[0].key,zh.projects[0].key);
  assert.equal(en.projects[0].lastEventLabel,'Waiting for status');assert.equal(en.workingProjectCount,zh.workingProjectCount);
});
