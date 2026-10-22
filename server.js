// GlobalAz server: mağaza + admin panel + sifarişlər. İşə salmaq: npm install && npm start
const fs=require('fs'),path=require('path'),crypto=require('crypto'),express=require('express');
try{for(const l of fs.readFileSync(path.join(__dirname,'.env'),'utf8').split(/\r?\n/)){const m=l.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);if(m&&!(m[1] in process.env))process.env[m[1]]=m[2].replace(/^["']|["']$/g,'')}}catch{}
const E=process.env,PORT=E.PORT||3000,PASS=E.ADMIN_PASSWORD||'admin123';
const cfg={rate:+E.CNY_AZN||0.24,usd:1.7,margin:E.MARGIN?+E.MARGIN:12,cargo:E.CARGO_PER_KG?+E.CARGO_PER_KG:6,cust:E.CUSTOMS?+E.CUSTOMS:5,ship:0,wa:E.WHATSAPP||'994500000000'};
const F=path.join(__dirname,'data','db.json');fs.mkdirSync(path.dirname(F),{recursive:true});
let db={products:[],orders:[]};try{db=JSON.parse(fs.readFileSync(F,'utf8'))}catch{}
const save=()=>fs.writeFileSync(F,JSON.stringify(db,null,1));
const uid=()=>crypto.randomBytes(5).toString('hex'),s=(x,n=200)=>String(x==null?'':x).slice(0,n);
db.settings=db.settings||{};if(!db.secret){db.secret=crypto.randomBytes(24).toString('hex');save()}
const sig=e=>crypto.createHmac('sha256',db.secret).update(String(e)).digest('hex').slice(0,32);
const mk=()=>{const e=Date.now()+6048e5;return e+'.'+sig(e)};
const okTok=t=>{const[a,b]=String(t||'').split('.');return +a>Date.now()&&b===sig(a)};
const auth=(q,r,n)=>okTok(q.get('x-token'))?n():r.status(401).json({error:'Giriş tələb olunur'});
const pcfg=()=>({...cfg,...Object.fromEntries(Object.entries(db.settings).filter(([k])=>k in cfg))});
const up=p=>{const c=pcfg();return p.pr>0?p.pr:((p.cny*c.rate)*(1+c.margin/100)+p.kg*c.cargo)*(1+c.cust/100)};
const H=x=>crypto.createHash('sha256').update(String(x)).digest('hex'),fails={};
const app=express();app.use(express.json({limit:'200kb'}));

// ---- Google (Firebase) giriş: token yoxlanışı (əlavə paket lazım deyil) ----
const FB_KEY=E.FIREBASE_API_KEY||'AIzaSyArQxfkmpcVNs_6uV-6q3EZqWh6KTd9g78',gcache=new Map();
async function gUser(req){
 const t=String(req.get('authorization')||'').replace(/^Bearer\s+/i,'');if(t.length<100||t.length>4000)return null;
 const c=gcache.get(t);if(c&&c.exp>Date.now())return c.u;
 try{const r=await fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key='+FB_KEY,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({idToken:t}),signal:AbortSignal.timeout(10000)});
  if(!r.ok)return null;const u=((await r.json()).users||[])[0];if(!u||!u.email)return null;
  const x={uid:u.localId,email:u.email,name:u.displayName||''};gcache.set(t,{u:x,exp:Date.now()+3e5});if(gcache.size>500)gcache.clear();return x}catch{return null}}

// Taobao/1688 linkini qısa təmiz formaya salır
function canon(u){const m=String(u||'').match(/https?:\/\/[^\s"'<>]+/);if(!m)return'';u=m[0];
 const id=itemId(u);
 if(id&&/1688\.com/.test(u))return`https://detail.1688.com/offer/${id}.html`;
 if(id&&/(taobao|tmall)\.com/.test(u))return`https://item.taobao.com/item.htm?id=${id}`;return u}
async function lookup(link){
 const r=await fetch(link,{redirect:'follow',signal:AbortSignal.timeout(15000),headers:{'user-agent':'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148','accept-language':'zh-CN,zh;q=0.9'}});
 const h=await r.text(),meta=p=>{const a=h.match(new RegExp(`<meta[^>]+(?:property|name)=["']${p}["'][^>]+content=["']([^"']*)`,'i'))||h.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${p}["']`,'i'));return a?a[1]:''};
 const title=(meta('og:title')||(h.match(/<title>([^<]*)/i)||[])[1]||'').trim();
 let img=meta('og:image')||(h.match(/"(?:pic|image|mainPic|picUrl)"\s*:\s*"((?:https?:)?\/\/[^"]+)"/)||[])[1]||'';if(img.startsWith('//'))img='https:'+img;
 const cny=+(meta('og:product:price:amount')||(h.match(/"(?:price|priceText|minPrice)"\s*:\s*"?(\d+(?:\.\d+)?)/)||[])[1]||0);
 return{link:canon(r.url)||link,title,img,cny,blocked:!title||/登录|验证|login|captcha|^(淘宝网|天猫|阿里巴巴)$/i.test(title+' '+r.url)}}
async function tr(t,from='auto',to='az'){
 const r=await fetch('https://translate.googleapis.com/translate_a/single?client=gtx&dt=t&sl='+from+'&tl='+to+'&q='+encodeURIComponent(t.slice(0,1500)),{signal:AbortSignal.timeout(10000)});
 return(await r.json())[0].map(x=>x[0]).join('')}

// ---- Taobao API (RapidAPI): açar yalnız .env faylında saxlanır ----
const RK=E.RAPIDAPI_KEY||'',RH=E.RAPIDAPI_HOST||'open-taobao-api1.p.rapidapi.com',RP=E.TAOBAO_PATH||'';
const itemId=l=>{l=String(l);return(l.match(/[?&#](?:id|item_id|itemId|itemid|offerId|num_iid|nid)=(\d{6,})/i)||l.match(/\/(?:offer|item)\/(\d{6,})/)||[])[1]||''};
async function resolveId(link){let id=itemId(link);if(id)return id;
 try{const r=await fetch(link,{redirect:'follow',signal:AbortSignal.timeout(12000),headers:{'user-agent':'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148','accept-language':'zh-CN,zh;q=0.9'}});
  id=itemId(r.url);if(id)return id;const h=(await r.text()).slice(0,300000).replace(/\\u003d|\\x3d|%3D/gi,'=').replace(/\\u0026|\\x26|%26|&amp;/gi,'&').replace(/\\\//g,'/');
  const m=h.match(/[?&;](?:id|itemId|item_id)=(\d{9,})/)||h.match(/"(?:itemId|item_id|num_iid)"\s*:\s*"?(\d{9,})/);return m?m[1]:''}catch{return''}}
const fixU=u=>{u=String(u||'').trim();return u.startsWith('//')?'https:'+u:u};
const num=v=>{const m=String(v==null?'':v).match(/\d+(?:\.\d+)?/);return m?+m[0]:0};
function dig(o,keys){const q=[o];let n=0;while(q.length&&n++<5000){const x=q.shift();if(x&&typeof x==='object'){if(!Array.isArray(x))for(const k of keys){if(x[k]!=null&&x[k]!==''&&typeof x[k]!=='object')return x[k]}for(const v of Object.values(x))if(v&&typeof v==='object')q.push(v)}}}
function digArr(o,keys){const q=[o];let n=0;while(q.length&&n++<5000){const x=q.shift();if(x&&typeof x==='object'){if(!Array.isArray(x))for(const k of keys){if(Array.isArray(x[k])&&x[k].length)return x[k]}for(const v of Object.values(x))if(v&&typeof v==='object')q.push(v)}}}
const pick1=(o,ks)=>{for(const k of ks)if(o&&o[k]!=null&&typeof o[k]!=='object'&&o[k]!=='')return o[k]};
function parseItem(j){
 const cjk=/[\u4e00-\u9fff]/;
 const names=[dig(j,['nameTrans']),dig(j,['name','title','item_title','subject'])].map(x=>String(x==null?'':x).trim()).filter(Boolean);
 const title=s(names.find(x=>cjk.test(x))||names[0]||'',300);
 const skus=digArr(j,['skus'])||[];
 const sp=skus.map(x=>num(x&&x.cnyPrice)).filter(x=>x>0);
 const top=num(dig(j,['cnyPrice','promotion_price','price','sale_price','min_price','orginal_price','original_price','reserve_price']));
 const cny=sp.length?Math.min(...sp):top,cnyMax=sp.length?Math.max(...sp):cny;
 const ia=digArr(j,['item_imgs','main_imgs','images','pics','pic_urls','imgs','image_list'])||[];
 let imgs=ia.map(x=>fixU(typeof x==='string'?x:pick1(x,['url','img','pic_url','image']))).filter(Boolean);
 const img=fixU(dig(j,['coverImage','pic_url','main_img','image','img','pic']))||imgs[0]||'';
 imgs=[...new Set(imgs)].filter(u=>u!==img).slice(0,8);
 let desc=s(String(dig(j,['desc_short','description','desc'])||'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim(),600);
 if(!desc){const seen=new Set(),L=[];for(const a of(digArr(j,['productAttrs'])||[])){const n=s(a&&a.attributeName,40),v=s(a&&a.value,80),k=n+'|'+v;if(!n||!v||/color classification/i.test(n)||seen.has(k))continue;seen.add(k);L.push(n+': '+v)}desc=s(L.slice(0,12).join('\n'),600)}
 let opts=[];
 if(skus.length){const m=new Map();for(const k of skus)for(const p of((k&&k.properties)||[])){const n=s(p&&(p.displayName||p.name),30).replace(/[:：]/g,' ').trim(),v=s(p&&(p.displayValue||p.value),80).replace(/[,，、]/g,' ').trim();if(!n||!v)continue;if(!m.has(n))m.set(n,[]);const x=m.get(n);if(!x.includes(v))x.push(v)}
  opts=[...m].slice(0,5).map(([n,v])=>({n,v:v.slice(0,30)}))}
 else{const oa=digArr(j,['sku_props','props_list','skuProps','sku_base','props'])||[];
  opts=oa.slice(0,5).map(o=>{const n=s(pick1(o,['name','prop_name','propName','title']),30);
   const va=Array.isArray(o&&o.values)?o.values:Array.isArray(o&&o.value)?o.value:Array.isArray(o&&o.props)?o.props:[];
   return{n,v:va.slice(0,30).map(x=>s(typeof x==='string'?x:pick1(x,['name','value','valueName','text']),80)).filter(Boolean)}}).filter(o=>o.n&&o.v.length)}
 return{title,img,imgs,cny,cnyMax,desc,opts}}
async function apiRaw(link){
 if(!RK||!RP)throw new Error('API qoşulmayıb (RAPIDAPI_KEY, TAOBAO_PATH təyin olunmayıb)');const id=await resolveId(link);if(!id)throw new Error('Linkdən məhsul nömrəsi tapılmadı. Nömrəsi (id=...) olan tam Taobao/Tmall/1688 linki yapışdırın');
 const r=await fetch('https://'+RH+RP.replace('{id}',id),{headers:{'x-rapidapi-key':RK,'x-rapidapi-host':RH},signal:AbortSignal.timeout(20000)});
 const txt=await r.text();let j={};try{j=JSON.parse(txt)}catch{}
 if(!r.ok)throw new Error('API '+r.status+': '+s(txt,150));return j}
async function trOpts(opts){if(!opts.length)return opts;
 try{const L=[];opts.forEach(o=>{L.push(o.n,...o.v)});if(L.join('\n').length>1400)return opts;
  const t=(await tr(L.join('\n'))).split('\n');if(t.length!==L.length)return opts;
  let i=0;return opts.map(o=>({n:s(t[i++].replace(/[:：]/g,' ').trim()||o.n,30),v:o.v.map(x=>s(t[i++].replace(/[,，、]/g,' ').trim()||x,80))}))}catch{return opts}}

// ---- Mağaza (açıq): src = gizli məhsul ID, Taobao linki müştəriyə göstərilmir ----
app.get('/api/products',(q,r)=>r.json({cfg:pcfg(),list:db.products.map(p=>({n:p.az||p.zh,c:p.c,img:p.img,imgs:p.imgs||[],desc:p.desc||'',opts:p.opts||[],cny:p.cny,pr:p.pr,kg:p.kg,src:p.id,from:'ga'}))}));
app.post('/api/orders',async(q,r)=>{const b=q.body||{};const gu=await gUser(q);if(!gu)return r.status(401).json({error:'Əvvəlcə Google ilə daxil olun'});
 if(!s(b.name)||!s(b.phone)||!s(b.address)||!Array.isArray(b.items)||!b.items.length)return r.status(400).json({error:'Məlumat çatışmır'});
 const items=b.items.slice(0,50).map(i=>{const p=db.products.find(x=>x.id===i.src)||{};return{n:s(i.n),q:Math.max(1,+i.q|0),u:p.id?+up(p).toFixed(2):(+i.u||0),opt:s(i.opt,150),link:p.link||'',zh:p.zh||'',img:p.img||''}});
 const total=+items.reduce((a,i)=>a+i.u*i.q,0).toFixed(2);
 const o={id:uid(),uid:gu.uid,email:gu.email,no:s(b.no,30),date:new Date().toISOString(),name:s(b.name),phone:s(b.phone,40),address:s(b.address,300),items,total,status:'new',pay:'none',track:'',note:'',cost:0};
 db.orders.unshift(o);save();
 r.json({ok:true,no:o.no})});
app.get('/api/my-orders',async(q,r)=>{const gu=await gUser(q);if(!gu)return r.status(401).json({error:'Giriş tələb olunur'});
 r.json({list:db.orders.filter(o=>o.uid===gu.uid).slice(0,50).map(o=>({no:o.no,date:o.date,total:o.total,status:o.status,pay:o.pay,track:o.track,items:o.items.map(i=>i.n+' × '+i.q)}))})});
app.get('/api/track/:no',(q,r)=>{const o=db.orders.find(x=>x.no===q.params.no);if(!o)return r.status(404).json({error:'Tapılmadı'});r.json({status:o.status,pay:o.pay,track:o.track})});

// ---- Admin ----
app.post('/api/login',(q,r)=>{const f=fails[q.ip]||{n:0,t:0};if(f.n>=5&&Date.now()-f.t<9e5)return r.status(429).json({error:'Çox cəhd. 15 dəqiqə sonra yenidən yoxlayın'});
 const a=Buffer.from(H(q.body&&q.body.password)),b=Buffer.from(db.pass||H(PASS));
 if(!crypto.timingSafeEqual(a,b)){fails[q.ip]={n:f.n+1,t:Date.now()};return r.status(401).json({error:'Parol səhvdir'})}
 delete fails[q.ip];r.json({token:mk()})});
app.get('/api/orders',auth,(q,r)=>r.json({list:db.orders}));
app.patch('/api/orders/:id',auth,(q,r)=>{const o=db.orders.find(x=>x.id===q.params.id);if(!o)return r.status(404).json({error:'Tapılmadı'});const b=q.body||{};
 if(b.status!=null)o.status=s(b.status,20);if(b.pay!=null)o.pay=s(b.pay,10);if(b.track!=null)o.track=s(b.track,80);if(b.note!=null)o.note=s(b.note,300);if(b.cost!=null)o.cost=+b.cost||0;save();r.json({ok:true})});
app.get('/api/admin/products',auth,(q,r)=>r.json({list:db.products}));
const clean=b=>({link:canon(b.link),zh:s(b.zh,300),az:s(b.az,300),c:s(b.c,40)||'Digər',img:s(b.img,500),cny:+b.cny||0,kg:+b.kg||0.5,pr:+b.pr||0,desc:s(b.desc,2000),
 imgs:(Array.isArray(b.imgs)?b.imgs:[]).map(x=>s(x,500)).filter(Boolean).slice(0,8),
 opts:(Array.isArray(b.opts)?b.opts:[]).slice(0,5).map(o=>({n:s(o.n,30),v:(Array.isArray(o.v)?o.v:[]).slice(0,30).map(x=>s(x,80)).filter(Boolean)})).filter(o=>o.n&&o.v.length)});
app.post('/api/admin/products',auth,(q,r)=>{const p={id:uid(),...clean(q.body)};db.products.unshift(p);save();r.json(p)});
app.put('/api/admin/products/:id',auth,(q,r)=>{const i=db.products.findIndex(x=>x.id===q.params.id);if(i<0)return r.status(404).json({error:'Tapılmadı'});db.products[i]={id:q.params.id,...clean(q.body)};save();r.json(db.products[i])});
app.delete('/api/admin/products/:id',auth,(q,r)=>{db.products=db.products.filter(x=>x.id!==q.params.id);save();r.json({ok:true})});
app.post('/api/fetch',auth,async(q,r)=>{const link=canon(q.body&&q.body.url);if(!link)return r.status(400).json({error:'Düzgün link daxil edin'});
 let out=null,apiError='';
 try{const raw=await apiRaw(link);const p=parseItem(raw);if(p.title)out={...p,link,via:'api'};else apiError='API cavabinda mehsul adi tapilmadi: '+s(JSON.stringify(raw),400)}catch(e){apiError=e.message}
 if(out){try{if(out.desc)out.desc=await tr(out.desc)}catch{}out.opts=await trOpts(out.opts);return r.json(out)}
 if(apiError)return r.json({link,title:'',img:'',cny:0,blocked:true,via:'page',apiError});
 try{r.json({...await lookup(link),via:'page',apiError})}catch(e){r.json({link,title:'',img:'',cny:0,blocked:true,via:'page',apiError})}});
app.post('/api/admin/taobao-test',auth,async(q,r)=>{const link=canon(q.body&&q.body.url);if(!link)return r.status(400).json({error:'Düzgün link daxil edin'});
 const o={configured:!!(RK&&RP),host:RH,id:itemId(link)};
 try{const j=await apiRaw(link);o.parsed=parseItem(j);o.raw=s(JSON.stringify(j),6000)}catch(e){o.error=e.message}r.json(o)});
app.post('/api/translate',auth,async(q,r)=>{try{r.json({text:await tr(s(q.body&&q.body.text,1500))})}catch(e){r.status(502).json({error:'Tərcümə alınmadı'})}});

app.get('/api/admin/settings',auth,(q,r)=>r.json(pcfg()));
app.put('/api/admin/settings',auth,(q,r)=>{const b=q.body||{};for(const k of['rate','margin','cargo','cust']){if(b[k]!==''&&b[k]!=null&&isFinite(+b[k]))db.settings[k]=+b[k]}
 for(const k of['wa'])if(b[k]!=null)db.settings[k]=s(b[k],120).trim();save();r.json({ok:true})});
app.post('/api/admin/password',auth,(q,r)=>{const p=s(q.body&&q.body.password,100);if(p.length<6)return r.status(400).json({error:'Parol ən azı 6 simvol olmalıdır'});db.pass=H(p);save();r.json({ok:true})});
const PUB=path.join(__dirname,'public');
const page=n=>{for(const d of[PUB,__dirname]){try{const L=fs.readdirSync(d).map(f=>{const m=f.match(new RegExp('^'+n+'(\\d*)\\.html$'));return m&&{f,v:+m[1]||0}}).filter(Boolean).sort((a,b)=>b.v-a.v);if(L.length)return path.join(d,L[0].f)}catch{}}return null};
app.get('/admin',(q,r)=>{const f=page('admin');f?r.sendFile(f):r.status(404).send('Admin səhifəsi tapılmadı')});
app.get('/',(q,r)=>{const f=page('index');f?r.sendFile(f):r.status(404).send('Ana səhifə tapılmadı')});
app.use(express.static(path.join(__dirname,'public')));
app.listen(PORT,()=>console.log('GlobalAz: http://localhost:'+PORT+'  |  Admin: http://localhost:'+PORT+'/admin'));
