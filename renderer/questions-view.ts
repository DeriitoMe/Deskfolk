import type { PetQuestion } from '../shared/types';
export async function setupQuestionView() {
  document.body.dataset.view='answer';
  document.querySelector('#pet-view')!.setAttribute('hidden','');
  document.querySelector('#settings-view')!.setAttribute('hidden','');
  const main=document.createElement('main');main.className='question-page';
  const heading=document.createElement('h1');heading.textContent='小睦在等你';
  const intro=document.createElement('p');intro.className='question-intro';intro.textContent='选一个方向，或直接写下你的想法。';
  const list=document.createElement('div');main.append(heading,intro,list);document.body.append(main);
  const drafts=new Map<string,string>();
  let previous='';
  const render=(questions:PetQuestion[])=>{
    const signature=JSON.stringify(questions.map(q=>[q.id,q.status]));if(signature===previous)return;previous=signature;
    list.replaceChildren();
    if(!questions.length){const p=document.createElement('p');p.className='question-empty';p.textContent='现在没有待回答的问题。已提交的回答会由 Codex 继续处理。';list.append(p);return;}
    for(const q of questions){
      const card=document.createElement('form');card.className='question-card';card.dataset.questionId=q.id;
      const project=document.createElement('small');project.textContent=q.project||'当前任务';
      const title=document.createElement('h2');title.textContent=q.title;
      const error=document.createElement('p');error.className='question-error';error.setAttribute('role','status');
      card.append(project,title);
      if(q.status==='answered'){
        const p=document.createElement('p');p.textContent='已提交，等待 Codex 接收……';card.append(p);list.append(card);continue;
      }
      const choices=document.createElement('div');choices.className='question-choices';
      const textarea=document.createElement('textarea');textarea.name='answer';textarea.maxLength=4000;textarea.rows=3;
      textarea.placeholder='也可以在这里输入回答';textarea.setAttribute('aria-label','你的回答');textarea.value=drafts.get(q.id)||'';
      textarea.addEventListener('input',()=>{drafts.set(q.id,textarea.value);choices.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed','false'));});
      for(const option of q.options){
        const b=document.createElement('button');b.type='button';b.textContent=option;b.setAttribute('aria-pressed','false');
        b.addEventListener('click',()=>{textarea.value=option;drafts.set(q.id,option);choices.querySelectorAll('button').forEach(n=>n.setAttribute('aria-pressed',String(n===b)));});choices.append(b);
      }
      const actions=document.createElement('div');actions.className='question-actions';
      const submit=document.createElement('button');submit.type='submit';submit.className='primary-button';submit.textContent='发送回答';
      const cancel=document.createElement('button');cancel.type='button';cancel.className='secondary-button';cancel.textContent='取消这个问题';
      cancel.addEventListener('click',async()=>{try{await window.petBridge.cancelQuestion(q.id);}catch(e){error.textContent=String(e);}});
      card.addEventListener('submit',async event=>{event.preventDefault();submit.disabled=true;error.textContent='';
        try {await window.petBridge.answerQuestion(q.id,textarea.value);drafts.delete(q.id);}catch(e){error.textContent=String(e);submit.disabled=false;}
      });actions.append(submit,cancel);card.append(choices,textarea,error,actions);list.append(card);
    }
  };
  window.petBridge.onQuestions(render);render(await window.petBridge.getQuestions());
}
