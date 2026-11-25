'use strict';
const {spawnSync}=require('node:child_process');
const fs=require('node:fs');
const program=String.raw`
import json,sys,zipfile
from xml.sax.saxutils import escape
rows=[['用户 ID','姓名','联系手机','部门','直属上级','账号状态','职位']]+json.load(sys.stdin)
body=''.join('<row r="%d">%s</row>'%(r,''.join('<c r="%s%d" t="inlineStr"><is><t>%s</t></is></c>'%(chr(65+i),r,escape(str(v))) for i,v in enumerate(row))) for r,row in enumerate(rows,1))
with zipfile.ZipFile(sys.argv[1],'w',zipfile.ZIP_DEFLATED) as z:
 z.writestr('xl/worksheets/sheet1.xml','<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'+body+'</sheetData></worksheet>')
`;
function workbook(file,rows){const result=spawnSync('python3',['-c',program,file],{input:JSON.stringify(rows),encoding:'utf8'});if(result.status!==0)throw Error(result.stderr);return {content:fs.readFileSync(file).toString('base64')};}
module.exports={workbook};
