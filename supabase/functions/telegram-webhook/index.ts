import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const decode=(s:string)=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
Deno.serve(async (req) => {
 if(req.method!=='POST') return new Response('Method not allowed',{status:405});
 try {
  const id=new URL(req.url).searchParams.get('bot'); if(!id||!/^\d{5,20}$/.test(id)) return new Response('Invalid request',{status:400});
  const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
  const {data:bot,error:botError}=await admin.from('bots').select('merchant_id').eq('telegram_bot_id',id).maybeSingle();
  if(botError) return new Response('Temporary error',{status:503});
  if(!bot) return new Response('Not found',{status:404});
  const {data:secrets,error}=await admin.from('bot_secrets').select('token_ciphertext,token_iv,webhook_secret').eq('merchant_id',bot.merchant_id).single();
  if(error||!secrets) return new Response('Temporary error',{status:503});
  if(req.headers.get('X-Telegram-Bot-Api-Secret-Token')!==secrets.webhook_secret) return new Response('Unauthorized',{status:401});
  const update=await req.json(); const text=update?.message?.text; const chatId=update?.message?.chat?.id;
  if(typeof text!=='string'||!chatId||!/^\/start(?:\s|$)/.test(text)) return new Response('ok');
  const rawKey=decode(Deno.env.get('BOT_ENCRYPTION_KEY')!);
  const key=await crypto.subtle.importKey('raw',rawKey,'AES-GCM',false,['decrypt']);
  const token=new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(secrets.token_iv)},key,decode(secrets.token_ciphertext)));
  const response=await fetch(`https://api.telegram.org/bot${token}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:chatId,text:'Welcome! This shop is being set up. Please check back soon.'})});
  if(!response.ok) return new Response('Temporary error',{status:503});
  return new Response('ok');
 }catch{return new Response('Temporary error',{status:503})}
});
