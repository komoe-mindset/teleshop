import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors = {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const json = (body: unknown, status=200) => new Response(JSON.stringify(body), {status,headers:{...cors,"Content-Type":"application/json"}});
const encode = (a: Uint8Array) => btoa(String.fromCharCode(...a));
Deno.serve(async (req) => {
 if(req.method==='OPTIONS') return new Response('ok',{headers:cors});
 if(req.method!=='POST') return json({error:'Method not allowed'},405);
 try {
  const url=Deno.env.get('SUPABASE_URL')!, anon=Deno.env.get('SUPABASE_ANON_KEY')!, service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, key64=Deno.env.get('BOT_ENCRYPTION_KEY');
  if(!key64) return json({error:'Bot encryption is not configured on the server.'},500);
  const auth=req.headers.get('Authorization')||'';
  const scoped=createClient(url,anon,{global:{headers:{Authorization:auth}}});
  const {data:{user},error:authError}=await scoped.auth.getUser();
  if(authError||!user) return json({error:'Please sign in again.'},401);
  const payload=await req.json(); const token=typeof payload.token==='string'?payload.token.trim():'';
  if(!/^\d{5,20}:[A-Za-z0-9_-]{20,100}$/.test(token)) return json({error:'Invalid bot token format.'},400);
  const admin=createClient(url,service,{auth:{persistSession:false}});
  const {data:existing,error:lookupError}=await admin.from('bots').select('telegram_bot_id').eq('merchant_id',user.id).maybeSingle();
  if(lookupError) throw Error('Database lookup failed');
  if(existing) return json({error:'A bot is already connected. Disconnect is not available in this starter.'},409);
  const tg=await fetch(`https://api.telegram.org/bot${token}/getMe`); const me=await tg.json();
  if(!me.ok||!me.result?.is_bot||!me.result?.username) return json({error:'Telegram rejected this bot token.'},400);
  const keyBytes=Uint8Array.from(atob(key64),c=>c.charCodeAt(0));
  if(keyBytes.length!==32) throw Error('Encryption key must be 32 bytes');
  const key=await crypto.subtle.importKey('raw',keyBytes,'AES-GCM',false,['encrypt']);
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const encrypted=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(token)));
  const secret=encode(crypto.getRandomValues(new Uint8Array(32))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
  const {error:botError}=await admin.from('bots').insert({merchant_id:user.id,telegram_bot_id:me.result.id,username:me.result.username});
  if(botError) return json({error:'This bot is already connected, or your account already has a bot.'},409);
  const {error:secretError}=await admin.from('bot_secrets').insert({merchant_id:user.id,token_ciphertext:encode(encrypted),token_iv:encode(iv),webhook_secret:secret});
  if(secretError){await admin.from('bots').delete().eq('merchant_id',user.id);throw Error('Could not save bot configuration')}
  const wh=await fetch(`https://api.telegram.org/bot${token}/setWebhook`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:`${url}/functions/v1/telegram-webhook?bot=${me.result.id}`,secret_token:secret,allowed_updates:['message']})});
  const whResult=await wh.json();
  if(!whResult.ok){await admin.from('bots').delete().eq('merchant_id',user.id);return json({error:'Telegram could not configure the webhook.'},502)}
  return json({username:me.result.username});
 } catch (_error) {return json({error:'Connection failed. Check server configuration and try again.'},500)}
});
