 'use strict';
const {createDatabase}=require('../src/db/index.cjs');
const {importContacts}=require('../src/lib/directory.cjs');
(async()=>{
  const source=process.argv.slice(2).find(arg=>!arg.startsWith('--'));
  if(!source)throw new Error('请提供通讯录 XLSX 的路径；默认只预览，追加 --apply 才写入。');
  const db=createDatabase();
  try {console.log(JSON.stringify(await importContacts(db,source,{apply:process.argv.includes('--apply')}),null,2));}
  finally {await db.close();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
