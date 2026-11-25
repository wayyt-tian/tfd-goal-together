'use strict';
const http = require('node:http');
const path = require('node:path');
const { temporarySchema } = require('./db/index.cjs');
const { createApplication } = require('./application.cjs');
const { DATA_DIRECTORY } = require('./paths.cjs');
async function start() {
  const port = Number(process.env.PORT || 4173), host = process.env.HOST || '127.0.0.1';
  const single = process.env.GUOQI_DUAL!=='1' && ['0','1'].includes(process.env.GUOQI_DEMO);
  const apps = new Map(); let isolation; let closing = false;
  const server = http.createServer((request, response) => {
    if (single) return apps.values().next().value.handle(request, response);
    const url = new URL(request.url, 'http://localhost');
    const mode = url.pathname.match(/^\/(formal|demo)(?:\/|$)/)?.[1];
    if (mode) {
      if (url.pathname === '/' + mode) { response.writeHead(302,{Location:'/'+mode+'/'}); return response.end(); }
      request.url = url.pathname.slice(mode.length+1) + url.search;
      return apps.get(mode).handle(request,response);
    }
    if(url.pathname==='/' || url.pathname==='/index.html') { response.writeHead(302,{Location:'/formal/'}); return response.end(); }
    if(/^\/(static|assets\/brand|fonts)\//.test(url.pathname)) return apps.get('formal').handle(request,response);
    response.writeHead(404,{'Content-Type':'application/json; charset=utf-8'});response.end(JSON.stringify({error:'页面不存在。'}));
  });
  // 先占住端口，初始化完成前不接收业务请求。
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve);});
  const loading = (req,res)=>{res.writeHead(503,{'Retry-After':'2'});res.end('服务正在准备，请稍后刷新。');};
  const handler = server.listeners('request')[0]; server.removeAllListeners('request'); server.on('request',loading);
  try {
    if (single) {
      const demo = process.env.GUOQI_DEMO==='1';
      apps.set(demo?'demo':'formal', await createApplication({demo,live:process.env.GUOQI_DEMO_LIVE==='1',dataDirectory:DATA_DIRECTORY,backupDirectory:process.env.BACKUP_DIR,availableModes:[demo?'demo':'formal']}));
    } else {
      const formal = new URL(process.env.DATABASE_URL || ''), demo = new URL(process.env.DEMO_DATABASE_URL || '');
      if(formal.hostname===demo.hostname && (formal.port||'5432')===(demo.port||'5432') && formal.pathname===demo.pathname) throw new Error('正式库和演示库必须独立。');
      isolation = await temporarySchema('demo');
      apps.set('formal',await createApplication({base:'/formal',demo:false,dataDirectory:path.join(DATA_DIRECTORY,'formal'),backupDirectory:process.env.BACKUP_DIR?path.join(process.env.BACKUP_DIR,'formal'):undefined,availableModes:['formal','demo']}));
      apps.set('demo',await createApplication({base:'/demo',demo:true,url:isolation.url,schema:isolation.schema,dataDirectory:path.join(DATA_DIRECTORY,'demo'),backupDirectory:process.env.BACKUP_DIR?path.join(process.env.BACKUP_DIR,'demo'):undefined,availableModes:['formal','demo']}));
    }
    server.removeListener('request',loading);server.on('request',handler);
    console.log(`锅气家族工作台：http://${host}:${server.address().port}`);
    console.log(single ? (process.env.GUOQI_DEMO==='1'?'演示模式：人物和数字均为虚构。':'正式模式：独立持久数据。') : '正式模式 /formal/；体验演示 /demo/，数据和会话独立。');
    if(apps.get('formal')?.setupFile) console.log('首次初始化凭证保存在本机私有文件：'+apps.get('formal').setupFile);
  } catch(error) { await shutdown(); throw error; }
  async function shutdown() {
    if(closing)return;closing=true;
    server.close();
    await Promise.allSettled([...apps.values()].map(app=>app.close()));
    server.closeAllConnections();
    if(isolation)await isolation.cleanup();
  }
  process.on('SIGTERM',()=>shutdown().then(()=>process.exit(0)));
  process.on('SIGINT',()=>shutdown().then(()=>process.exit(0)));
  server.on('error',()=>{console.error('服务监听失败。');shutdown().then(()=>process.exit(1));});
}
start().catch(error=>{console.error('工作台启动失败：',error.code==='EADDRINUSE'?'端口已被占用，本次未打开数据库。':error.code || error.message);process.exitCode=1;});
