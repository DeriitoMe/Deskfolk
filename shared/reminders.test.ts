import test from 'node:test';
import assert from 'node:assert/strict';
import {isQuestionReminder,shouldShowBubble} from './reminders.ts';
import type {PetEvent} from './types';
const event=(type:PetEvent['type'],extra:Partial<PetEvent>={}):PetEvent=>({id:'x',source:'hook',type,createdAt:new Date().toISOString(),read:false,...extra});
test('automatic permission events and generic info never create interaction bubbles',()=>{
 for(const type of ['info','work_progress','work_started','approval_needed','needs_input'] as const)assert.equal(shouldShowBubble(event(type)),false);
});
test('real native questions and completions remain visible, legacy pet questions do not',()=>{
 assert.equal(isQuestionReminder(event('needs_input',{nativeQuestion:true})),true);
 assert.equal(isQuestionReminder(event('needs_input',{nativeQuestion:true,questionId:'legacy'})),false);
 for(const type of ['turn_ended','task_complete','stage_complete'] as const)assert.equal(shouldShowBubble(event(type)),true);
});
