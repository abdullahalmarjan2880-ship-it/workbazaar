/* WorkBazaar public website — all page behaviour lives here (external file,
   handlers bound with addEventListener, no inline onclick attributes), so
   clicks keep working even where inline handlers/scripts are restricted.
   The site has 4 pages — Explore / Profile / Inbox / Chat — switched by the
   fixed bottom tab bar (and the header links). The Firebase SDK is loaded
   lazily on demand: gstatic first, cdnjs as a fallback — one blocked CDN no
   longer leaves Connect / Sign in dead. */

var GIGS=[
 {id:1,title:"Logo designer",seller:"Marjan",cat:"logo",catLabel:"Logo & Branding",price:15,rating:"5.0",orders:3,delivery:"2 days",color:"linear-gradient(135deg,#0e7a4a,#0a5c38)",initial:"M",tag:"Bestseller",desc:"I will design a clean, professional logo for your business or brand — modern, memorable and ready to use everywhere.",packs:[["Basic",15,["1 logo concept","PNG + JPG files","2 revisions"]],["Standard",30,["3 logo concepts","Source file included","5 revisions","Social media kit"]],["Premium",60,["5 concepts + brand guide","All source files","Unlimited revisions","Full brand kit"]]]},
 {id:2,title:"Mark and seller ltd",seller:"Mark and seller ltd",cat:"business",catLabel:"Business",price:10,rating:"5.0",orders:1,delivery:"3 days",color:"linear-gradient(135deg,#e8930c,#b96e04)",initial:"M",tag:"New",desc:"Business and seller support services — listing help, seller setup and store assistance for your online business.",packs:[["Basic",10,["Seller account setup help","1 listing"]],["Standard",20,["Setup + 5 listings","Description writing"]],["Premium",40,["Full store setup","15 listings","Priority support"]]]},
 {id:3,title:"Mndurahktkttd",seller:"Mndurahktkttd",cat:"general",catLabel:"General Services",price:20,rating:"5.0",orders:0,delivery:"2 days",color:"linear-gradient(135deg,#f45d48,#c93a26)",initial:"M",tag:"New",desc:"General freelance service — tell me what you need and I will get it done carefully and on time.",packs:[["Basic",20,["Standard task","Delivery in 2 days"]],["Standard",40,["Bigger task","2 revisions"]],["Premium",80,["Full project","Priority delivery","Unlimited revisions"]]]},
 {id:4,title:"MAMUN VAII",seller:"MAMUN VAII",cat:"general",catLabel:"General Services",price:20,rating:"5.0",orders:2,delivery:"3 days",color:"linear-gradient(135deg,#0e7a4a,#e8930c)",initial:"M",tag:"Popular",desc:"Reliable freelance help for your everyday online work — fast communication and honest delivery.",packs:[["Basic",20,["Standard task","Delivery in 3 days"]],["Standard",40,["Extended task","3 revisions"]],["Premium",75,["Complete package","Fast delivery","Unlimited revisions"]]]}
];
var activeCat="all", query="", currentGig=null, selectedPack=0;

/* Escape anything that comes from Firestore before it goes into HTML —
   gig/order fields are written by signed-in users, never trusted as markup. */
function esc(s){
  return String(s==null?"":s).replace(/[&<>"']/g,function(c){
    return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
  });
}
function money(n){ n=Number(n)||0; return "$"+(Math.round(n*100)/100); }

/* ---- 4 pages: Explore / Profile / Inbox / Chat ---- */
var currentPage="explore";
function showPage(name,scrollId){
  currentPage=name;
  ["explore","profile","inbox","chat"].forEach(function(p){
    var el=document.getElementById('page-'+p);
    if(el) el.classList.toggle('active',p===name);
  });
  document.querySelectorAll('.tab').forEach(function(t){
    t.classList.toggle('on',t.getAttribute('data-page')===name);
  });
  document.querySelectorAll('.navlinks a').forEach(function(a){
    a.classList.toggle('on',a.getAttribute('data-goto')===name&&!a.getAttribute('data-scroll'));
  });
  try{ history.replaceState(null,"","#"+name); }catch(e){}
  if(scrollId){
    setTimeout(function(){
      var t=document.getElementById(scrollId);
      if(t) t.scrollIntoView({behavior:'smooth'});
    },60);
  }else{
    window.scrollTo(0,0);
  }
}

function render(){
  var grid=document.getElementById('gigGrid'); grid.innerHTML="";
  var list=GIGS.filter(function(g){
    var okCat=activeCat==="all"||g.cat===activeCat;
    var okQ=!query||(g.title+" "+g.seller+" "+g.catLabel).toLowerCase().indexOf(query)>-1;
    return okCat&&okQ;
  });
  document.getElementById('countLabel').textContent=list.length+(list.length===1?" gig":" gigs");
  document.getElementById('emptyMsg').style.display=list.length?"none":"block";
  list.forEach(function(g){
    var btn=document.createElement('button'); btn.className="gig";
    var price=Number(g.price)||0, orders=Number(g.orders)||0;
    btn.innerHTML='<div class="cover" style="background:'+safeColor(g.color,g.cat)+'"><span class="tag">'+esc(g.tag)+'</span><div><h3>'+esc(g.title)+'</h3><p>'+esc(g.catLabel)+' · from $'+price+'</p></div></div>'
      +'<div class="gig-body"><div class="seller"><div class="avatar" style="background:'+safeColor(g.color,g.cat)+'">'+esc(g.initial)+'</div><div><b>'+esc(g.seller)+'</b><span>Seller · '+orders+' orders done</span></div></div>'
      +'<div class="gig-title">'+esc(g.desc)+'</div>'
      +'<div class="meta"><span class="stars">★ '+esc(g.rating)+'</span><span class="price"><small>Starting at</small>$'+price+'</span></div></div>';
    btn.onclick=function(){openModal(g);};
    grid.appendChild(btn);
  });
  renderMyGigs();
}
function applySearch(){ query=document.getElementById('searchInput').value.trim().toLowerCase(); render(); document.getElementById('gigs').scrollIntoView({behavior:'smooth'}); }
function quickSearch(q){ document.getElementById('searchInput').value=q; applySearch(); }

function openModal(g){
  currentGig=g; selectedPack=0;
  document.getElementById('mSeller').textContent=g.seller+" · Seller";
  document.getElementById('mCover').style.background=safeColor(g.color,g.cat);
  document.getElementById('mCat').textContent=g.catLabel;
  document.getElementById('mTitle').textContent=g.title;
  document.getElementById('mDesc').textContent=g.desc;
  document.getElementById('mRating').textContent=g.rating;
  document.getElementById('mDelivery').textContent=g.delivery;
  renderPacks(); updateTotals();
  document.getElementById('overlay').classList.add('open');
  document.body.style.overflow="hidden";
}
function renderPacks(){
  var box=document.getElementById('mPacks'); box.innerHTML="";
  currentGig.packs.forEach(function(p,i){
    var b=document.createElement('button'); b.className="pack"+(i===selectedPack?" sel":"");
    b.innerHTML='<b>'+esc(p[0])+'</b><div class="amt">$'+(Number(p[1])||0)+'</div><ul>'+p[2].map(function(f){return '<li>'+esc(f)+'</li>'}).join('')+'</ul>';
    b.onclick=function(){ selectedPack=i; renderPacks(); updateTotals(); };
    box.appendChild(b);
  });
}
function updateTotals(){
  var amt=Number(currentGig.packs[selectedPack][1])||0;
  document.getElementById('mTotal').textContent="$"+amt;
  document.getElementById('mSellerGets').textContent="$"+(amt*0.95).toFixed(2);
  document.getElementById('mFee').textContent="$"+(amt*0.05).toFixed(2);
}
function closeModal(){ document.getElementById('overlay').classList.remove('open'); document.body.style.overflow=""; }
function gotoKeyPanel(){
  showPage('profile');
  setTimeout(function(){
    document.getElementById('keyPanel').scrollIntoView({behavior:'smooth',block:'center'});
    document.getElementById('firebaseConfigInput').focus();
  },80);
}
function placeOrder(){
  var pack=currentGig.packs[selectedPack];
  var amt=Number(pack[1])||0;
  if(!fbDb){
    if(readStoredConfig()){
      showToast("Firebase যুক্ত হচ্ছে — একটু অপেক্ষা করে আবার Continue চাপুন");
      connectFirebase(readStoredConfig());
      return;
    }
    showToast("অর্ডার সেভ করতে আগে Profile পেজের Firebase Setup প্যানেলে চাবি বসিয়ে Connect করুন");
    closeModal();
    gotoKeyPanel();
    return;
  }
  if(!fbUser){
    showToast("অর্ডার সেভ করতে আগে Google দিয়ে Sign in করুন — Sign in খুলে দিচ্ছি");
    signIn();
    return;
  }
  if(currentGig.sellerUid&&currentGig.sellerUid===fbUser.uid){
    showToast("নিজের gig-এ নিজে অর্ডার দেওয়া যায় না");
    return;
  }
  var trx=document.getElementById('mTrx').value.trim();
  if(!trx){
    showToast("আগে বিকাশ/নগদে টাকা পাঠিয়ে TrxID-টা লিখুন — TrxID ছাড়া অর্ডার Confirm হবে না");
    document.getElementById('mTrx').focus();
    return;
  }
  var btn=document.getElementById('orderBtn');
  btn.disabled=true; btn.textContent="সেভ হচ্ছে…";
  fbDb.collection('orders').add({
    gigId:String(currentGig.id), gigTitle:currentGig.title, seller:currentGig.seller,
    sellerUid:currentGig.sellerUid||"",
    pack:pack[0], amount:amt, sellerGets:+(amt*0.95).toFixed(2), fee:+(amt*0.05).toFixed(2),
    notes:document.getElementById('mNotes').value.trim(),
    method:document.getElementById('mMethod').value,
    senderNumber:document.getElementById('mSender').value.trim(),
    trxId:trx,
    buyerUid:fbUser.uid, buyerName:fbUser.displayName||"", buyerEmail:fbUser.email||"",
    status:"placed", createdAt:firebase.firestore.FieldValue.serverTimestamp()
  }).then(function(){
    btn.disabled=false; btn.textContent="Continue — Place Order";
    closeModal();
    showToast("✅ অর্ডার সেভ হয়েছে — "+currentGig.title+" · "+pack[0]+" $"+amt+". Inbox পেজে 'আমার অর্ডার'-এ দেখুন, Chat পেজে সেলারের সাথে কথা বলুন।");
    showPage('inbox');
  }).catch(function(err){
    btn.disabled=false; btn.textContent="Continue — Place Order";
    if(err&&err.code==="permission-denied"){
      showToast("Firestore অনুমতি দিচ্ছে না — Console → Firestore Database → Rules-এ সাইন-ইন করা ব্যবহারকারীর জন্য read/write চালু করুন");
    }else{
      showToast("অর্ডার সেভ হয়নি: "+(err&&err.message?err.message:err));
    }
  });
}
var toastTimer;
function showToast(msg){
  var t=document.getElementById('toast'); t.textContent=msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer=setTimeout(function(){t.classList.remove('show')},4200);
}

/* ---- Firebase SDK: lazy load, gstatic first, cdnjs fallback ---- */
var SDK_SOURCES=[
  ["https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js",
   "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js",
   "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-compat.js",
   "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage-compat.js",
   "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions-compat.js"],
  ["https://cdnjs.cloudflare.com/ajax/libs/firebase/10.12.2/firebase-app-compat.min.js",
   "https://cdnjs.cloudflare.com/ajax/libs/firebase/10.12.2/firebase-auth-compat.min.js",
   "https://cdnjs.cloudflare.com/ajax/libs/firebase/10.12.2/firebase-firestore-compat.min.js",
   "https://cdnjs.cloudflare.com/ajax/libs/firebase/10.12.2/firebase-storage-compat.min.js",
   "https://cdnjs.cloudflare.com/ajax/libs/firebase/10.12.2/firebase-functions-compat.min.js"]
];
var sdkPromise=null;
function sdkReady(){
  return typeof firebase!=="undefined"&&!!firebase.initializeApp&&!!firebase.auth&&!!firebase.firestore&&!!firebase.storage&&!!firebase.functions;
}
function loadOneScript(src){
  return new Promise(function(resolve,reject){
    var s=document.createElement('script');
    s.src=src; s.async=true;
    var t=setTimeout(function(){ s.onload=s.onerror=null; reject(new Error("timeout")); },9000);
    s.onload=function(){ clearTimeout(t); resolve(); };
    s.onerror=function(){ clearTimeout(t); reject(new Error("load failed")); };
    document.head.appendChild(s);
  });
}
function loadFirebaseSdk(){
  if(sdkReady()) return Promise.resolve(true);
  if(sdkPromise) return sdkPromise;
  var chain=Promise.resolve(false);
  SDK_SOURCES.forEach(function(urls){
    chain=chain.then(function(ok){
      if(ok||sdkReady()) return true;
      var p=Promise.resolve();
      urls.forEach(function(u){ p=p.then(function(){ return loadOneScript(u); }); });
      return p.then(function(){ return sdkReady(); },function(){ return sdkReady(); });
    });
  });
  sdkPromise=chain.then(function(ok){ if(!ok) sdkPromise=null; return ok; });
  return sdkPromise;
}

/* ---- Firebase key panel: paste config -> Connect -> Google sign-in ---- */
var fbApp=null, fbUser=null, fbDb=null, gigsUnsub=null;
var myOrders=[], workOrders=[], supportThreads=[], msgUnsubs={}, currentThread=null, reviewStars=5;
var FB_FIELDS=["apiKey","authDomain","projectId","storageBucket","messagingSenderId","appId","measurementId"];
function setKeyStatus(html,kind){
  var box=document.getElementById('keyStatus');
  if(!html){ box.style.display="none"; box.innerHTML=""; return; }
  box.style.display="block"; box.innerHTML=html;
  if(kind==="ok"){ box.style.background="var(--green-soft)"; box.style.border="1.5px solid var(--green)"; box.style.color="var(--text)"; }
  else if(kind==="err"){ box.style.background="var(--coral-soft)"; box.style.border="1.5px solid var(--coral)"; box.style.color="var(--text)"; }
  else { box.style.background="var(--amber-soft)"; box.style.border="1.5px solid var(--amber)"; box.style.color="var(--text)"; }
}
function parseFirebaseConfig(raw){
  var cfg={}, found=0;
  FB_FIELDS.forEach(function(k){
    var m=raw.match(new RegExp(k+'\\s*:\\s*"([^"]+)"'))||raw.match(new RegExp(k+"\\s*:\\s*'([^']+)'"));
    if(m){ cfg[k]=m[1]; found++; }
  });
  return found?cfg:null;
}
/* The Firebase web config is a public client key (not a password), and the
   owner asked for it to persist in this browser: saved on Connect, removed
   on Disconnect, auto-connected on page load. Storage can be unavailable
   (private mode / blocked), so every access is guarded. */
var FB_STORE_KEY="workbazaar_firebase_config";
function saveStoredConfig(cfg){
  try{ localStorage.setItem(FB_STORE_KEY,JSON.stringify(cfg)); return true; }catch(e){ return false; }
}
function readStoredConfig(){
  try{
    var raw=localStorage.getItem(FB_STORE_KEY);
    if(!raw) return null;
    var cfg=JSON.parse(raw);
    return (cfg&&cfg.apiKey&&cfg.projectId)?cfg:null;
  }catch(e){ return null; }
}
function clearStoredConfig(){
  try{ localStorage.removeItem(FB_STORE_KEY); }catch(e){}
}
function configToText(cfg){
  var lines=FB_FIELDS.filter(function(k){ return cfg[k]; }).map(function(k){ return '  '+k+': "'+cfg[k]+'"'; });
  return "const firebaseConfig = {\n"+lines.join(",\n")+"\n};";
}
function connectFirebase(autoCfg){
  var cfg, raw="";
  if(autoCfg&&autoCfg.apiKey&&autoCfg.projectId){
    cfg=autoCfg;
  }else{
    raw=document.getElementById('firebaseConfigInput').value.trim();
    if(!raw){
      setKeyStatus("⚠️ বাক্সটা খালি — আগে Firebase Console থেকে চাবিটা কপি করে এখানে বসান, তারপর Connect চাপুন।","err");
      return;
    }
    cfg=parseFirebaseConfig(raw);
    if(!cfg||!cfg.apiKey||!cfg.projectId){
      setKeyStatus("❌ এটা ঠিক চাবি মনে হচ্ছে না — apiKey বা projectId পাওয়া যায়নি। Console-এ <b>Config</b> গোল বোতামটা চেপে পুরো লেখাটা আবার কপি করে বসান।","err");
      return;
    }
  }
  /* Feedback first, before any network work: the click must visibly do
     something at once, and the key is saved before the SDK load so a
     failed load still leaves the key stored for the next attempt. */
  var btn=document.getElementById('connectBtn');
  btn.disabled=true; btn.textContent="⏳ যুক্ত হচ্ছে…";
  setKeyStatus("⏳ <b>যুক্ত করা হচ্ছে…</b> Project: <b>"+esc(cfg.projectId)+"</b> — Firebase লোড হচ্ছে, একটু অপেক্ষা করুন।","warn");
  var saved=saveStoredConfig(cfg);
  document.getElementById('firebaseConfigInput').value=configToText(cfg);
  loadFirebaseSdk().then(function(ok){
    btn.disabled=false;
    if(!ok){
      btn.textContent="🔌 Connect — Firebase যুক্ত করুন";
      var disc0=document.getElementById('disconnectBtn');
      if(disc0&&readStoredConfig()) disc0.style.display="";
      setKeyStatus("⚠️ চাবিটা ঠিক আছে (Project: <b>"+esc(cfg.projectId)+"</b>)"
        +(saved?" এবং এই ব্রাউজারে <b>সেভ হয়ে গেছে</b>":"")
        +", কিন্তু Firebase-এর ফাইল এই ব্রাউজারে লোড হয়নি — ইন্টারনেট সংযোগ দেখুন, অ্যাড-ব্লকার থাকলে এই সাইটের জন্য বন্ধ করুন, তারপর পেজটা আবার খুলে Connect চাপুন। পেজ আবার খুললে সেভ করা চাবি দিয়ে নিজে থেকে আবার চেষ্টা হবে।","warn");
      return;
    }
    try{
      try{ fbApp=firebase.initializeApp(cfg); }
      catch(e2){
        if(e2&&e2.code==="app/duplicate-app"){ fbApp=firebase.app(); }
        else throw e2;
      }
    }catch(e){
      btn.textContent="🔌 Connect — Firebase যুক্ত করুন";
      setKeyStatus("❌ Firebase যুক্ত হয়নি: "+esc(e&&e.message?e.message:e),"err");
      return;
    }
    var st=document.getElementById('step4Status');
    if(st){ st.textContent="হয়েছে ✓"; st.className="status done"; }
    var sc=document.getElementById('stepCount');
    if(sc) sc.textContent="4 / 7";
    btn.textContent="✓ যুক্ত হয়েছে — আবার Connect";
    var disc=document.getElementById('disconnectBtn');
    if(disc) disc.style.display="";
    setKeyStatus("✅ <b>Firebase যুক্ত হয়েছে!</b> Project: <b>"+esc(cfg.projectId)+"</b><br>"
      +(saved
        ? "💾 চাবিটা এই ব্রাউজারে <b>সেভ হয়ে গেছে</b> — পেজটা বন্ধ করে আবার খুললেও নিজে থেকে যুক্ত হবে, আবার বসাতে হবে না। চাবি মুছতে চাইলে নিচের <b>Disconnect</b> চাপুন।<br>"
        : "⚠️ এই ব্রাউজার চাবি সেভ করতে দিচ্ছে না (প্রাইভেট মোড হতে পারে) — তাই পেজটা আবার খুললে চাবিটা আবার বসাতে হবে।<br>")
      +"এবার উপরে ডানদিকে <b>Sign in</b> চাপ দিয়ে Google দিয়ে লগইন করে দেখুন। Sign in হয়ে গেলে নতুন Gig আর অর্ডার এখান থেকে সরাসরি Firebase-এ সেভ হবে।<br><span style='color:var(--muted);font-size:13.5px'>Sign in-এ \"unauthorized-domain\" লেখা এলে: Firebase Console → Authentication → Settings → Authorized domains-এ এই সাইটের ঠিকানাটা যোগ করতে হবে (ধাপ ৫)।</span>","ok");
    try{
      firebase.auth().onAuthStateChanged(function(u){
        fbUser=u||null;
        onAuthChanged();
      });
    }catch(e){}
    startFirestore(cfg.projectId);
    showToast("✅ Firebase যুক্ত হয়েছে — Project: "+cfg.projectId);
  }).catch(function(err){
    btn.disabled=false; btn.textContent="🔌 Connect — Firebase যুক্ত করুন";
    setKeyStatus("❌ যুক্ত করতে সমস্যা হয়েছে: "+esc(err&&err.message?err.message:err)+" — পেজটা আবার খুলে Connect চাপুন।","err");
  });
}
function disconnectFirebase(){
  clearStoredConfig();
  var done=function(){
    fbApp=null; fbDb=null; fbUser=null;
    if(gigsUnsub){ try{gigsUnsub();}catch(e){} gigsUnsub=null; }
    unsubAll();
    myOrders=[]; workOrders=[]; supportThreads=[];
    onAuthChanged();
    renderOrders(); renderWork(); renderConvs(); renderHelpMine();
    var cb=document.getElementById('connectBtn');
    if(cb) cb.textContent="🔌 Connect — Firebase যুক্ত করুন";
    var disc=document.getElementById('disconnectBtn');
    if(disc) disc.style.display="none";
    var st=document.getElementById('step4Status');
    if(st){ st.textContent="বাকি আছে"; st.className="status todo"; }
    var sc=document.getElementById('stepCount');
    if(sc) sc.textContent="3 / 7";
    document.getElementById('firebaseConfigInput').value="";
    setKeyStatus("⏏ <b>Disconnect হয়ে গেছে</b> — চাবিটা এই ব্রাউজার থেকে মুছে ফেলা হয়েছে। আবার ব্যবহার করতে চাইলে চাবিটা বসিয়ে Connect চাপুন।","warn");
    showToast("⏏ Disconnect হয়ে গেছে — সেভ করা চাবি মুছে ফেলা হয়েছে");
  };
  if(sdkReady()){
    try{ firebase.auth().signOut().then(done).catch(done); return; }catch(e){}
  }
  done();
}
function signIn(){
  if(fbUser&&fbApp){
    firebase.auth().signOut().then(function(){ showToast("Sign out হয়ে গেছে"); });
    return;
  }
  if(!fbApp){
    var savedCfg=readStoredConfig();
    if(savedCfg){
      showToast("Firebase যুক্ত হচ্ছে — যুক্ত হয়ে গেলে আবার Sign in চাপুন");
      connectFirebase(savedCfg);
      return;
    }
    showToast("আগে Profile পেজের Firebase Setup প্যানেলে চাবি বসিয়ে Connect চাপুন");
    gotoKeyPanel();
    return;
  }
  var provider=new firebase.auth.GoogleAuthProvider();
  firebase.auth().signInWithPopup(provider).then(function(res){
    showToast("✅ স্বাগতম, "+(res.user.displayName||res.user.email)+"!");
  }).catch(function(err){
    var code=(err&&err.code)||"";
    if(code==="auth/unauthorized-domain"){
      showToast("এই সাইটের ঠিকানা Firebase-এ যোগ করা হয়নি — Console → Authentication → Settings → Authorized domains-এ এই সাইটের ডোমেইনটা যোগ করুন (ধাপ ৫)");
    }else if(code==="auth/popup-closed-by-user"||code==="auth/cancelled-popup-request"){
      showToast("লগইন জানালাটা বন্ধ হয়ে গেছে — আবার Sign in চাপুন");
    }else if(code==="auth/popup-blocked"){
      showToast("ব্রাউজার Google-এর জানালা আটকে দিয়েছে — এই সাইটের জন্য popup Allow করে আবার Sign in চাপুন");
    }else if(code==="auth/operation-not-allowed"){
      showToast("Firebase-এ Google লগইন চালু নেই — Console → Authentication → Sign-in method → Google চালু করুন");
    }else{
      showToast("Sign in হয়নি: "+(err&&err.message?err.message:err));
    }
  });
}

/* ---- Auth-driven UI: header button, Profile page, subscriptions ---- */
function onAuthChanged(){
  var u=fbUser;
  var b=document.getElementById('signInBtn');
  if(b) b.textContent=u?("👤 "+(u.displayName||u.email||"Signed in")):"Sign in";
  var pb=document.getElementById('profileSignBtn');
  if(pb) pb.textContent=u?"Sign out করুন":"Google দিয়ে Sign in";
  var av=document.getElementById('profileAvatar');
  if(av) av.textContent=u?((u.displayName||u.email||"U").charAt(0).toUpperCase()):"?";
  var nm=document.getElementById('profileName');
  if(nm) nm.textContent=u?(u.displayName||"Signed in"):"Sign in করা হয়নি";
  var em=document.getElementById('profileEmail');
  if(em) em.textContent=u?(u.email||""):"Gig দিতে, অর্ডার পেতে আর Chat ব্যবহার করতে Google দিয়ে Sign in করুন।";
  renderMyGigs();
  if(u&&fbDb){ subscribeUserData(); loadPayout(); }
  else{
    unsubAll();
    myOrders=[]; workOrders=[]; supportThreads=[];
    renderOrders(); renderWork(); renderConvs(); renderHelpMine(); updateBadges();
    var sg=document.getElementById('statWorkGot'); if(sg) sg.textContent="0";
    var se=document.getElementById('statEarned'); if(se) se.textContent="$0";
    var wl=document.getElementById('workList');
    if(wl) wl.innerHTML='<p class="empty-note">Sign in করলে আপনার gig-এ আসা অর্ডারগুলো এখানে দেখা যাবে।</p>';
    var ml=document.getElementById('msgFromList');
    if(ml) ml.innerHTML='<p class="empty-note">কেউ মেসেজ পাঠালে তার নাম এখানে দেখা যাবে — মেসেজ পড়তে Chat পেজে যান।</p>';
  }
}
var userUnsubs=[];
function unsubOne(key){
  if(msgUnsubs[key]){ try{msgUnsubs[key]();}catch(e){} delete msgUnsubs[key]; }
}
function unsubAll(){
  userUnsubs.forEach(function(f){ try{f();}catch(e){} });
  userUnsubs=[];
  Object.keys(msgUnsubs).forEach(unsubOne);
  currentThread=null;
  var tp=document.getElementById('threadPanel'); if(tp) tp.style.display="none";
  var cl=document.getElementById('convList'); if(cl) cl.style.display="grid";
}
function sortByTime(list){
  list.sort(function(a,b){
    var ta=a.createdAt&&a.createdAt.seconds?a.createdAt.seconds:0;
    var tb=b.createdAt&&b.createdAt.seconds?b.createdAt.seconds:0;
    return tb-ta;
  });
  return list;
}
function subscribeUserData(){
  if(!fbDb||!fbUser) return;
  unsubAll();
  var uid=fbUser.uid;
  userUnsubs.push(fbDb.collection('orders').where('buyerUid','==',uid).onSnapshot(function(snap){
    var list=[]; snap.forEach(function(doc){ var d=doc.data(); d._id=doc.id; list.push(d); });
    myOrders=sortByTime(list);
    renderOrders(); renderConvs(); updateBadges();
  },function(){ myOrders=[]; renderOrders(); renderConvs(); updateBadges(); }));
  userUnsubs.push(fbDb.collection('orders').where('sellerUid','==',uid).onSnapshot(function(snap){
    var list=[]; snap.forEach(function(doc){ var d=doc.data(); d._id=doc.id; list.push(d); });
    workOrders=sortByTime(list);
    renderWork(); renderConvs(); updateBadges(); renderDashboard();
  },function(){ workOrders=[]; renderWork(); renderConvs(); updateBadges(); renderDashboard(); }));
  userUnsubs.push(fbDb.collection('support').where('uid','==',uid).onSnapshot(function(snap){
    var list=[]; snap.forEach(function(doc){ var d=doc.data(); d._id=doc.id; list.push(d); });
    supportThreads=sortByTime(list);
    renderHelpMine(); renderSupportConvs(); updateBadges();
  },function(){ supportThreads=[]; renderHelpMine(); renderSupportConvs(); updateBadges(); }));
  /* Admin side (the owner is signed in with the admin account too): every
     support thread in the project, so "Who messaged you" shows buyers and
     sellers asking for help. Guarded — if the rules deny it, it just stays
     empty and the personal lists above still work. */
  userUnsubs.push(fbDb.collection('support').onSnapshot(function(snap){
    window._allSupport=[];
    snap.forEach(function(doc){ var d=doc.data(); d._id=doc.id; window._allSupport.push(d); });
    renderMessagedYou(); renderSupportConvs(); updateBadges();
  },function(){ window._allSupport=null; renderMessagedYou(); }));
  subscribeConvMessages();
}
function updateBadges(){
  var work=workOrders.length;
  var chats=conversations().length+supportThreads.length+((window._allSupport||[]).filter(function(t){ return fbUser&&t.uid!==fbUser.uid; }).length);
  var ib=document.getElementById('inboxBadge');
  if(ib){ ib.textContent=work; ib.classList.toggle('show',work>0); }
  var cb=document.getElementById('chatBadge');
  if(cb){ cb.textContent=chats; cb.classList.toggle('show',chats>0); }
}
function renderDashboard(){
  var earned=0;
  workOrders.forEach(function(o){ earned+=Number(o.sellerGets)||0; });
  var sg=document.getElementById('statWorkGot'); if(sg) sg.textContent=workOrders.length;
  var se=document.getElementById('statEarned'); if(se) se.textContent="$"+(Math.round(earned*100)/100);
}

/* ---- Firestore: gigs load live ---- */
var CAT_LABELS={logo:"Logo & Branding",business:"Business",general:"General Services"};
var CAT_COLORS={logo:"linear-gradient(135deg,#0e7a4a,#0a5c38)",business:"linear-gradient(135deg,#e8930c,#b96e04)",general:"linear-gradient(135deg,#f45d48,#c93a26)"};
function fsPacksToLocal(packs){
  return (packs||[]).map(function(p){
    if(Array.isArray(p)) return p;
    return [p.name||"Basic", Number(p.price)||0, p.features||[]];
  });
}
function localPacksToFs(packs){
  return packs.map(function(p){ return {name:p[0], price:p[1], features:p[2]}; });
}
function safeColor(c,cat){
  var known=[CAT_COLORS.logo,CAT_COLORS.business,CAT_COLORS.general];
  if(known.indexOf(c)>-1) return c;
  if(/^linear-gradient\(135deg,#[0-9a-fA-F]{6},#[0-9a-fA-F]{6}\)$/.test(c||"")) return c;
  return CAT_COLORS[cat]||CAT_COLORS.general;
}
function startFirestore(projectId){
  if(!sdkReady()) return;
  try{ fbDb=firebase.firestore(); }catch(e){ return; }
  if(gigsUnsub) gigsUnsub();
  gigsUnsub=fbDb.collection('gigs').onSnapshot(function(snap){
    if(snap.empty) return; /* keep the 4 real gigs already on the page */
    var list=[];
    snap.forEach(function(doc){
      var d=doc.data();
      if(d.status==="paused"||d.status==="rejected") return;
      list.push({
        id:doc.id, title:d.title||"Gig", seller:d.seller||"Seller", sellerUid:d.sellerUid||"",
        cat:d.cat||"general", catLabel:d.catLabel||CAT_LABELS[d.cat]||"General Services",
        price:Number(d.price)||0, rating:d.rating||"New", orders:Number(d.orders)||0,
        delivery:d.delivery||"2 days", color:safeColor(d.color,d.cat),
        initial:(d.seller||"S").charAt(0).toUpperCase(), tag:d.tag||"New",
        desc:d.desc||"", packs:fsPacksToLocal(d.packs), imageUrl:d.imageUrl||"", imagePath:d.imagePath||"", status:d.status||"active"
      });
    });
    if(list.length){ GIGS=list; render(); }
  },function(err){
    if(err&&err.code==="permission-denied"){
      setKeyStatus("⚠️ Firebase যুক্ত হয়েছে (Project: <b>"+esc(projectId)+"</b>), কিন্তু Firestore gig পড়তে অনুমতি দিচ্ছে না। Console → Firestore Database → <b>Rules</b>-এ সাইন-ইন করা ব্যবহারকারীর জন্য read/write চালু করে দিন, তারপর পেজটা আবার খুলুন।","warn");
    }
  });
  if(fbUser) subscribeUserData();
}

/* ---- Profile: my gigs + payout numbers ---- */
function renderMyGigs(){
  var box=document.getElementById('myGigsList'); if(!box) return;
  var stat=document.getElementById('statMyGigs');
  if(!fbUser){
    box.innerHTML='<p class="empty-note bn">Sign in করলে এই সাইটে আপনার দেওয়া gig গুলো এখানে দেখা যাবে।</p>';
    if(stat) stat.textContent="0";
    return;
  }
  var mine=GIGS.filter(function(g){ return g.sellerUid&&g.sellerUid===fbUser.uid; });
  if(stat) stat.textContent=mine.length;
  if(!mine.length){
    box.innerHTML='<p class="empty-note bn">এই সাইট থেকে এখনো কোনো gig দেননি — "নতুন Gig তৈরি করুন" চাপ দিয়ে প্রথম gig-টা দিন।</p>';
    return;
  }
  box.innerHTML="";
  mine.forEach(function(g){
    var row=document.createElement('div'); row.className="listrow";
    row.innerHTML='<div class="avatar" style="background:'+safeColor(g.color,g.cat)+'">'+esc(g.initial)+'</div>'
      +'<div style="flex:1"><b>'+esc(g.title)+'</b><div style="color:var(--muted);font-size:13.5px">'+esc(g.catLabel)+' · '+esc(g.orders)+' orders · ★ '+esc(g.rating)+'</div></div>'
      +'<b>'+money(g.price)+'</b><span style="color:var(--muted);font-size:13px">থেকে</span>';
    box.appendChild(row);
  });
}
function loadPayout(){
  if(!fbDb||!fbUser) return;
  fbDb.collection('users').doc(fbUser.uid).get().then(function(doc){
    if(!doc.exists) return;
    var d=doc.data()||{};
    var b=document.getElementById('payBkash'), n=document.getElementById('payNagad'), nm=document.getElementById('payName');
    if(b&&d.bkash) b.value=d.bkash;
    if(n&&d.nagad) n.value=d.nagad;
    if(nm&&d.accountName) nm.value=d.accountName;
    var st=document.getElementById('payStatus');
    if(st&&(d.bkash||d.nagad)) st.textContent="✓ সেভ করা নম্বর লোড হয়েছে";
  }).catch(function(){});
  /* The admin's WhatsApp number lives on the admin's own user doc under a
     public settings doc if present — read the shared settings doc so the
     Help panel can show the WhatsApp button when the owner set one. */
  fbDb.collection('settings').doc('payments').get().then(function(doc){
    if(!doc.exists) return;
    var d=doc.data()||{};
    var wa=(d.whatsapp||"").replace(/\D/g,"");
    var btn=document.getElementById('helpWhatsapp');
    if(btn&&wa){ btn.href="https://wa.me/"+wa; btn.style.display=""; }
  }).catch(function(){});
}
function savePayout(){
  if(!fbDb){ showToast("আগে Profile পেজের Firebase Setup প্যানেলে চাবি বসিয়ে Connect করুন"); gotoKeyPanel(); return; }
  if(!fbUser){ showToast("নম্বর সেভ করতে আগে Google দিয়ে Sign in করুন"); signIn(); return; }
  var bk=document.getElementById('payBkash').value.trim();
  var ng=document.getElementById('payNagad').value.trim();
  var nm=document.getElementById('payName').value.trim();
  if(!bk&&!ng){ showToast("অন্তত একটা নম্বর লিখুন — বিকাশ বা নগদ"); return; }
  var btn=document.getElementById('paySaveBtn');
  btn.disabled=true; btn.textContent="সেভ হচ্ছে…";
  fbDb.collection('users').doc(fbUser.uid).set({
    bkash:bk, nagad:ng, accountName:nm,
    name:fbUser.displayName||"", email:fbUser.email||"",
    updatedAt:firebase.firestore.FieldValue.serverTimestamp()
  },{merge:true}).then(function(){
    btn.disabled=false; btn.textContent="নম্বর সেভ করুন";
    var st=document.getElementById('payStatus');
    if(st) st.textContent="✓ সেভ হয়েছে — "+new Date().toLocaleTimeString();
    showToast("✅ পে-আউট নম্বর সেভ হয়েছে");
  }).catch(function(err){
    btn.disabled=false; btn.textContent="নম্বর সেভ করুন";
    showToast(err&&err.code==="permission-denied"?"Firestore অনুমতি দিচ্ছে না — Rules-এ users কালেকশনে নিজের ডক লেখার অনুমতি লাগবে":"সেভ হয়নি: "+(err&&err.message?err.message:err));
  });
}

/* ---- Inbox: my orders (buyer) + work received (seller) + help ---- */
function orderCard(o,mine){
  var div=document.createElement('div');
  div.className="panel"; div.style.padding="16px 18px";
  var who=mine?('বায়ার: '+esc(o.buyerName||o.buyerEmail||"Buyer")):('সেলার: '+esc(o.seller));
  div.innerHTML='<div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:center">'
    +'<div><b>'+esc(o.gigTitle)+'</b> <span style="color:var(--muted);font-size:13.5px">· '+esc(o.pack)+' প্যাকেজ · '+who+'</span></div>'
    +'<span class="status '+(o.status==="completed"?"done":"todo")+'">'+(o.status==="completed"?"Complete ✓":"অর্ডার হয়েছে — পেমেন্ট যাচাই বাকি")+'</span></div>'
    +'<div style="color:var(--muted);font-size:14px;margin-top:4px" class="bn">মোট <b style="color:var(--text)">$'+(Number(o.amount)||0)+'</b> · সেলার পাবে <b style="color:var(--green)">$'+Number(o.sellerGets||0).toFixed(2)+'</b> · প্ল্যাটফর্ম <b style="color:var(--amber)">$'+Number(o.fee||0).toFixed(2)+'</b>'
    +(o.trxId?' · '+esc(o.method)+' TrxID: '+esc(o.trxId):'')+'</div>'
    +(o.review?'<div style="font-size:14px;margin-top:6px">★ রিভিউ: <b>'+esc(o.review.stars)+' / 5</b>'+(o.review.text?' — '+esc(o.review.text):'')+'</div>':'')
    +'<div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">'
    +'<button class="btn" style="padding:8px 14px" data-chat="'+esc(o._id)+'">💬 Chat খুলুন</button>'
    +(mine&&o.status!=="completed"?'<button class="btn btn-primary" style="padding:8px 14px" data-confirm="'+esc(o._id)+'">Payment received — Confirm করুন</button>':'')
    +'</div>';
  var chatBtn=div.querySelector('[data-chat]');
  if(chatBtn) chatBtn.addEventListener('click',function(){ openThread('order',o._id); });
  var confBtn=div.querySelector('[data-confirm]');
  if(confBtn) confBtn.addEventListener('click',function(){ confirmPayment(o); });
  return div;
}
function renderOrders(){
  var box=document.getElementById('ordersList'), empty=document.getElementById('ordersEmpty');
  if(!box) return;
  box.innerHTML="";
  myOrders.forEach(function(o){ box.appendChild(orderCard(o,false)); });
  if(empty) empty.style.display=myOrders.length?"none":"block";
}
function renderWork(){
  var box=document.getElementById('workList'); if(!box) return;
  if(!fbUser) return; /* signed-out note already in the HTML / onAuthChanged */
  if(!workOrders.length){
    box.innerHTML='<p class="empty-note">এখনো কেউ আপনার gig-এ অর্ডার দেয়নি — নতুন অর্ডার এলে এখানে দেখা যাবে।</p>';
    return;
  }
  box.innerHTML="";
  workOrders.forEach(function(o){ box.appendChild(orderCard(o,true)); });
}
function confirmPayment(o){
  if(!fbDb||!fbUser) return;
  fbDb.collection('orders').doc(o._id).update({status:"confirmed",paymentConfirmedBy:fbUser.uid}).then(function(){
    showToast("✅ Payment received Confirm হয়েছে — এবার সেলারকে 95% ("+money(o.sellerGets)+") পাঠান। সেলারের পে-আউট নম্বর তার Profile-এ সেভ করা আছে।");
  }).catch(function(err){
    showToast(err&&err.code==="permission-denied"?"এই অর্ডার আপডেটের অনুমতি নেই — শুধু অর্ডারের সেলার বা অ্যাডমিন Confirm করতে পারবে":"Confirm হয়নি: "+(err&&err.message?err.message:err));
  });
}

/* ---- Chat: order conversations + admin support threads ---- */
function conversations(){
  var seen={}, list=[];
  myOrders.forEach(function(o){
    if(seen[o._id]) return; seen[o._id]=1;
    list.push({kind:"order",id:o._id,title:o.gigTitle,other:o.seller||"Seller",meSeller:false,order:o});
  });
  workOrders.forEach(function(o){
    if(seen[o._id]) return; seen[o._id]=1;
    list.push({kind:"order",id:o._id,title:o.gigTitle,other:o.buyerName||o.buyerEmail||"Buyer",meSeller:true,order:o});
  });
  return list;
}
function subscribeConvMessages(){
  if(!fbDb||!fbUser) return;
  var ids={};
  conversations().forEach(function(c){ ids[c.id]=1; });
  supportThreads.forEach(function(t){ ids[t._id]=1; });
  (window._allSupport||[]).forEach(function(t){ ids[t._id]=1; });
  Object.keys(msgUnsubs).forEach(function(k){ if(!ids[k]) unsubOne(k); });
  Object.keys(ids).forEach(function(id){
    if(msgUnsubs[id]) return;
    msgUnsubs[id]=fbDb.collection('messages').where('threadId','==',id).onSnapshot(function(snap){
      var list=[]; snap.forEach(function(doc){ var d=doc.data(); d._id=doc.id; list.push(d); });
      window._msgs=window._msgs||{}; window._msgs[id]=sortByTime(list).reverse();
      if(currentThread&&currentThread.id===id) renderThreadMsgs();
      renderMessagedYou(); updateBadges();
    },function(){});
  });
}
function renderConvs(){
  var box=document.getElementById('convList'), empty=document.getElementById('convEmpty');
  if(!box) return;
  box.innerHTML="";
  var list=conversations();
  list.forEach(function(c){
    var b=document.createElement('button'); b.className="conv";
    b.innerHTML='<div class="avatar" style="background:var(--green)">'+esc((c.other||"U").charAt(0).toUpperCase())+'</div>'
      +'<div style="flex:1"><b>'+esc(c.other)+'</b><div style="color:var(--muted);font-size:13.5px" class="bn">'+esc(c.title)+' · '+(c.meSeller?"আপনি সেলার":"আপনি বায়ার")+' · '+esc(c.order.pack||"")+' '+money(c.order.amount)+'</div></div>'
      +'<span class="pill">Chat →</span>';
    b.addEventListener('click',function(){ openThread('order',c.id); });
    box.appendChild(b);
  });
  renderSupportConvs();
  if(empty) empty.style.display=(list.length||supportThreads.length||(window._allSupport||[]).length)?"none":"block";
}
function renderSupportConvs(){
  var box=document.getElementById('convList'); if(!box||!fbUser) return;
  box.querySelectorAll('[data-support]').forEach(function(el){ el.remove(); });
  var mine=supportThreads.map(function(t){ return {t:t,admin:false}; });
  var others=(window._allSupport||[]).filter(function(t){ return t.uid!==fbUser.uid; }).map(function(t){ return {t:t,admin:true}; });
  mine.concat(others).forEach(function(item){
    var t=item.t;
    var b=document.createElement('button'); b.className="conv"; b.setAttribute('data-support',t._id);
    b.innerHTML='<div class="avatar" style="background:var(--amber)">'+esc((t.name||"A").charAt(0).toUpperCase())+'</div>'
      +'<div style="flex:1"><b>'+(item.admin?esc(t.name||"User")+" — Admin support":"Admin support")+'</b><div style="color:var(--muted);font-size:13.5px" class="bn">'+esc(t.message||"")+'</div></div>'
      +'<span class="pill">Chat →</span>';
    b.addEventListener('click',function(){ openThread('support',t._id); });
    box.appendChild(b);
  });
  var empty=document.getElementById('convEmpty');
  if(empty) empty.style.display=(conversations().length||supportThreads.length||(window._allSupport||[]).length)?"none":"block";
  subscribeConvMessages();
}
function renderMessagedYou(){
  var box=document.getElementById('msgFromList'); if(!box||!fbUser) return;
  var names={}, any=false;
  Object.keys(window._msgs||{}).forEach(function(tid){
    (window._msgs[tid]||[]).forEach(function(m){
      if(m.fromUid&&m.fromUid!==fbUser.uid){ names[m.fromName||"User"]=1; any=true; }
    });
  });
  (window._allSupport||[]).forEach(function(t){ if(t.uid!==fbUser.uid){ names[t.name||"User"]=1; any=true; } });
  if(!any){
    box.innerHTML='<p class="empty-note">কেউ মেসেজ পাঠালে তার নাম এখানে দেখা যাবে — মেসেজ পড়তে Chat পেজে যান।</p>';
    return;
  }
  box.innerHTML="";
  Object.keys(names).forEach(function(n){
    var row=document.createElement('div'); row.className="listrow";
    row.innerHTML='<div class="avatar" style="background:var(--amber)">'+esc(n.charAt(0).toUpperCase())+'</div><div style="flex:1"><b>'+esc(n)+'</b><div style="color:var(--muted);font-size:13.5px" class="bn">আপনাকে মেসেজ পাঠিয়েছে</div></div>';
    var btn=document.createElement('button'); btn.className="btn"; btn.style.padding="8px 14px"; btn.textContent="Chat →";
    btn.addEventListener('click',function(){ showPage('chat'); });
    row.appendChild(btn);
    box.appendChild(row);
  });
}
function openThread(kind,id){
  var title="", sub="";
  if(kind==="order"){
    var c=conversations().filter(function(x){ return x.id===id; })[0];
    if(!c) return;
    currentThread={kind:kind,id:id,order:c.order,meSeller:c.meSeller};
    title=c.title; sub=(c.meSeller?"বায়ার: ":"সেলার: ")+c.other+" · "+(c.order.pack||"")+" "+money(c.order.amount)+" · স্ট্যাটাস: "+(c.order.status||"placed");
  }else{
    var t=supportThreads.concat(window._allSupport||[]).filter(function(x){ return x._id===id; })[0];
    if(!t) return;
    currentThread={kind:kind,id:id,support:t};
    title="Admin support"; sub=(t.name||"")+" ("+(t.role||"")+") — "+(t.message||"");
  }
  document.getElementById('threadTitle').textContent=title;
  document.getElementById('threadSub').textContent=sub;
  document.getElementById('convList').style.display="none";
  var ce=document.getElementById('convEmpty'); if(ce) ce.style.display="none";
  document.getElementById('threadPanel').style.display="block";
  var cb=document.getElementById('completeBtn');
  var rb=document.getElementById('reviewBox');
  if(kind==="order"&&!currentThread.meSeller){
    cb.style.display=currentThread.order.status==="confirmed"?"":"none";
    rb.style.display=currentThread.order.status==="completed"?"block":"none";
  }else{ cb.style.display="none"; rb.style.display="none"; }
  subscribeConvMessages();
  renderThreadMsgs();
}
function closeThread(){
  currentThread=null;
  document.getElementById('threadPanel').style.display="none";
  document.getElementById('convList').style.display="grid";
  renderConvs();
}
function renderThreadMsgs(){
  if(!currentThread) return;
  var box=document.getElementById('threadMsgs'); if(!box) return;
  var list=(window._msgs&&window._msgs[currentThread.id])||[];
  box.innerHTML="";
  list.forEach(function(m){
    var d=document.createElement('div');
    d.className="msg "+(fbUser&&m.fromUid===fbUser.uid?"me":"them");
    d.innerHTML=esc(m.text||"")+'<small>'+esc(m.fromName||"")+'</small>';
    box.appendChild(d);
  });
  var te=document.getElementById('threadEmpty');
  if(te) te.style.display=list.length?"none":"block";
  box.scrollTop=box.scrollHeight;
}
function sendThreadMsg(){
  if(!currentThread) return;
  if(!fbDb){ showToast("আগে Profile পেজে Firebase Connect করুন"); gotoKeyPanel(); return; }
  if(!fbUser){ showToast("মেসেজ পাঠাতে আগে Sign in করুন"); signIn(); return; }
  var input=document.getElementById('threadInput');
  var text=input.value.trim();
  if(!text) return;
  input.value="";
  fbDb.collection('messages').add({
    threadId:currentThread.id, kind:currentThread.kind,
    fromUid:fbUser.uid, fromName:fbUser.displayName||fbUser.email||"User",
    text:text, createdAt:firebase.firestore.FieldValue.serverTimestamp()
  }).catch(function(err){
    showToast(err&&err.code==="permission-denied"?"মেসেজ পাঠানোর অনুমতি নেই — Firestore Rules-এ messages কালেকশনে সাইন-ইন করা ব্যবহারকারীর লেখার অনুমতি লাগবে":"মেসেজ যায়নি: "+(err&&err.message?err.message:err));
  });
}
function completeOrder(){
  if(!currentThread||currentThread.kind!=="order") return;
  var o=currentThread.order;
  fbDb.collection('orders').doc(o._id).update({status:"completed"}).then(function(){
    showToast("✅ অর্ডার Complete হয়েছে — নিচে রিভিউ দিন");
    o.status="completed";
    var cb=document.getElementById('completeBtn'); if(cb) cb.style.display="none";
    var rb=document.getElementById('reviewBox'); if(rb) rb.style.display="block";
  }).catch(function(err){
    showToast("Complete হয়নি: "+(err&&err.message?err.message:err));
  });
}
function sendReview(){
  if(!currentThread||currentThread.kind!=="order") return;
  var o=currentThread.order;
  var text=document.getElementById('reviewText').value.trim();
  fbDb.collection('orders').doc(o._id).update({review:{stars:reviewStars,text:text,by:fbUser.uid}}).then(function(){
    showToast("✅ রিভিউ সেভ হয়েছে — ★ "+reviewStars);
    document.getElementById('reviewBox').style.display="none";
  }).catch(function(err){
    showToast("রিভিউ সেভ হয়নি: "+(err&&err.message?err.message:err));
  });
}

/* ---- Inbox help panel: contact the admin ---- */
var helpRole="buyer";
function sendHelp(){
  var name=document.getElementById('helpName').value.trim();
  var msg=document.getElementById('helpMsg').value.trim();
  if(!name){ showToast("আগে আপনার নাম লিখুন"); document.getElementById('helpName').focus(); return; }
  if(!msg){ showToast("মেসেজটা লিখুন"); document.getElementById('helpMsg').focus(); return; }
  if(!fbDb){
    if(readStoredConfig()){ showToast("Firebase যুক্ত হচ্ছে — একটু পরে আবার পাঠান চাপুন"); connectFirebase(readStoredConfig()); return; }
    showToast("মেসেজ পাঠাতে আগে Profile পেজে Firebase Connect করুন"); gotoKeyPanel(); return;
  }
  if(!fbUser){ showToast("মেসেজ পাঠাতে আগে Google দিয়ে Sign in করুন"); signIn(); return; }
  var btn=document.getElementById('helpSendBtn');
  btn.disabled=true; btn.textContent="পাঠানো হচ্ছে…";
  fbDb.collection('support').add({
    name:name, role:helpRole, message:msg,
    uid:fbUser.uid, email:fbUser.email||"",
    createdAt:firebase.firestore.FieldValue.serverTimestamp()
  }).then(function(){
    btn.disabled=false; btn.textContent="অ্যাডমিনকে পাঠান";
    document.getElementById('helpMsg').value="";
    showToast("✅ মেসেজ অ্যাডমিনের কাছে গেছে — উত্তর Chat পেজে 'Admin support'-এ পাবেন");
  }).catch(function(err){
    btn.disabled=false; btn.textContent="অ্যাডমিনকে পাঠান";
    showToast(err&&err.code==="permission-denied"?"পাঠানোর অনুমতি নেই — Firestore Rules-এ support কালেকশনে লেখার অনুমতি লাগবে":"পাঠানো যায়নি: "+(err&&err.message?err.message:err));
  });
}
function renderHelpMine(){
  var box=document.getElementById('helpMine'); if(!box) return;
  if(!supportThreads.length){ box.innerHTML=""; return; }
  box.innerHTML='<b class="bn">আপনার পাঠানো মেসেজ:</b>';
  supportThreads.forEach(function(t){
    var d=document.createElement('div'); d.className="listrow";
    d.innerHTML='<div style="flex:1"><b>'+esc(t.message||"")+'</b><div style="color:var(--muted);font-size:13px" class="bn">অ্যাডমিনের উত্তর Chat পেজে দেখুন</div></div>'
      +'<button class="btn" style="padding:8px 14px">উত্তর দেখুন →</button>';
    d.querySelector('button').addEventListener('click',function(){ showPage('chat'); openThread('support',t._id); });
    box.appendChild(d);
  });
}

/* ---- Create a Gig form: separate price per package, NO upper limit ---- */
function openGigForm(){
  if(!fbDb){
    if(readStoredConfig()){
      showToast("Firebase যুক্ত হচ্ছে — একটু অপেক্ষা করে আবার Create a Gig চাপুন");
      connectFirebase(readStoredConfig());
      return;
    }
    showToast("Gig সেভ করতে আগে Profile পেজের Firebase Setup প্যানেলে চাবি বসিয়ে Connect করুন");
    gotoKeyPanel();
    return;
  }
  if(!fbUser){
    showToast("Gig তৈরি করতে আগে Google দিয়ে Sign in করুন — Sign in খুলে দিচ্ছি");
    signIn();
    return;
  }
  document.getElementById('gigOverlay').classList.add('open');
  document.body.style.overflow="hidden";
}
function closeGigForm(){ document.getElementById('gigOverlay').classList.remove('open'); document.body.style.overflow=""; }
function submitGig(){
  var title=document.getElementById('gTitle').value.trim().replace(/[<>]/g,"");
  var cat=document.getElementById('gCat').value;
  var pB=parseFloat(document.getElementById('gPriceB').value);
  var pS=parseFloat(document.getElementById('gPriceS').value);
  var pP=parseFloat(document.getElementById('gPriceP').value);
  var days=parseInt(document.getElementById('gDays').value,10);
  var desc=document.getElementById('gDesc').value.trim().replace(/[<>]/g,"");
  if(!title){ showToast("Gig-এর টাইটেল লিখুন"); document.getElementById('gTitle').focus(); return; }
  if(!(pB>0)){ showToast("Basic প্যাকেজের দাম লিখুন (USD) — যেকোনো দাম, $99-এর বেশিও চলবে"); document.getElementById('gPriceB').focus(); return; }
  if(!(pS>0)) pS=Math.round(pB*2*100)/100;
  if(!(pP>0)) pP=Math.round(pB*4*100)/100;
  if(!desc){ showToast("বিবরণে কি সার্ভিস দেবেন লিখুন"); document.getElementById('gDesc').focus(); return; }
  if(!(days>0)) days=2;
  var sellerName=fbUser.displayName||fbUser.email||"Seller";
  var packs=[
    ["Basic",pB,["Standard delivery in "+days+" days","2 revisions"]],
    ["Standard",pS,["Everything in Basic","Priority delivery","5 revisions"]],
    ["Premium",pP,["Everything in Standard","Fastest delivery","Unlimited revisions"]]
  ];
  var btn=document.getElementById('gigSaveBtn');
  btn.disabled=true; btn.textContent="সেভ হচ্ছে…";
  fbDb.collection('gigs').add({
    title:title, seller:sellerName, sellerUid:fbUser.uid,
    cat:cat, catLabel:CAT_LABELS[cat], price:pB, rating:"New", orders:0,
    delivery:days+" days", color:CAT_COLORS[cat], tag:"New", desc:desc,
    packs:localPacksToFs(packs),
    createdAt:firebase.firestore.FieldValue.serverTimestamp()
  }).then(function(){
    btn.disabled=false; btn.textContent="Gig সেভ করুন →";
    closeGigForm();
    showToast("✅ Gig সেভ হয়েছে — Explore-এ এখনই দেখা যাচ্ছে: "+title+" · Basic "+money(pB)+" / Standard "+money(pS)+" / Premium "+money(pP));
    showPage('explore','gigs');
  }).catch(function(err){
    btn.disabled=false; btn.textContent="Gig সেভ করুন →";
    if(err&&err.code==="permission-denied"){
      showToast("Firestore অনুমতি দিচ্ছে না — Console → Firestore Database → Rules-এ সাইন-ইন করা ব্যবহারকারীর জন্য read/write চালু করুন");
    }else{
      showToast("Gig সেভ হয়নি: "+(err&&err.message?err.message:err));
    }
  });
}

/* ---- Bind every control here (no inline onclick anywhere) ---- */
function bind(id,ev,fn){
  var el=document.getElementById(id);
  if(!el) return;
  el.addEventListener(ev,function(e){
    try{ fn(e); }
    catch(err){ showToast("সমস্যা হয়েছে: "+(err&&err.message?err.message:err)); }
  });
}
bind('signInBtn','click',signIn);
bind('profileSignBtn','click',signIn);
bind('searchBtn','click',applySearch);
bind('connectBtn','click',function(){ connectFirebase(); });
bind('disconnectBtn','click',disconnectFirebase);
bind('clearBoxBtn','click',function(){
  document.getElementById('firebaseConfigInput').value=''; setKeyStatus('','');
});
bind('gotoBoxBtn','click',function(){
  document.getElementById('keyPanel').scrollIntoView({behavior:'smooth',block:'center'});
  document.getElementById('firebaseConfigInput').focus();
});
bind('createGigBtn','click',openGigForm);
bind('createGigBtn2','click',openGigForm);
bind('orderBtn','click',placeOrder);
bind('gigSaveBtn','click',submitGig);
bind('mCloseBtn','click',closeModal);
bind('gCloseBtn','click',closeGigForm);
bind('paySaveBtn','click',savePayout);
bind('helpSendBtn','click',sendHelp);
bind('threadSendBtn','click',sendThreadMsg);
bind('threadBackBtn','click',closeThread);
bind('completeBtn','click',completeOrder);
bind('reviewSendBtn','click',sendReview);
document.querySelectorAll('.tab').forEach(function(t){
  t.addEventListener('click',function(){ showPage(t.getAttribute('data-page')); });
});
document.querySelectorAll('[data-goto]').forEach(function(a){
  a.addEventListener('click',function(e){
    e.preventDefault();
    showPage(a.getAttribute('data-goto'),a.getAttribute('data-scroll')||null);
  });
});
document.querySelectorAll('.chip[data-q]').forEach(function(c){
  c.addEventListener('click',function(){ quickSearch(c.getAttribute('data-q')); });
});
document.querySelectorAll('.help-role').forEach(function(c){
  c.addEventListener('click',function(){
    document.querySelectorAll('.help-role').forEach(function(x){ x.classList.remove('active'); });
    c.classList.add('active'); helpRole=c.getAttribute('data-role');
  });
});
document.querySelectorAll('#reviewStars .rv').forEach(function(c){
  c.addEventListener('click',function(){
    reviewStars=parseInt(c.getAttribute('data-v'),10)||5;
    document.querySelectorAll('#reviewStars .rv').forEach(function(x){
      x.classList.toggle('active',parseInt(x.getAttribute('data-v'),10)<=reviewStars);
    });
  });
});
var catsEl=document.getElementById('cats');
if(catsEl) catsEl.addEventListener('click',function(e){
  var b=e.target.closest('.cat'); if(!b)return;
  document.querySelectorAll('.cat').forEach(function(c){c.classList.remove('active')});
  b.classList.add('active'); activeCat=b.dataset.cat; render();
});
var searchEl=document.getElementById('searchInput');
if(searchEl) searchEl.addEventListener('keydown',function(e){ if(e.key==='Enter') applySearch(); });
var threadEl=document.getElementById('threadInput');
if(threadEl) threadEl.addEventListener('keydown',function(e){ if(e.key==='Enter') sendThreadMsg(); });
var ovEl=document.getElementById('overlay');
if(ovEl) ovEl.addEventListener('click',function(e){ if(e.target===ovEl) closeModal(); });
var govEl=document.getElementById('gigOverlay');
if(govEl) govEl.addEventListener('click',function(e){ if(e.target===govEl) closeGigForm(); });
/* Price helper: typing a Basic price suggests Standard = 2x and
   Premium = 4x, but only until the seller types their own value in
   those boxes — after that their own price always wins. No cap anywhere:
   $99, $150, $500 — any amount is accepted. */
(function(){
  var b=document.getElementById('gPriceB'), s=document.getElementById('gPriceS'), p=document.getElementById('gPriceP');
  if(!b||!s||!p) return;
  var sTouched=false, pTouched=false;
  s.addEventListener('input',function(){ sTouched=true; });
  p.addEventListener('input',function(){ pTouched=true; });
  b.addEventListener('input',function(){
    var v=parseFloat(b.value);
    if(!(v>0)) return;
    if(!sTouched) s.value=Math.round(v*2*100)/100;
    if(!pTouched) p.value=Math.round(v*4*100)/100;
  });
})();

/* On page load: open the page named in the hash (e.g. #profile), and if a
   key was saved in this browser by an earlier Connect, fill the box and
   connect by itself — no need to paste the key again. */
(function(){
  var h=(location.hash||"").replace("#","");
  if(["explore","profile","inbox","chat"].indexOf(h)>-1) showPage(h);
  else if(h==="firebase") showPage('profile','firebase');
  else if(["gigs","how","sell","faq"].indexOf(h)>-1) showPage('explore',h);
  var saved=readStoredConfig();
  if(saved){
    document.getElementById('firebaseConfigInput').value=configToText(saved);
    connectFirebase(saved);
  }
})();
render();
