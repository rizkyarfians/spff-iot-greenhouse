// Preserve Orange Pi's local recommendation code; fold it under the new overview.
const fs=require('node:fs');
const {createRequire}=require('node:module');
const path=require('node:path');
const [sourceRoot,file]=process.argv.slice(2);
if(!sourceRoot||!file)throw Error('Expected staging source and disposable FloatingAiRecommendation.tsx');
const ts=createRequire(path.join(sourceRoot,'frontend','package.json'))('typescript');
const content=fs.readFileSync(file,'utf8');
const tree=ts.createSourceFile(file,content,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
if(tree.parseDiagnostics.length)throw Error('Floating recommendation JSX is invalid');
const matches=[],overviews=[];
function visit(node){
 if(ts.isJsxSelfClosingElement(node)){
  if(node.tagName.getText(tree)==='AdaptiveRecommendation')matches.push(node);
  if(node.tagName.getText(tree)==='AiFertigationOverview')overviews.push(node);
 }
 ts.forEachChild(node,visit);
}
visit(tree);
if(matches.length!==1)throw Error('Expected exactly one preserved AdaptiveRecommendation');
if(overviews.length){
 if(overviews.length===1&&content.includes('className="afo-details"')){
  console.log('PRESERVED_LOCAL_AI_DRAWER=PASS; overview already installed');
  process.exit(0);
 }
 throw Error('Existing AI overview cannot be uniquely merged');
}
const node=matches[0];
const replacement='<><AiFertigationOverview deviceId={deviceId} report={report}/><details className="afo-details"><summary>Detail sensor &amp; program</summary>'+node.getText(tree)+'</details></>';
const output="import {AiFertigationOverview} from './AiFertigationOverview'\n"+content.slice(0,node.getStart(tree))+replacement+content.slice(node.end);
const checked=ts.createSourceFile(file,output,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
if(checked.parseDiagnostics.length)throw Error('Merged AI overview JSX is invalid');
fs.writeFileSync(file,output);
console.log('PRESERVED_LOCAL_AI_DRAWER=PASS; original recommendation preserved under details');
