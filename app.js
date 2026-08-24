const STORAGE_KEY = 'delivery.items.v2';
const state = { items: load(), filter: 'all' };
const $ = id => document.getElementById(id);
const els = {
  addForm:$('addForm'), tracking:$('trackingInput'), carrier:$('carrierInput'), memo:$('memoInput'),
  list:$('parcelList'), empty:$('emptyState'), refreshAll:$('refreshAllBtn'), filters:$('filters'),
  statAll:$('statAll'), statUnknown:$('statUnknown'), statActive:$('statActive'), statDone:$('statDone'),
  bulkDialog:$('bulkDialog'), bulkOpen:$('bulkOpenBtn'), bulkText:$('bulkText'), bulkPreview:$('bulkPreview'),
  bulkAdd:$('bulkAddBtn'), bulkClose:$('bulkCloseBtn'), bulkCancel:$('bulkCancelBtn'), exportBtn:$('exportBtn'),
  detailDialog:$('detailDialog'), detailCarrier:$('detailCarrier'), detailTitle:$('detailTitle'), detailContent:$('detailContent'), detailClose:$('detailCloseBtn'), toast:$('toast')
};

const CARRIERS = {
  cj:{name:'CJ대한통운', url:n=>`https://trace.cjlogistics.com/next/tracking.html?wblNo=${encodeURIComponent(n)}`},
  hanjin:{name:'한진택배', url:n=>`https://www.hanjin.com/kor/CMS/DeliveryMgr/WaybillResult.do?mCode=MN038&wblnumText2=${encodeURIComponent(n)}`},
  lotte:{name:'롯데택배', url:n=>`https://www.lotteglogis.com/home/reservation/tracking/linkView?InvNo=${encodeURIComponent(n)}`},
  logen:{name:'로젠택배', url:n=>`https://www.ilogen.com/web/personal/trace/${encodeURIComponent(n)}`},
  post:{name:'우체국택배', url:n=>`https://service.epost.go.kr/trace.RetrieveDomRigiTraceList.comm?sid1=${encodeURIComponent(n)}`},
  kyungdong:{name:'경동택배', url:n=>`https://kdexp.com/service/delivery/etc/delivery.do?barcode=${encodeURIComponent(n)}`},
  daesin:{name:'대신택배', url:n=>`https://www.ds3211.co.kr/freight/internalFreightSearch.ht?billno=${encodeURIComponent(n)}`},
  ems:{name:'EMS', url:n=>`https://service.epost.go.kr/trace.RetrieveEmsTraceEngList.comm?POST_CODE=${encodeURIComponent(n)}`}
};

function load(){try{return JSON.parse(localStorage.getItem(STORAGE_KEY))||[]}catch{return[]}}
function save(){localStorage.setItem(STORAGE_KEY,JSON.stringify(state.items))}
function clean(v){return String(v||'').trim().replace(/[\s-]/g,'').toUpperCase()}
function valid(v){return /^[A-Z0-9]{8,20}$/.test(v)&&/\d/.test(v)}
function esc(v=''){return String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function uid(){return crypto.randomUUID?.()||`${Date.now()}-${Math.random()}`}
function fmt(v){try{return new Intl.DateTimeFormat('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(v))}catch{return '—'}}
function carrierName(code){return CARRIERS[code]?.name||'택배사 확인 필요'}

function inferCarrier(n){
  if (/^[A-Z]{2}\d{9}KR$/.test(n)) return 'ems';
  if (/^6\d{11}$/.test(n)) return 'cj';
  if (/^4\d{11}$/.test(n)) return 'lotte';
  if (/^3\d{11}$/.test(n)) return 'hanjin';
  return '';
}

function addItem(number, carrier='', memo=''){
  const tracking=clean(number);
  if(!valid(tracking)) return toast('운송장번호 형식을 확인해줘');
  if(state.items.some(x=>x.tracking===tracking)) return toast('이미 등록된 운송장이야');
  const inferred=carrier||inferCarrier(tracking);
  state.items.unshift({id:uid(),tracking,carrier:inferred,memo:memo.trim(),status:'active',createdAt:new Date().toISOString()});
  save();render();toast('추가했음');
}

function filtered(){return state.items.filter(x=>state.filter==='all'||x.status===state.filter||(state.filter==='unknown'&&!x.carrier))}
function render(){
  const all=state.items.length, unknown=state.items.filter(x=>!x.carrier).length, done=state.items.filter(x=>x.status==='done').length, active=all-done;
  els.statAll.textContent=all;els.statUnknown.textContent=unknown;els.statActive.textContent=active;els.statDone.textContent=done;
  const items=filtered();els.empty.hidden=items.length>0;
  els.list.innerHTML=items.map(item=>{
    const unknown=!item.carrier, c=CARRIERS[item.carrier];
    return `<article class="parcel" data-id="${esc(item.id)}">
      <div class="parcel-main"><div class="parcel-carrier">${esc(carrierName(item.carrier))}${item.carrier&&inferCarrier(item.tracking)===item.carrier?' · 자동추정':''}</div><div class="parcel-number">${esc(item.tracking)}</div>${item.memo?`<div class="parcel-memo">${esc(item.memo)}</div>`:''}</div>
      <div><div class="status ${unknown?'unknown':item.status==='done'?'done':''}"><span class="status-dot"></span><span>${unknown?'택배사 확인 필요':item.status==='done'?'완료 표시':'배송중 표시'}</span></div><div class="parcel-sub">등록 ${fmt(item.createdAt)}</div></div>
      <div>${c?`<a class="track-btn" target="_blank" rel="noopener" href="${c.url(item.tracking)}">공식 조회 ↗</a>`:'<span class="parcel-sub">택배사를 선택하면 조회 가능</span>'}</div>
      <div class="parcel-actions"><button class="icon-btn" data-action="detail" title="상세">⌁</button><button class="icon-btn" data-action="toggle" title="완료/배송중 전환">✓</button><button class="icon-btn" data-action="delete" title="삭제">✕</button></div>
    </article>`
  }).join('');
}

function openDetail(item){
  els.detailCarrier.textContent=carrierName(item.carrier);els.detailTitle.textContent=item.tracking;
  const carrierButtons=Object.entries(CARRIERS).map(([code,c])=>`<button class="chip" data-pick="${code}" type="button">${esc(c.name)}</button>`).join('');
  const link=item.carrier?`<a class="track-btn" target="_blank" rel="noopener" href="${CARRIERS[item.carrier].url(item.tracking)}">${esc(carrierName(item.carrier))} 공식 배송조회 ↗</a>`:'';
  els.detailContent.innerHTML=`<div class="detail-grid"><div><div class="detail-k">운송장</div><div class="detail-v">${esc(item.tracking)}</div></div><div><div class="detail-k">상태 표시</div><div class="detail-v">${item.status==='done'?'완료':'배송중'}</div></div><div><div class="detail-k">택배사</div><div class="detail-v">${esc(carrierName(item.carrier))}</div></div><div><div class="detail-k">메모</div><div class="detail-v">${esc(item.memo||'—')}</div></div></div><p class="parcel-sub" style="margin-top:16px">택배사가 틀렸거나 자동추정이 안 됐으면 직접 선택:</p><div class="filters">${carrierButtons}</div><div class="detail-actions">${link}</div>`;
  els.detailDialog.dataset.id=item.id;els.detailDialog.showModal();
}

function extract(text){
  const out=new Set();
  (String(text).toUpperCase().match(/(?<![A-Z0-9])(?:[A-Z]{2}\d{9}[A-Z]{2}|\d{8,16})(?![A-Z0-9])/g)||[]).forEach(v=>{v=clean(v);if(valid(v)&&!state.items.some(x=>x.tracking===v))out.add(v)});
  return [...out];
}

let timer;function toast(msg){clearTimeout(timer);els.toast.textContent=msg;els.toast.classList.add('show');timer=setTimeout(()=>els.toast.classList.remove('show'),2100)}

els.addForm.addEventListener('submit',e=>{e.preventDefault();if(!els.tracking.value.trim())return;addItem(els.tracking.value,els.carrier.value,els.memo.value);els.tracking.value='';els.memo.value='';els.carrier.value='';els.tracking.focus()});
els.filters.addEventListener('click',e=>{const b=e.target.closest('[data-filter]');if(!b)return;state.filter=b.dataset.filter;els.filters.querySelectorAll('.chip').forEach(x=>x.classList.toggle('active',x===b));render()});
els.list.addEventListener('click',e=>{const b=e.target.closest('[data-action]');if(!b)return;const card=b.closest('[data-id]'),item=state.items.find(x=>x.id===card.dataset.id);if(!item)return;if(b.dataset.action==='delete'){state.items=state.items.filter(x=>x.id!==item.id);save();render();toast('삭제했음')}if(b.dataset.action==='toggle'){item.status=item.status==='done'?'active':'done';save();render()}if(b.dataset.action==='detail')openDetail(item)});
els.refreshAll.addEventListener('click',()=>{render();toast('목록 새로고침 완료 — 실제 배송상태는 공식 조회 버튼에서 확인')});
els.bulkOpen.addEventListener('click',()=>{els.bulkText.value='';els.bulkPreview.textContent='';els.bulkDialog.showModal();els.bulkText.focus()});
els.bulkClose.addEventListener('click',()=>els.bulkDialog.close());els.bulkCancel.addEventListener('click',()=>els.bulkDialog.close());
els.bulkText.addEventListener('input',()=>{const a=extract(els.bulkText.value);els.bulkPreview.textContent=a.length?`${a.length}개 발견: ${a.join(', ')}`:'아직 운송장번호를 찾지 못함'});
els.bulkAdd.addEventListener('click',()=>{const a=extract(els.bulkText.value);a.forEach(v=>addItem(v));els.bulkDialog.close();toast(`${a.length}개 추가했음`)});
els.detailClose.addEventListener('click',()=>els.detailDialog.close());
els.detailContent.addEventListener('click',e=>{const b=e.target.closest('[data-pick]');if(!b)return;const item=state.items.find(x=>x.id===els.detailDialog.dataset.id);if(!item)return;item.carrier=b.dataset.pick;save();render();els.detailDialog.close();toast(`${carrierName(item.carrier)}로 설정`)});
els.exportBtn.addEventListener('click',()=>{const blob=new Blob([JSON.stringify(state.items,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`parcel-hub-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)});

render();
