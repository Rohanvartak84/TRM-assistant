import * as pdfjs from './vendor/pdf.mjs';
import {retrieve,textFromItems} from './search.mjs';
pdfjs.GlobalWorkerOptions.workerSrc='/vendor/pdf.worker.mjs';
const $=id=>document.getElementById(id);
let docs=[],active=null,currentPage=1,busy=false,renderTask=null,renderVersion=0,toastTimer;
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function toast(msg){$('toast').textContent=msg;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,6000)}
function lock(value){busy=value;for(const id of ['upload','sample','clear','search','source-search','chip','revision'])$(id).disabled=value}
function renderDocs(){
 $('count').textContent=docs.length;
 $('demo-notice').hidden=!docs.some(d=>d.demo);
 $('documents').innerHTML=docs.length?docs.map(d=>`<div class="doc ${active?.id===d.id?'active':''}"><button class="doc-open" data-id="${d.id}"><strong>▤ ${esc(d.name)}</strong><span>${esc(d.type)} · ${d.pdf.numPages} pages</span><span>Rev ${esc(d.revisions.join(', ')||'unknown')} ${d.blank?'· '+d.blank+' unreadable pages':''}</span></button><button class="remove" data-remove="${d.id}" aria-label="Remove ${esc(d.name)}">×</button></div>`).join(''):'<p class="small">No documents yet. Add a PDF or load the sample.</p>';
}
function resetResults(){ $('results').innerHTML='<div class="empty"><div class="empty-icon">⌕</div><h3>Start with a question.</h3><p>Search this chip’s documents and inspect the original evidence.</p></div>';$('result-count').textContent='Ready to search'}
function resetViewer(){renderVersion++;renderTask?.cancel();renderTask=null;active=null;currentPage=1;$('pdf').hidden=true;$('viewer-empty').hidden=false;$('source-title').textContent='Original document';$('pages').textContent='—';$('page').value=1}
async function showPage(doc,page=1){
 if(!doc)return;const version=++renderVersion;renderTask?.cancel();if(renderTask){try{await renderTask.promise}catch{}renderTask=null}
 active=doc;currentPage=Math.max(1,Math.min(doc.pdf.numPages,Number(page)||1));
 $('source-title').textContent=doc.name;$('page').value=currentPage;$('page').max=doc.pdf.numPages;$('pages').textContent=doc.pdf.numPages;renderDocs();
 try{
  const p=await doc.pdf.getPage(currentPage);if(version!==renderVersion)return;
  const viewport=p.getViewport({scale:1.8});const canvas=$('pdf');canvas.width=viewport.width;canvas.height=viewport.height;
  $('viewer-empty').hidden=true;canvas.hidden=false;
  renderTask=p.render({canvasContext:canvas.getContext('2d'),viewport});await renderTask.promise;
  if(version!==renderVersion)return;renderTask=null;
  $('source-foot').textContent=`${doc.demo?'Fictional sample. ':''}Original PDF page ${currentPage}. Printed page numbers may differ. Tables must be checked visually.`;
 }catch(e){if(e.name!=='RenderingCancelledException'){toast('Could not render this page. Try a different PDF.');$('pdf').hidden=true;$('viewer-empty').hidden=false}}
}
async function readPdf(data,meta){
 const pdf=await pdfjs.getDocument({data,standardFontDataUrl:'/vendor/standard_fonts/',cMapUrl:'/vendor/cmaps/',cMapPacked:true,wasmUrl:'/vendor/wasm/',isEvalSupported:false}).promise;
 const texts=[];let blank=0;
 try{for(let i=1;i<=pdf.numPages;i++){
   $('result-count').textContent=`Reading page ${i} of ${pdf.numPages}…`;
   try{const page=await pdf.getPage(i);const content=await page.getTextContent();const text=textFromItems(content.items);texts.push(text);if(text.trim().length<20)blank++;page.cleanup()}catch{texts.push('');blank++}
   if(i%10===0)await new Promise(r=>setTimeout(r,0));
  }
  if(blank===pdf.numPages)throw new Error('No readable text. This PDF may need OCR.');
  return {...meta,id:crypto.randomUUID(),pdf,texts,blank};
 }catch(e){await pdf.destroy();throw e}
}
async function dispose(list){for(const d of list){try{await d.pdf.destroy()}catch{}}}
async function sample(){
 if(busy)return;if(docs.some(d=>!d.demo)&&!confirm('Replace uploaded documents with the fictional sample?'))return;
 lock(true);let staged=[];
 try{
  for(const [path,type,revs] of [['demo-trm.pdf','TRM',['A','B']],['demo-errata.pdf','Errata',['A']]]){
   const response=await fetch('/'+path);if(!response.ok)throw new Error('Sample unavailable.');
   staged.push(await readPdf(new Uint8Array(await response.arrayBuffer()),{name:type==='TRM'?'Reference manual':'UART errata',type,revisions:revs,chip:'DEMO-MCU-01',demo:true}));
  }
  resetViewer();await dispose(docs);docs=staged;$('chip').value='DEMO-MCU-01';$('revision').value='A';renderDocs();resetResults();await showPage(docs[0]);
  $('question').value='Which bits enable UART transmission?';sourceSearch();
 }catch(e){await dispose(staged);toast(e.message||'Could not load sample.');resetResults()}finally{lock(false)}
}
function sourceSearch(){
 const question=$('question').value.trim();if(!question)return;
 const results=retrieve(docs,question,$('chip').value,$('revision').value);
 $('result-count').textContent=`${results.length} matching pages`;
 if(!results.length){$('results').innerHTML='<div class="empty"><h3>Insufficient evidence</h3><p>No keyword matches were found in the selected chip and revision. Check the scope, add documents, or use the exact register name. This does not prove the information is absent.</p></div>';return}
 const hasErrata=results.some(r=>r.doc.type==='Errata');
 $('results').innerHTML='<p class="result-note">Source passages, not an AI answer. Matches are ranked by keywords; verify that each passage answers your question.</p>'+results.map((r,i)=>`<article class="result ${r.doc.type==='Errata'?'errata':''}"><div class="result-header"><span class="number">${i+1}</span><strong>${r.doc.type==='Errata'?'Potentially relevant errata':esc(r.doc.type)+' passage'}</strong></div><pre>${esc(r.text)}</pre><div class="result-bottom"><span>${r.unknownRevision?'Revision applicability unknown': 'Revision tag: '+esc($('revision').value)}${r.doc.type==='Errata'?' · applicability unverified':''}</span><button class="citation" data-cite="${i}">${esc(r.doc.name)} · p. ${r.page}</button></div></article>`).join('')+(!hasErrata?'<p class="result-note">No matching errata surfaced. This is not confirmation that no applicable errata exists.</p>':'');
 $('results').querySelectorAll('[data-cite]').forEach(button=>button.onclick=()=>{const r=results[Number(button.dataset.cite)];showPage(r.doc,r.page);if(innerWidth<1200)document.querySelector('.source').scrollIntoView({behavior:'smooth'})});
}
async function search(){
 const question=$('question').value.trim();if(!question||busy)return;
 const results=retrieve(docs,question,$('chip').value,$('revision').value);
 if(!results.length){sourceSearch();return}
 lock(true);$('results').innerHTML='<div class="empty"><h3>Reading the matching pages…</h3><p>Generating a technical answer.</p></div>';$('result-count').textContent='Asking AI…';
 try{
  const response=await fetch('/api/answer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question,chip:$('chip').value.trim(),revision:$('revision').value.trim(),sources:results.map((r,i)=>({id:i+1,name:r.doc.name.slice(0,300),type:r.doc.type,page:r.page,text:r.text.slice(0,12000),unknownRevision:r.unknownRevision,demo:!!r.doc.demo}))}),signal:AbortSignal.timeout(65000)});
  const data=await response.json();if(!response.ok)throw new Error(data.error||'The answer could not be generated.');
  $('results').innerHTML=`<article class="result answer"><div class="result-header"><strong>Technical answer</strong><span>${esc(data.model||'Document search')}</span></div><div class="answer-text">${esc(data.answer)}</div></article><h3 class="citations-title">Citations</h3>`+(data.citations.length?data.citations.map(c=>`<article class="result"><button class="citation" data-cite="${c.sourceId-1}">[${c.sourceId}] ${esc(c.name)} · PDF p. ${c.page}</button><blockquote>${esc(c.quote)}</blockquote>${c.unknownRevision?'<p class="result-note">Revision applicability unknown.</p>':''}</article>`).join(''):'<p class="result-note">No supporting citation was returned. This is not a verified technical answer.</p>');
  $('results').querySelectorAll('[data-cite]').forEach(button=>button.onclick=()=>{const r=results[Number(button.dataset.cite)];showPage(r.doc,r.page);if(innerWidth<1200)document.querySelector('.source').scrollIntoView({behavior:'smooth'})});
  $('result-count').textContent=`${data.citations.length} citations · AI-generated`;
 }catch(e){sourceSearch();const notice=document.createElement('div');notice.className='notice';notice.setAttribute('role','alert');notice.textContent=e.name==='TimeoutError'?'The AI request timed out. Try again.':e.message;$('results').prepend(notice);$('result-count').textContent='AI unavailable · source search shown';}
 finally{lock(false)}
}
async function checkAI(){try{const r=await fetch('/api/status');if(!r.ok)throw new Error();const data=await r.json();$('ai-status').textContent=data.configured?'AI configured · '+data.model:'Backend ready · API key not configured';}catch{$('ai-status').textContent='Could not check AI connection';}}
$('source-search').onclick=()=>{if(!busy)sourceSearch()};
checkAI();
$('query-form').onsubmit=e=>{e.preventDefault();if(!busy)search()};
document.querySelectorAll('[data-query]').forEach(b=>b.onclick=()=>{if(busy)return;$('question').value=b.dataset.query;search()});
$('documents').onclick=async e=>{if(busy)return;const remove=e.target.closest('[data-remove]');if(remove){const d=docs.find(d=>d.id===remove.dataset.remove);if(!d)return;if(active===d)resetViewer();docs=docs.filter(x=>x!==d);await dispose([d]);renderDocs();resetResults();return}const b=e.target.closest('[data-id]');if(b)showPage(docs.find(d=>d.id===b.dataset.id))};
$('prev').onclick=()=>showPage(active,currentPage-1);$('next').onclick=()=>showPage(active,currentPage+1);$('page').onchange=()=>showPage(active,$('page').value);
$('chip').onchange=resetResults;$('revision').onchange=resetResults;
$('upload').onclick=()=>{$('upload-chip').value=docs.some(d=>!d.demo)?$('chip').value:'';$('doc-rev').value=docs.some(d=>!d.demo)?$('revision').value:'';$('upload-dialog').showModal()};
$('close-upload').onclick=()=>$('upload-dialog').close();$('about').onclick=()=>$('about-dialog').showModal();$('close-about').onclick=()=>$('about-dialog').close();
$('upload-form').onsubmit=async e=>{
 e.preventDefault();if(busy)return;
 const chip=$('upload-chip').value.trim();if(!chip){toast('Enter the exact chip part number.');return}
 if(docs.some(d=>!d.demo&&d.chip.toLowerCase()!==chip.toLowerCase())){toast('Clear the workspace before switching to another chip.');return}
 const files=Array.from($('files').files);if(!files.length)return;
 const type=$('doc-type').value,revisions=$('doc-rev').value.split(',').map(x=>x.trim()).filter(Boolean);
 if(files.some(f=>f.size>50*1024*1024)){toast('Each PDF must be 50 MB or smaller.');return}
 $('upload-dialog').close();lock(true);let added=[];const failures=[];
 try{
  for(const f of files){try{added.push(await readPdf(new Uint8Array(await f.arrayBuffer()),{name:f.name,type,revisions,chip,demo:false}))}catch(e){failures.push(f.name+': '+(e.name==='PasswordException'?'Password-protected PDF is not supported.':e.message||'Could not read PDF.'))}}
  if(added.length){const old=docs.filter(d=>d.demo);if(old.length){resetViewer();await dispose(old);docs=docs.filter(d=>!d.demo)}docs.push(...added);$('chip').value=chip;if(old.length||docs.length===added.length)$('revision').value=revisions[0]||'';renderDocs();await showPage(added[0]);}
  resetResults();$('files').value='';
  if(failures.length)toast(failures.join(' '));else toast(`${added.length} document${added.length===1?'':'s'} added.${added.some(d=>d.blank)?' Some pages have no readable text.':''}`);
 }finally{lock(false)}
};
$('sample').onclick=sample;$('clear').onclick=async()=>{if(busy)return;if(!confirm('Remove all documents and search results from this tab?'))return;resetViewer();const old=docs;docs=[];await dispose(old);$('chip').value='';$('revision').value='';$('question').value='';renderDocs();resetResults();toast('Workspace cleared.')};
sample();
