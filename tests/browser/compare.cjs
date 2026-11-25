'use strict';
// 对两组截图逐像素比较；基线由重构前的应用采集，不作为运行依赖。
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require('@playwright/test');
(async()=>{
 const [baseline,current,reportFile]=process.argv.slice(2);
 if(!baseline||!current)throw new Error('请传入旧版和新版截图目录，可选第三参数为报告路径。');
 const files=fs.readdirSync(baseline).filter(name=>name.endsWith('.png')).sort();
 const browser=await chromium.launch();const page=await browser.newPage();const results=[];
 try{for(const name of files){
  const previous=fs.readFileSync(path.join(baseline,name));const next=fs.readFileSync(path.join(current,name));
  const result=await page.evaluate(async([a,b])=>{
   const load=async data=>{const img=new Image();img.src='data:image/png;base64,'+data;await img.decode();return img;};
   const images=await Promise.all([load(a),load(b)]);
   const [old,now]=images;if(old.width!==now.width||old.height!==now.height)return {sameSize:false,before:[old.width,old.height],after:[now.width,now.height],changedRatio:1};
   const pixels=images.map(img=>{const canvas=document.createElement('canvas');canvas.width=img.width;canvas.height=img.height;const context=canvas.getContext('2d');context.drawImage(img,0,0);return context.getImageData(0,0,img.width,img.height).data;});
   let changed=0;for(let i=0;i<pixels[0].length;i+=4)if(Math.max(...[0,1,2].map(n=>Math.abs(pixels[0][i+n]-pixels[1][i+n])))>10)changed++;
   return {sameSize:true,width:old.width,height:old.height,changedRatio:changed/(old.width*old.height)};
  },[previous.toString('base64'),next.toString('base64')]);
  results.push({name,...result});
 }}finally{await browser.close();}
 const failures=results.filter(item=>!item.sameSize||item.changedRatio>0.001);
 const report={screenshots:results.length,threshold:0.001,failures:failures.length,maximumChangedRatio:Math.max(...results.map(r=>r.changedRatio)),results};
 if(reportFile){fs.mkdirSync(path.dirname(reportFile),{recursive:true});fs.writeFileSync(reportFile,JSON.stringify(report,null,2)+'\n');}
 console.log(JSON.stringify({...report,results:failures},null,2));if(failures.length)process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=1;});
