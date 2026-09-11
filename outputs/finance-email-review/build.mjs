import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {Workbook,SpreadsheetFile} from '@oai/artifact-tool';
const base = new URL('./',import.meta.url);
const a=JSON.parse(await fs.readFile(new URL('analysis.json',base),'utf8'));
const source=JSON.parse(await fs.readFile(new URL('source.json',base),'utf8'));
const norm=x=>String(x||'').trim().toLowerCase();
const fuzzy=new Map([
 ['K Ntsako Project','Same distinctive name. Project / construction differs; email differs by one letter.'],
 ['Lonsek Holdings','Same business name after removing the legal suffix.'],
 ['SORT IT INVESMENT HOLDINGS','Investment spelling differs; email differs by one letter.'],
 ['Sukude SH Holdings','Possible match: SH / SM differs and email is different. Confirm business identity.'],
]);
const proposed=a.rows.filter(r=>r.exactType==='Name'||fuzzy.has(r.name));
const other=a.rows.filter(r=>!proposed.includes(r));
assert.equal(proposed.length,10);assert.equal(other.length,66);
const rows=proposed.map(r=>{
 const p=r.candidates[0];
 const existing=source.finance.companies.filter(c=>norm(c.email)===norm(p.email)&&String(c.id)!==r.id);
 const shared=proposed.filter(q=>q.id!==r.id&&norm(q.candidates[0].email)===norm(p.email));
 let action='Review and update external email';
 if(existing.length) action='Resolve duplicate: target email already has an external account';
 else if(shared.length) action='Resolve duplicate: two external accounts map to this participant';
 else if(r.name==='Sukude SH Holdings') action='Confirm SH / SM identity before changing email';
 else if(!p.programmes.length) action='Align email; accepted programme application is also missing';
 return [r.name.trim(),r.email,p.name,p.email,r.exactType==='Name'?'Exact name':r.name==='Sukude SH Holdings'?'Possible name match':'Strong name match',p.programmes.join(', ')||'None found',action,r.id,p.id,[...existing.map(c=>String(c.id)),...shared.map(q=>q.id)].join('\n'),r.currentStatus,fuzzy.get(r.name)||'Unique beneficiary name matches after trimming and lowercasing.'];
});
rows.sort((x,y)=>x[0].localeCompare(y[0]));
const otherRows=other.map(r=>{
 const p=r.exactType==='Email'?r.candidates[0]:null;
 const malformed=r.name.includes('\t');
 return [malformed?r.name.split('\t')[0]:r.name.trim(),r.email,p?'Email already matches':'No confident match found',p?.name||'',p?.email||'',p?(p.applicationStatuses.join(', ')||'No application found'):'Not established',r.id,p?.id||'',p?'Programme application needs review; email change is not needed':malformed?'External name contains pasted address/status fields. No reliable participant match.':'No replacement email proposed. Confirm participant registration.'];
});
otherRows.sort((x,y)=>(x[2]===y[2]?x[0].localeCompare(y[0]):x[2].localeCompare(y[2])));
const wb=Workbook.create();
function make(name,title,context,headers,data,widths){
 const sh=wb.worksheets.add(name);sh.showGridLines=false;
 const n=headers.length,last=String.fromCharCode(64+n),end=data.length+7;
 sh.getRange(`A1:${last}${end}`).format.font={name:'Arial',size:10,color:'#202B3A'};
 sh.getRange(`A1:${last}${end}`).format.verticalAlignment='center';
 sh.getRange('A2').values=[[title]];sh.getRange('A2').format.font={name:'Arial',size:16,bold:true};
 sh.getRange('A3').values=[[context]];
 sh.getRange('A4').values=[['Source: live Qx /admin/all-memberships and Smart Inc Firestore participants / applications. Retrieved '+source.retrievedAt.replace('T',' ').slice(0,19)+' UTC.']];
 sh.getRange('A5').values=[['All programmes. Demo/internal accounts excluded using the finance page rules. Name similarity suggests identity; it does not prove it.']];
 sh.getRange('A4:A5').format.font={name:'Arial',size:10,color:'#596579'};
 sh.getRange(`A7:${last}${end}`).values=[headers,...data];
 const table=sh.tables.add(`A7:${last}${end}`,true,name.replaceAll(' ','')+'Table');table.showFilterButton=true;
 sh.getRange(`A7:${last}7`).format={fill:'#243D5A',font:{name:'Arial',size:10,bold:true,color:'#FFFFFF'},wrapText:true,rowHeight:32,horizontalAlignment:'center',verticalAlignment:'center'};
 sh.getRange(`A8:${last}${end}`).format.rowHeight=46;
 sh.getRange(`A8:${last}${end}`).format.wrapText=true;
 widths.forEach((w,i)=>sh.getRange(`${String.fromCharCode(65+i)}7:${String.fromCharCode(65+i)}${end}`).format.columnWidth=w);
 sh.freezePanes.freezeRows(7);sh.freezePanes.freezeColumns(2);
 return sh;
}
const review=make('Email review','SME email alignment','10 external accounts with candidate Smart Inc emails. Includes 5 accounts resolved by the new exact-name fallback.',
 ['External SME','External email (current)','Smart Inc beneficiary','Smart Inc email (candidate)','Match basis','Accepted programme','Next action','External company ID','Participant ID','Related external account IDs','Status after fallback','Match evidence'],rows,[38,39,40,39,24,26,53,39,25,39,25,65]);
review.tabColor='#243D5A';
review.getRange('G8:G17').conditionalFormats.add('containsText',{text:'duplicate',format:{fill:'#FFF0C2',font:{color:'#795300'}}});
review.getRange('E8:E17').conditionalFormats.add('containsText',{text:'Possible',format:{fill:'#FFF0C2',font:{color:'#795300'}}});
make('Other exceptions','Other finance exceptions','5 accounts already use the Smart Inc email. 61 accounts have no confident participant match.',
 ['External SME','External email (current)','Finding','Smart Inc beneficiary','Smart Inc email','Application status','External company ID','Participant ID','Next action'],otherRows,[42,42,30,43,39,28,39,25,70]);
wb.recalculate();
console.log((await wb.inspect({kind:'table',range:"'Email review'!A7:G10",include:'values',tableMaxRows:4,tableMaxCols:7,maxChars:2200})).ndjson);
console.log((await wb.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!',options:{useRegex:true,maxResults:10},summary:'Formula error scan'})).ndjson);
for(const [sheet,range,file] of [['Email review','A1:G17','review-preview.png'],['Other exceptions','A1:F15','other-preview.png']]){
 const preview=await wb.render({sheetName:sheet,range,scale:1,format:'png'});
 await fs.writeFile(new URL(file,base),new Uint8Array(await preview.arrayBuffer()));
}
const out=await SpreadsheetFile.exportXlsx(wb);
await out.save(new URL('SME-email-alignment.xlsx',base).pathname.replace(/^\/(\w:)/,'$1'));
console.log(JSON.stringify({reviewRows:rows.length,otherRows:otherRows.length,total:rows.length+otherRows.length,output:'SME-email-alignment.xlsx'}));
