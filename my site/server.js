require("dotenv").config();
const express=require("express"), fs=require("fs"), path=require("path");
const app=express(), PORT=process.env.PORT||3000, TOKEN=process.env.BOT_TOKEN, CHANNEL=process.env.CHANNEL||"@mussliim111";
const DATA=path.join(__dirname,"posts.json"); let offset=0, polling=false;
const read=()=>{try{return JSON.parse(fs.readFileSync(DATA,"utf8"))}catch{return[]}};
const write=x=>fs.writeFileSync(DATA,JSON.stringify(x.slice(0,100),null,2));
async function tg(method,params={}){
 if(!TOKEN) throw Error("BOT_TOKEN is not configured");
 const r=await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(params)});
 const d=await r.json(); if(!d.ok) throw Error(d.description||"Telegram API error"); return d.result;
}
async function photoUrl(fileId){
 const f=await tg("getFile",{file_id:fileId});
 return `https://api.telegram.org/file/bot${TOKEN}/${f.file_path}`;
}
function normalize(u){
 const m=u.channel_post||u.edited_channel_post;if(!m)return null;
 const p=m.photo?.at(-1);
 return {id:m.message_id,date:m.date,text:m.caption||m.text||"",type:p?"photo":"text",file_id:p?.file_id||null,url:`https://t.me/${CHANNEL.replace("@","")}/${m.message_id}`};
}
async function poll(){
 if(polling||!TOKEN)return; polling=true;
 try{
  const updates=await tg("getUpdates",{offset,timeout:0,allowed_updates:["channel_post","edited_channel_post"]});
  let posts=read();
  for(const u of updates){
   offset=Math.max(offset,u.update_id+1); const p=normalize(u); if(!p)continue;
   const i=posts.findIndex(x=>x.id===p.id); if(i>=0)posts[i]={...posts[i],...p};else posts.unshift(p);
  }
  write(posts);
 }catch(e){console.error("[Telegram]",e.message)}finally{polling=false}
}
app.use(express.static(path.join(__dirname,"public")));
app.get("/api/posts",async(req,res)=>{
 try{
  const out=[];
  for(const p of read().slice(0,8)){
   const q={...p}; if(q.file_id){try{q.image_url=await photoUrl(q.file_id)}catch{}}
   delete q.file_id; out.push(q);
  }
  res.json(out);
 }catch(e){res.status(500).json({error:e.message})}
});
app.get("/health",(req,res)=>res.json({ok:true,telegramConfigured:!!TOKEN,posts:read().length}));
app.listen(PORT,()=>{console.log(`http://localhost:${PORT}`);poll();setInterval(poll,30000)});
