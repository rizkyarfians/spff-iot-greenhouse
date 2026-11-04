const fs=require('node:fs');
const path=require('node:path');
const {createRequire}=require('node:module');
const [sourceRoot,file]=process.argv.slice(2);
if(!sourceRoot||!file)throw Error('Expected staging source and disposable App.tsx');
const ts=createRequire(path.join(sourceRoot,'frontend','package.json'))('typescript');
const content=fs.readFileSync(file,'utf8');
const tree=ts.createSourceFile(file,content,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
if(tree.parseDiagnostics.length)throw Error('Existing dashboard JSX is invalid');
const edits=[],found={group:0,sensor:0,chart:0,select:0};
const replace=(node,text)=>edits.push({start:node.getStart(tree),end:node.end,text});
function visit(node){
 if(ts.isVariableDeclaration(node)){
  const init=node.initializer;
  if(ts.isArrayBindingPattern(node.name)&&init&&ts.isCallExpression(init)){
   const name=node.name.elements[0]?.name?.getText(tree);
   const first=init.arguments[0];
   if(name==='dashboardSensorGroup'){
    found.group++;
    if(!first||!ts.isStringLiteral(first))throw Error('Unsupported dashboard group initializer');
    if(first.text==='soil1')replace(first,"'soil2'");
   }
   if(name==='selectedSensor'){
    found.sensor++;
    if(!first||!ts.isStringLiteral(first))throw Error('Unsupported selected sensor initializer');
    if(first.text.startsWith('soil_1_'))replace(first,"'soil_2_moisture'");
   }
  }
  if(ts.isIdentifier(node.name)&&node.name.text==='chartSensorOptions'&&init){
   found.chart++;
   const text=init.getText(tree);
   if(!text.includes("option.key.startsWith('soil_1_')"))
    replace(init,'('+text+").filter(option=>!option.key.startsWith('soil_1_'))");
  }
 }
 if(ts.isJsxElement(node)&&node.openingElement.tagName.getText(tree)==='select'){
  const value=node.openingElement.attributes.properties.find(a=>ts.isJsxAttribute(a)&&a.name.getText(tree)==='value');
  if(value?.initializer&&ts.isJsxExpression(value.initializer)&&value.initializer.expression?.getText(tree)==='dashboardSensorGroup'){
   found.select++;
   if(node.children.some(child=>!ts.isJsxText(child)&&!(ts.isJsxElement(child)&&child.openingElement.tagName.getText(tree)==='option')))
    throw Error('Unsupported dynamic dashboard group options');
   edits.push({start:node.openingElement.end,end:node.closingElement.getStart(tree),
    text:'\n<option value="soil1" disabled>Tanah 1</option>\n<option value="soil2">Tanah 2</option>\n<option value="water">Air</option>\n<option value="environment">Lingkungan</option>\n<option value="energy">Energi</option>\n'});
  }
 }
 ts.forEachChild(node,visit);
}
visit(tree);
for(const [key,count] of Object.entries(found))if(count!==1)throw Error('Expected one dashboard '+key+' anchor, found '+count);
let output=content;
for(const edit of edits.sort((a,b)=>b.start-a.start))output=output.slice(0,edit.start)+edit.text+output.slice(edit.end);
if(ts.createSourceFile(file,output,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX).parseDiagnostics.length)throw Error('Merged dashboard JSX is invalid');
const cssPath=path.join(path.dirname(file),'App.css');
const css=fs.readFileSync(cssPath,'utf8');
const marker='/* Temporarily unavailable dashboard sensor group. */';
fs.writeFileSync(file,output);
if(!css.includes(marker))fs.writeFileSync(cssPath,css+'\n'+marker+'\n.sensor-group-select option:disabled { color: #9ca3af; background: #f3f4f6; }\n');
console.log('DASHBOARD_GROUPS=PASS; soil1 disabled; soil2 default; water/environment separated; local App preserved');
