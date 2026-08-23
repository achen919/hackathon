import { createHash, randomBytes } from 'node:crypto';
import { isSafeArcadeDocument } from './arcade-game.mjs';

export const GENERATED_TEMPLATE_ENGINE = 'generated-template-v1';
export const GENERATED_TEMPLATE_BRIDGE = 'PairPlayTemplate-v1';
export const GENERATED_TEMPLATE_IDS = Object.freeze([
  'profile-riddle',
  'keyword-wheel',
  'rapid-choice',
]);

const ARTIFACT_ID_PATTERN = /^artifact_[A-Za-z0-9_-]{32,80}$/;
const CODE_HASH_PATTERN = /^[a-f0-9]{64}$/;
const REQUIRED_CONTROLS = Object.freeze({
  'profile-riddle': Object.freeze(['profile.select', 'profile.submit']),
  'keyword-wheel': Object.freeze(['wheel.spin', 'wheel.next']),
  'rapid-choice': Object.freeze(['rapid.answer', 'rapid.timeout']),
});

const FALLBACK_DOCUMENT = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no"><meta name="pairplay-template" content="__TEMPLATE__"><title>双人破冰游戏</title><style>
*{box-sizing:border-box}html,body{margin:0;min-height:100%;background:__BACKGROUND__;color:__FOREGROUND__;font-family:system-ui,sans-serif}body{display:grid;place-items:center;padding:14px}.shell{width:min(100%,520px);min-height:430px;border:2px solid __FOREGROUND__;border-radius:28px;padding:18px;background:__PANEL__;box-shadow:10px 10px 0 __SHADOW__;overflow:hidden}.eyebrow{font-size:12px;letter-spacing:.14em;text-transform:uppercase;opacity:.7}.title{font-size:25px;margin:6px 0 4px}.hint{min-height:44px;margin:0 0 14px;opacity:.72}.stage{display:grid;gap:12px}.row{display:grid;gap:8px;padding:12px;border:1px solid __LINE__;border-radius:18px}.row strong{font-size:14px}.options{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}.options.two{grid-template-columns:repeat(2,minmax(0,1fr))}button{border:1px solid __FOREGROUND__;border-radius:14px;min-height:48px;padding:8px;background:__BUTTON__;color:__FOREGROUND__;font:700 13px system-ui;touch-action:manipulation}button:not(.dial-choice):active,button.selected{transform:translateY(2px);background:__FOREGROUND__;color:__BACKGROUND__}.primary{width:100%;margin-top:14px;background:__ACCENT__;color:__ACCENT_TEXT__;border-color:__ACCENT__}.profile-wheels{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.profile-turn{text-align:center;min-width:0}.profile-turn strong{display:block;margin-bottom:6px;font-size:12px}.profile-dial{position:relative;width:100%;aspect-ratio:1;border:3px solid #111;border-radius:50%;overflow:hidden;background:#fff;box-shadow:3px 3px 0 #111}.dial-choice{position:absolute;inset:0;width:100%;height:100%;min-height:0;padding:0;border:0;border-radius:50%;clip-path:polygon(50% 50%,100% 0,100% 100%);transform:rotate(var(--turn));transform-origin:center;background:#fff;color:#111}.dial-choice:nth-child(even){background:#111;color:#fff}.dial-choice[aria-pressed=true]{background:#9b9b9b;color:#fff}.dial-choice span{position:absolute;right:8%;top:44%;font-size:17px;transform:rotate(var(--counterturn))}.dial-center{pointer-events:none;position:absolute;inset:35%;display:grid;place-items:center;border:2px solid #111;border-radius:50%;background:#fff;color:#111;font-size:10px;font-weight:900}.dial-caption{min-height:42px;margin-top:7px;font-size:10px;line-height:1.3}.wheel{width:244px;height:244px;margin:4px auto 10px;border:8px solid __FOREGROUND__;border-radius:50%;display:grid;place-items:center;background:conic-gradient(__FOREGROUND__ 0 25%,__BACKGROUND__ 25% 50%,__FOREGROUND__ 50% 75%,__BACKGROUND__ 75%);transition:transform 1.1s cubic-bezier(.16,.7,.2,1)}.wheel span{display:grid;place-items:center;width:92px;height:92px;border-radius:50%;background:__PANEL__;border:3px solid __FOREGROUND__;text-align:center;font-weight:900}.cards{display:grid;grid-template-columns:1fr 1fr;gap:12px}.cards button{min-height:145px;font-size:18px}.timer{height:8px;border-radius:99px;background:__LINE__;overflow:hidden}.timer i{display:block;height:100%;width:var(--left,100%);background:__ACCENT__}.status{min-height:22px;text-align:center;margin-top:10px;font-size:13px;opacity:.75}@media(max-width:380px){.shell{padding:14px;border-radius:22px}.profile-wheels{gap:5px}.profile-dial{border-width:2px}.dial-choice span{font-size:13px}.wheel{width:210px;height:210px}.options{grid-template-columns:1fr}.cards button{min-height:115px}}
</style></head><body><main class="shell"><div class="eyebrow" id="eyebrow">AI GENERATED · 双人局</div><h1 class="title" id="title">正在连接游戏</h1><p class="hint" id="hint">玩法和结果由主页面安全同步</p><section class="stage" id="stage"></section><button class="primary" id="primary" type="button">开始</button><div class="status" id="status">等待 host.init</div></main><script>
'use strict';(()=>{const fallbackTemplate='__TEMPLATE__',title=document.getElementById('title'),hint=document.getElementById('hint'),stage=document.getElementById('stage'),primary=document.getElementById('primary'),status=document.getElementById('status');let channel='',template=fallbackTemplate,state={},selections=[-1,-1,-1],rotation=0,lastFrame=0,rapidFill=null,rapidDeadline=0,rapidSeconds=8,primaryAction=()=>{};
const send=(type,extra={})=>{if(channel)parent.postMessage({pairplay:1,type,channel,...extra},'*')};const input=(control,value)=>send('game.input',{control,value});const text=(value,fallback)=>typeof value==='string'&&value.trim()?value:fallback;const list=value=>Array.isArray(value)?value:[];
function button(label,action,selected=false){const node=document.createElement('button');node.type='button';node.textContent=label;node.className=selected?'selected':'';node.addEventListener('click',action);return node}
function profile(){title.textContent=text(state.title,'三轮黑白转盘，猜猜 TA');hint.textContent='点击每个圆盘的一块扇区，三轮各选一个最像 TA 的日常片段。';stage.replaceChildren();const mechanics=state.mechanics||state;const groups=list(state.choiceGroups).length?list(state.choiceGroups):list(mechanics.choiceGroups);const wheels=document.createElement('div');wheels.className='profile-wheels';groups.slice(0,3).forEach((group,slot)=>{const turn=document.createElement('div');turn.className='profile-turn';const heading=document.createElement('strong');heading.textContent='第 '+String(slot+1)+' 轮';const dial=document.createElement('div');dial.className='profile-dial';const choices=list(group.options).slice(0,3);choices.forEach((option,index)=>{const sector=button(String(index+1),()=>{selections[slot]=index;input('profile.select',{slot,optionIndex:index});profile()});sector.className='dial-choice';sector.setAttribute('aria-label',String(option));sector.setAttribute('aria-pressed',String(selections[slot]===index));sector.style.setProperty('--turn',String(index*120)+'deg');sector.style.setProperty('--counterturn',String(index*-120)+'deg');const number=document.createElement('span');number.textContent=String(index+1);sector.replaceChildren(number);dial.appendChild(sector)});const center=document.createElement('div');center.className='dial-center';center.textContent=selections[slot]<0?'选择':String(selections[slot]+1);dial.appendChild(center);const caption=document.createElement('div');caption.className='dial-caption';caption.textContent=selections[slot]<0?choices.map((option,index)=>String(index+1)+' '+String(option)).join(' · '):String(choices[selections[slot]]);turn.append(heading,dial,caption);wheels.appendChild(turn)});stage.appendChild(wheels);primary.textContent='提交三个猜测';primary.disabled=selections.some(value=>value<0);primaryAction=()=>input('profile.submit')}
function wheel(){title.textContent=text(state.title,'关键词深挖转盘');hint.textContent='落点由服务器决定，两个人会看到同一个结果。';stage.replaceChildren();const disk=document.createElement('div');disk.className='wheel';disk.style.transform='rotate('+String(Number(state.rotationDeg)||rotation)+'deg)';const label=document.createElement('span');const segments=list(state.segments).length?list(state.segments):list(state.mechanics&&state.mechanics.segments);const selected=segments.find(item=>item&&item.id===state.selectedSegmentId);label.textContent=selected?text(selected.keyword,'已选中'):segments.map(item=>text(item&&item.keyword,'')).filter(Boolean).slice(0,2).join(' · ')||'转一下';disk.appendChild(label);stage.appendChild(disk);primary.textContent=selected?'再转一次':'转动共享转盘';primary.disabled=state.canSpin===false;primaryAction=()=>{rotation+=1440;disk.style.transform='rotate('+String(rotation)+'deg)';input('wheel.spin')};if(selected){const questions=list(selected.followUps);const question=document.createElement('div');question.className='row';const heading=document.createElement('strong');heading.textContent='现在聊聊';const copy=document.createElement('div');copy.textContent=text(questions[Number(state.followUpIndex)||0],text(selected.prompt,'说说你想到的第一个画面。'));question.append(heading,copy);stage.appendChild(question);const next=button('换一个问题',()=>input('wheel.next'));stage.appendChild(next)}}
function updateRapidTimer(){if(!rapidFill)return;const remaining=rapidDeadline?Math.max(0,rapidDeadline-Date.now()):rapidSeconds*1000;const percent=Math.min(100,remaining/(rapidSeconds*10));rapidFill.style.setProperty('--left',String(percent)+'%');rapidFill.parentElement&&rapidFill.parentElement.setAttribute('aria-valuenow',String(Math.round(percent)))}
function rapid(){const questions=list(state.questions);const me=state.me||{};const question=questions.find(item=>item&&item.id===me.currentQuestionId)||questions[Number(me.answeredCount)||0];title.textContent=text(state.title,'极限 2 选 1');hint.textContent=question?text(question.prompt,'凭直觉选一个'):text(state.phase==='revealed'?'答案已揭晓':'等待下一题','等待下一题');stage.replaceChildren();const timer=document.createElement('div');timer.className='timer';timer.setAttribute('role','progressbar');timer.setAttribute('aria-label','本题剩余时间');timer.setAttribute('aria-valuemin','0');timer.setAttribute('aria-valuemax','100');const fill=document.createElement('i');rapidFill=fill;rapidSeconds=Math.max(3,Math.min(15,Number(state.roundSeconds)||8));rapidDeadline=Number(me.deadlineAtMs)||0;timer.appendChild(fill);updateRapidTimer();stage.appendChild(timer);if(question){const cards=document.createElement('div');cards.className='cards';list(question.options).slice(0,2).forEach((option,index)=>cards.appendChild(button((index===0?'A · ':'B · ')+String(option),()=>input('rapid.answer',{questionId:question.id,answer:index})))) ;stage.appendChild(cards);primary.textContent='跳过本题';primaryAction=()=>input('rapid.timeout',{questionId:question.id})}else{primary.textContent='等待同步';primaryAction=()=>{}}}
function render(){status.textContent=channel?'已安全连接 · '+template:'等待 host.init';if(template==='profile-riddle')profile();else if(template==='keyword-wheel')wheel();else rapid()}
primary.addEventListener('click',()=>primaryAction());addEventListener('message',event=>{if(event.source!==parent||!event.data||event.data.pairplay!==1)return;const data=event.data;if(data.type==='host.init'){channel=String(data.channel||'');template=String(data.templateId||data.mode||fallbackTemplate);state=data.state||{};render();send('game.ready',{})}else if(channel&&data.channel===channel&&data.type==='host.sync'){state=data.state||state;render()}else if(channel&&data.channel===channel&&data.type==='host.stop'){status.textContent='本局已结束'}});function animate(now){if(now-lastFrame>100){lastFrame=now;if(template==='rapid-choice'&&channel)updateRapidTimer()}requestAnimationFrame(animate)}parent.postMessage({pairplay:1,type:'game.bootstrap-ready'},'*');animate(0)})();
</script></body></html>`;

function fallbackDocument(templateId, colors) {
  return FALLBACK_DOCUMENT
    .replace('__TEMPLATE__', templateId)
    .replaceAll('__BACKGROUND__', colors.background)
    .replaceAll('__FOREGROUND__', colors.foreground)
    .replaceAll('__PANEL__', colors.panel)
    .replaceAll('__SHADOW__', colors.shadow)
    .replaceAll('__LINE__', colors.line)
    .replaceAll('__BUTTON__', colors.button)
    .replaceAll('__ACCENT__', colors.accent)
    .replaceAll('__ACCENT_TEXT__', colors.accentText);
}

export const FALLBACK_GENERATED_TEMPLATE_DOCUMENTS = Object.freeze({
  'profile-riddle': fallbackDocument('profile-riddle', {
    background: '#f4f4f1', foreground: '#111111', panel: '#ffffff', shadow: '#111111',
    line: '#b8b8b2', button: '#ffffff', accent: '#111111', accentText: '#ffffff',
  }),
  'keyword-wheel': fallbackDocument('keyword-wheel', {
    background: '#fff5e8', foreground: '#2b1638', panel: '#fffdf8', shadow: '#2b1638',
    line: '#dcc7e8', button: '#fff9f0', accent: '#7b3ff2', accentText: '#ffffff',
  }),
  'rapid-choice': fallbackDocument('rapid-choice', {
    background: '#fff0f4', foreground: '#351522', panel: '#fffafd', shadow: '#6d2540',
    line: '#efbfd0', button: '#ffffff', accent: '#e94f7b', accentText: '#ffffff',
  }),
});

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value, keys) {
  return isRecord(value) && Object.keys(value).length === keys.length &&
    Object.keys(value).every((key) => keys.includes(key));
}

export function isSafeGeneratedTemplateDocument(document, templateId) {
  return GENERATED_TEMPLATE_IDS.includes(templateId) &&
    isSafeArcadeDocument(document) &&
    document.includes(`<meta name="pairplay-template" content="${templateId}">`) &&
    REQUIRED_CONTROLS[templateId].every((control) => document.includes(`'${control}'`) || document.includes(`"${control}"`));
}

export function buildGeneratedTemplateRenderer(document, templateId) {
  if (!isSafeGeneratedTemplateDocument(document, templateId)) {
    const error = new Error('Generated template renderer did not pass the safe document contract');
    error.code = 'INVALID_GENERATED_TEMPLATE_RENDERER';
    error.status = 400;
    throw error;
  }
  return {
    engine: GENERATED_TEMPLATE_ENGINE,
    bridge: GENERATED_TEMPLATE_BRIDGE,
    artifact: {
      artifactId: `artifact_${randomBytes(24).toString('base64url')}`,
      codeHash: createHash('sha256').update(document).digest('hex'),
      document,
    },
  };
}

export function buildFallbackGeneratedTemplateRenderer(templateId) {
  const document = FALLBACK_GENERATED_TEMPLATE_DOCUMENTS[templateId];
  if (!document) throw new TypeError('Unsupported generated template');
  return buildGeneratedTemplateRenderer(document, templateId);
}

export function assertGeneratedTemplateRenderer(renderer, templateId) {
  const invalid = () => {
    const error = new Error('Invalid generated-template-v1 renderer');
    error.code = 'INVALID_GENERATED_TEMPLATE_RENDERER';
    error.status = 400;
    throw error;
  };
  if (
    !exactKeys(renderer, ['engine', 'bridge', 'artifact']) ||
    renderer.engine !== GENERATED_TEMPLATE_ENGINE ||
    renderer.bridge !== GENERATED_TEMPLATE_BRIDGE ||
    !exactKeys(renderer.artifact, ['artifactId', 'codeHash', 'document']) ||
    !ARTIFACT_ID_PATTERN.test(renderer.artifact.artifactId) ||
    !CODE_HASH_PATTERN.test(renderer.artifact.codeHash) ||
    !isSafeGeneratedTemplateDocument(renderer.artifact.document, templateId) ||
    createHash('sha256').update(renderer.artifact.document).digest('hex') !== renderer.artifact.codeHash
  ) invalid();
  return structuredClone(renderer);
}

export function hasGeneratedTemplateRenderer(game) {
  return GENERATED_TEMPLATE_IDS.includes(game?.templateId) && game?.renderer?.engine === GENERATED_TEMPLATE_ENGINE;
}

export function attachGeneratedTemplateRenderer(game, document) {
  if (!GENERATED_TEMPLATE_IDS.includes(game?.templateId)) throw new TypeError('Game template does not support generated renderers');
  return {
    ...structuredClone(game),
    renderer: buildGeneratedTemplateRenderer(document, game.templateId),
  };
}

export function attachFallbackGeneratedTemplateRenderer(game) {
  if (!GENERATED_TEMPLATE_IDS.includes(game?.templateId)) return structuredClone(game);
  return {
    ...structuredClone(game),
    renderer: buildFallbackGeneratedTemplateRenderer(game.templateId),
  };
}

export function publicGeneratedTemplateGame(game, runtimeBasePath) {
  const projected = structuredClone(game);
  if (!hasGeneratedTemplateRenderer(projected)) return projected;
  projected.renderer = publicGeneratedTemplateRenderer(projected.renderer, projected.templateId, runtimeBasePath);
  return projected;
}

export function publicGeneratedTemplateRenderer(renderer, templateId, runtimeBasePath) {
  const invalid = () => {
    const error = new Error('Invalid public generated-template-v1 renderer');
    error.code = 'INVALID_GENERATED_TEMPLATE_RENDERER';
    error.status = 400;
    throw error;
  };
  if (
    !GENERATED_TEMPLATE_IDS.includes(templateId) ||
    !exactKeys(renderer, ['engine', 'bridge', 'artifact']) ||
    renderer.engine !== GENERATED_TEMPLATE_ENGINE ||
    renderer.bridge !== GENERATED_TEMPLATE_BRIDGE ||
    !isRecord(renderer.artifact)
  ) invalid();
  const artifactId = renderer.artifact.artifactId;
  const codeHash = renderer.artifact.codeHash;
  if (!ARTIFACT_ID_PATTERN.test(artifactId) || !CODE_HASH_PATTERN.test(codeHash)) invalid();
  const runtimePath = `${runtimeBasePath}/${artifactId}`;
  if ('document' in renderer.artifact) {
    assertGeneratedTemplateRenderer(renderer, templateId);
  } else if (
    !exactKeys(renderer.artifact, ['artifactId', 'codeHash', 'runtimePath']) ||
    renderer.artifact.runtimePath !== runtimePath
  ) invalid();
  return {
    engine: GENERATED_TEMPLATE_ENGINE,
    bridge: GENERATED_TEMPLATE_BRIDGE,
    artifact: { artifactId, codeHash, runtimePath },
  };
}

export function generatedTemplateArtifact(game) {
  if (!hasGeneratedTemplateRenderer(game)) return null;
  assertGeneratedTemplateRenderer(game.renderer, game.templateId);
  return structuredClone(game.renderer.artifact);
}
