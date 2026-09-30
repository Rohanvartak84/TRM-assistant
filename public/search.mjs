const stop=new Set('a an the is are what which how do does i to of for in on at and or with can it this that please tell me from my'.split(' '));
export function tokens(text){return (text.toLowerCase().match(/[a-z0-9_]+/g)||[]).filter(x=>!stop.has(x)&&x.length>1)}
export function retrieve(docs,question,chip,revision){
 const terms=[...new Set(tokens(question))];if(!terms.length)return [];
 const results=[];
 for(const doc of docs){
  if(doc.chip.toLowerCase()!==chip.trim().toLowerCase())continue;
  if(revision.trim()&&doc.revisions.length&&!doc.revisions.some(r=>r.toLowerCase()===revision.trim().toLowerCase()))continue;
  for(let i=0;i<doc.texts.length;i++){
   const text=doc.texts[i], hay=text.toLowerCase();
   const hits=terms.filter(t=>hay.includes(t));
   if(!hits.length)continue;
   const score=hits.length/terms.length*10+hits.reduce((n,t)=>n+Math.min(hay.split(t).length-1,4),0)*.2;
   results.push({doc,page:i+1,text,score,hits,unknownRevision:!doc.revisions.length||!revision.trim()});
  }
 }
 return results.sort((a,b)=>b.score-a.score).slice(0,6);
}
export function textFromItems(items){
 const rows=[];let line=[],lastY=null;
 for(const item of items){if(!('str'in item))continue;const y=item.transform[5];if(lastY!==null&&Math.abs(y-lastY)>3&&line.length){rows.push(line.join(' '));line=[]}line.push(item.str);lastY=y;if(item.hasEOL){rows.push(line.join(' '));line=[];lastY=null}}
 if(line.length)rows.push(line.join(' '));return rows.join('\n');
}
