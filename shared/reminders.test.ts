import test from 'node:test';
import assert from 'node:assert/strict';
import {isQuestionReminder,shouldShowBubble} from './reminders.ts';
import type {PetEvent} from './types';
const event=(type:PetEvent['type'],extra:Partial<PetEvent>={}):PetEvent=>({id:'x',source:'hook',type,createdAt:new Date().toISOString(),read:false,...extra});
test('automatic permission events and generic info never create interaction bubbles',()=>{
 for(const type of ['info','work_progress','work_started','approval_needed','needs_input'] as const)assert.equal(shouldShowBubble(event(type)),false);
});

test('work voice bubbles require a fresh native start, with no historical or child-task replay',()=>{
 const start=event('work_started',{source:'codex-log'});
 assert.equal(shouldShowBubble(start),true);
 assert.equal(shouldShowBubble({...start,replayed:true}),false);
 assert.equal(shouldShowBubble({...start,isSubagent:true}),false);
 assert.equal(shouldShowBubble({...start,source:'hook'}),false);
 assert.equal(shouldShowBubble({...start,source:'mcp'}),false);
 assert.equal(shouldShowBubble({...start,source:'demo'}),true);
});
test('real native questions and completions remain visible, legacy pet questions do not',()=>{
 const native={source:'codex-log' as const,nativeQuestion:true,sessionId:'session',turnId:'turn',nativeCallId:'question'};
 assert.equal(isQuestionReminder(event('needs_input',native)),true);
 assert.equal(isQuestionReminder(event('needs_input',{nativeQuestion:true,questionId:'legacy'})),false);
 for(const type of ['turn_ended','task_complete','stage_complete'] as const)assert.equal(shouldShowBubble(event(type)),true);
});
test('only a complete native question identity can produce a real interaction bubble',()=>{
 const native:PetEvent=event('needs_input',{source:'codex-log',nativeQuestion:true,sessionId:'session',turnId:'turn',nativeCallId:'question'});
 for(const field of ['sessionId','turnId','nativeCallId'] as const){
  assert.equal(isQuestionReminder({...native,[field]:undefined}),false);
  assert.equal(isQuestionReminder({...native,[field]:' '}),false);
 }
 for(const source of ['hook','mcp'] as const)assert.equal(isQuestionReminder({...native,source}),false);
 assert.equal(isQuestionReminder({...native,nativeQuestion:false}),false);
 assert.equal(isQuestionReminder({...native,isSubagent:true}),false);
 assert.equal(isQuestionReminder({...native,nativeCallId:'legacy:input'}),false);
 for(const source of ['hook','mcp','codex-log'] as const)assert.equal(isQuestionReminder({...native,source,type:'approval_needed',nativeApproval:true}),false);
 assert.equal(isQuestionReminder(event('needs_input',{source:'demo'})),true);
 assert.equal(isQuestionReminder(event('approval_needed',{source:'demo'})),true);
 assert.equal(shouldShowBubble({...native,type:'input_sync'}),false);
});
