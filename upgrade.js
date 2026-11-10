/* WorkBazaar Upgrade layer
 * Preserves the original Explore/Profile/Inbox/Chat interface and adds secure
 * callable workflows. Financial and admin actions must run in Cloud Functions.
 */
(function () {
  'use strict';

  var W = window;
  var $ = function (id) { return document.getElementById(id); };
  var callable = function (name, data) {
    if (!W.firebase || !firebase.functions) return Promise.reject(new Error('Firebase Functions SDK লোড হয়নি।'));
    return firebase.app().functions('asia-south1').httpsCallable(name)(data || {}).then(function (r) { return r.data || {}; });
  };
  var extrasUnsubs = [];
  var notifItems = [];
  var payoutItems = [];
  var walletData = { available: 0, pending: 0, lifetimeEarned: 0, totalPaidOut: 0 };
  var isAdmin = false;
  var editingGigId = null;
  var deliveryOrder = null;
  var deliveryFile = null;
  var refreshAdminTimer = null;
  var oldOnAuthChanged = W.onAuthChanged;
  var oldSubscribeUserData = W.subscribeUserData;
  var oldRender = W.render;
  var oldOpenModal = W.openModal;
  var oldRenderMyGigs = W.renderMyGigs;
  var oldRenderConvs = W.renderConvs;
  var oldUpdateBadges = W.updateBadges;
  var oldOpenThread = W.openThread;
  var oldDisconnect = W.disconnectFirebase;

  function notify(message) {
    if (typeof W.showToast === 'function') W.showToast(message);
    else window.alert(message);
  }
  function cleanUrl(url) {
    return /^https:\/\//i.test(String(url || '')) ? String(url) : '';
  }
  function cssEscape(s) { return String(s || '').replace(/[^a-zA-Z0-9_-]/g, ''); }
  function statusLabel(status) {
    var map = {
      payment_submitted: 'পেমেন্ট যাচাই বাকি', confirmed: 'পেমেন্ট নিশ্চিত', in_progress: 'কাজ চলছে',
      delivered: 'ডেলিভারি হয়েছে', revision_requested: 'রিভিশন চাওয়া হয়েছে', completed: 'সম্পন্ন',
      cancelled: 'বাতিল', disputed: 'বিতর্ক / অভিযোগ', refunded: 'রিফান্ড সম্পন্ন', placed: 'পুরোনো অর্ডার'
    };
    return map[status] || status || 'অজানা';
  }
  function statusClass(status) {
    if (status === 'completed' || status === 'confirmed') return 'done';
    if (status === 'cancelled' || status === 'refunded' || status === 'disputed') return 'later';
    return 'todo';
  }
  function when(v) {
    try {
      if (!v) return 'তারিখ নেই';
      var d = v.toDate ? v.toDate() : new Date(v);
      return isNaN(d.getTime()) ? 'তারিখ নেই' : d.toLocaleString('bn-BD');
    } catch (e) { return 'তারিখ নেই'; }
  }
  function addCss() {
    if ($('wbUpgradeCss')) return;
    var s = document.createElement('style'); s.id = 'wbUpgradeCss';
    s.textContent = `
      .wb-section{margin:18px auto 0;max-width:1180px;padding:0 20px}
      .wb-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
      .wb-stat{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:16px;box-shadow:var(--shadow-sm)}
      .wb-stat b{display:block;font-size:24px;color:var(--green);overflow-wrap:anywhere}.wb-stat span{font-size:13px;color:var(--muted)}
      .wb-toolbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:12px}
      .wb-small{font-size:13px;color:var(--muted)}
      .wb-actions{display:flex;flex-wrap:wrap;gap:7px;margin-top:12px}
      .wb-actions .btn{font-size:13px;padding:8px 12px}
      .wb-order-meta{display:flex;gap:8px;flex-wrap:wrap;color:var(--muted);font-size:13px;margin-top:8px}
      .wb-notice{border:1px solid var(--line);background:var(--bg2);border-radius:14px;padding:12px 14px;margin:9px 0}
      .wb-notice.unread{border-left:4px solid var(--amber)}
      .wb-admin-row{display:flex;gap:10px;align-items:center;justify-content:space-between;padding:12px 0;border-top:1px solid var(--line);flex-wrap:wrap}
      .wb-file{display:block;width:100%;padding:12px;border:1.5px dashed var(--line);border-radius:13px;background:var(--bg2);margin:7px 0 12px;color:var(--text)}
      .wb-image{width:64px;height:52px;object-fit:cover;border-radius:10px;border:1px solid var(--line)}
      .cover.wb-has-image{background-size:cover!important;background-position:center!important}
      .wb-muted-link{color:var(--green);text-decoration:underline;font-weight:700}
      @media(max-width:760px){.wb-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.wb-section{padding:0 14px}}
      @media(max-width:420px){.wb-grid{grid-template-columns:1fr 1fr}.wb-stat{padding:12px}.wb-stat b{font-size:19px}}
    `;
    document.head.appendChild(s);
  }
  function makeSection(id, title, subtitle, inner) {
    var e = document.createElement('section'); e.className = 'wb-section'; e.id = id;
    e.innerHTML = '<div class="panel"><div class="sec-head"><div><h2 class="bn" style="font-size:23px">' + title + '</h2><p class="bn">' + subtitle + '</p></div></div>' + inner + '</div>';
    return e;
  }
  function ensureUi() {
    if ($('wbDashboard')) return;
    addCss();
    var profile = $('page-profile');
    var account = $('accountCard');
    if (profile && account) {
      var dash = makeSection('wbDashboard', '📊 WorkBazaar Dashboard', 'আপনার বিক্রয়, আয়, ওয়ালেট ও কাজের সারাংশ',
        '<div class="wb-grid"><div class="wb-stat"><b id="wbWalletAvailable">$0.00</b><span>উত্তোলনযোগ্য ব্যালেন্স</span></div><div class="wb-stat"><b id="wbWalletPending">$0.00</b><span>পেআউট অপেক্ষমাণ</span></div><div class="wb-stat"><b id="wbWalletEarned">$0.00</b><span>মোট অর্জিত</span></div><div class="wb-stat"><b id="wbWalletPaid">$0.00</b><span>মোট পেআউট</span></div><div class="wb-stat"><b id="wbBuyerOrders">0</b><span>আপনার কেনা অর্ডার</span></div><div class="wb-stat"><b id="wbBuyerSpend">$0.00</b><span>মোট অর্ডার মূল্য</span></div><div class="wb-stat"><b id="wbActiveBuyerOrders">0</b><span>চলমান Buyer অর্ডার</span></div></div><div class="wb-toolbar"><button class="btn btn-primary" id="wbRequestPayout">পেআউট অনুরোধ</button><button class="btn" id="wbRefresh">রিফ্রেশ</button></div><div id="wbPayoutList" class="wb-small" style="margin-top:12px">পেআউটের তথ্য এখানে দেখা যাবে।</div>');
      account.insertAdjacentElement('afterend', dash);
      var admin = makeSection('wbAdminPanel', '🛡️ Admin Dashboard', 'শুধু Firebase Custom Claim admin=true থাকা অ্যাডমিন দেখতে পারবেন',
        '<div id="wbAdminGate" class="wb-small">Admin অনুমতি যাচাই করা হচ্ছে…</div><div id="wbAdminContent" style="display:none"><div class="wb-grid"><div class="wb-stat"><b id="wbAdminUsers">—</b><span>পেআউট প্রোফাইল (সীমিত তালিকা)</span></div><div class="wb-stat"><b id="wbAdminOrders">—</b><span>অর্ডার</span></div><div class="wb-stat"><b id="wbAdminPending">—</b><span>পেমেন্ট যাচাই বাকি</span></div><div class="wb-stat"><b id="wbAdminPayouts">—</b><span>পেআউট অপেক্ষমাণ</span></div></div><h3 style="margin-top:18px">Buyer-এর জন্য পেমেন্ট নম্বর</h3><div class="wb-grid"><div><label>bKash</label><input class="field" id="wbRecvBkash" placeholder="01XXXXXXXXX"></div><div><label>Nagad</label><input class="field" id="wbRecvNagad" placeholder="01XXXXXXXXX"></div><div><label>WhatsApp (ঐচ্ছিক)</label><input class="field" id="wbRecvWhatsApp" placeholder="8801XXXXXXXXX"></div><div><label>১ USD = কত BDT?</label><input class="field" id="wbRecvRate" type="number" min="1" step="0.01" placeholder="আপনার নির্ধারিত রেট"></div></div><button class="btn btn-primary" id="wbSavePaymentSettings">পেমেন্ট সেটিংস সেভ</button><h3 style="margin-top:18px">পেমেন্ট যাচাই</h3><div id="wbAdminPaymentQueue" class="wb-small">লোড হচ্ছে…</div><h3 style="margin-top:18px">পেআউট অনুরোধ</h3><div id="wbAdminPayoutQueue" class="wb-small">লোড হচ্ছে…</div><h3 style="margin-top:18px">User Management (প্রথম ৫০টি)</h3><div id="wbAdminUserList" class="wb-small">লোড হচ্ছে…</div><h3 style="margin-top:18px">Gig পরিচালনা</h3><div id="wbAdminGigList" class="wb-small">লোড হচ্ছে…</div><h3 style="margin-top:18px">সাম্প্রতিক অর্ডার</h3><div id="wbAdminOrderList" class="wb-small">লোড হচ্ছে…</div></div>');
      dash.insertAdjacentElement('afterend', admin);
    }
    var inbox = $('page-inbox');
    if (inbox) {
      var payInfo = document.createElement('div'); payInfo.id = 'wbPaymentDest'; payInfo.className = 'wb-notice bn'; payInfo.textContent = 'অ্যাডমিনের পেমেন্ট নম্বর লোড হচ্ছে…';
      var payForm = $('mMethod'); if (payForm && !payForm.parentNode.querySelector('#wbPaymentDest')) { payInfo.style.gridColumn = '1 / -1'; payForm.parentNode.insertBefore(payInfo, payForm.parentNode.firstChild); }
      var not = makeSection('wbNotifications', '🔔 Notifications', 'অর্ডার, পেমেন্ট, মেসেজ ও পেআউটের আপডেট', '<div id="wbNotificationList" class="wb-small">নোটিফিকেশন লোড হচ্ছে…</div>');
      var first = inbox.querySelector('.wrap');
      if (first) first.appendChild(not);
    }
    var form = $('gigOverlay');
    if (form && $('gDesc') && !$('gImage')) {
      var img = document.createElement('div');
      img.innerHTML = '<label style="font-weight:700">Gig cover image (ঐচ্ছিক)</label><input class="wb-file" type="file" id="gImage" accept="image/jpeg,image/png,image/webp"><small class="wb-small">JPG/PNG/WebP, সর্বোচ্চ 5 MB. Firebase Storage চালু থাকতে হবে।</small>';
      $('gDesc').parentNode.insertBefore(img, $('gDesc'));
    }
    var chatPage = $('page-chat');
    if (chatPage && $('convList')) {
      // Add a concise privacy/security reminder below chat list.
      var note = document.createElement('p'); note.className = 'wb-small bn';
      note.textContent = 'ব্যক্তিগত অর্ডার Chat শুধু সংশ্লিষ্ট Buyer/Seller এবং অনুমোদিত Admin দেখতে পারবেন—Firestore Rules deploy করা আবশ্যক।';
      $('convList').insertAdjacentElement('afterend', note);
    }
    var delivery = document.createElement('div'); delivery.className = 'overlay'; delivery.id = 'wbDeliveryOverlay';
    delivery.innerHTML = '<div class="sheet bn"><div style="display:flex;justify-content:space-between;gap:12px;align-items:center"><h2 style="margin:0">কাজ ডেলিভারি দিন</h2><button class="btn" id="wbDeliveryClose">বন্ধ</button></div><p id="wbDeliveryOrderLabel" class="wb-small"></p><label>ডেলিভারি নোট</label><textarea id="wbDeliveryNote" class="field" rows="4" placeholder="কী কাজ সম্পন্ন করেছেন লিখুন"></textarea><label>ডেলিভারি ফাইল (ঐচ্ছিক)</label><input id="wbDeliveryFile" class="wb-file" type="file"><label>বাইরের ফাইল লিংক (ঐচ্ছিক, https://)</label><input id="wbDeliveryUrl" class="field" type="url" placeholder="https://..."><button id="wbDeliverySubmit" class="btn btn-primary" style="width:100%;justify-content:center">ডেলিভারি জমা দিন</button></div>';
    document.body.appendChild(delivery);
    $('wbDeliveryClose').addEventListener('click', closeDelivery);
    $('wbDeliveryOverlay').addEventListener('click', function (e) { if (e.target === $('wbDeliveryOverlay')) closeDelivery(); });
    $('wbDeliveryFile').addEventListener('change', function (e) { deliveryFile = e.target.files && e.target.files[0] || null; });
    $('wbDeliverySubmit').addEventListener('click', submitDeliveryUi);
    $('wbRequestPayout').addEventListener('click', requestPayoutUi);
    if ($('wbSavePaymentSettings')) $('wbSavePaymentSettings').addEventListener('click', savePaymentSettings);
    if ($('mMethod')) $('mMethod').addEventListener('change', renderPaymentDestination);
    $('wbRefresh').addEventListener('click', function () { refreshWallet(); if (isAdmin) { loadPaymentSettings().then(loadAdminDashboard); } });
    $('wbRequestPayout').disabled = true;
  }
  function firebaseReady() { return !!(W.fbDb && W.fbUser && W.firebase && firebase.functions); }
  function safeUserId() { return W.fbUser ? W.fbUser.uid : ''; }
  function stopExtras() { extrasUnsubs.forEach(function (fn) { try { fn(); } catch (e) {} }); extrasUnsubs = []; }
  function listenExtras() {
    stopExtras();
    if (!firebaseReady()) { renderNotifications(); renderWallet(); return; }
    var uid = safeUserId();
    extrasUnsubs.push(fbDb.collection('notifications').where('uid', '==', uid).orderBy('createdAt', 'desc').limit(40).onSnapshot(function (snap) {
      notifItems = []; snap.forEach(function (d) { var x = d.data(); x._id = d.id; notifItems.push(x); });
      renderNotifications(); updateNotificationBadge(); if (W.renderConvs) W.renderConvs();
    }, function (e) { console.warn('notifications:', e); }));
    extrasUnsubs.push(fbDb.collection('payouts').where('sellerUid', '==', uid).orderBy('createdAt', 'desc').limit(20).onSnapshot(function (snap) {
      payoutItems = []; snap.forEach(function (d) { var x = d.data(); x._id = d.id; payoutItems.push(x); });
      renderPayouts();
    }, function (e) { console.warn('payouts:', e); }));
    extrasUnsubs.push(fbDb.collection('wallets').doc(uid).onSnapshot(function (doc) {
      walletData = doc.exists ? Object.assign(walletData, doc.data()) : { available: 0, pending: 0, lifetimeEarned: 0, totalPaidOut: 0 };
      renderWallet();
    }, function (e) { console.warn('wallet:', e); }));
    refreshAdminFlag();
  }
  function refreshAdminFlag() {
    if (!W.fbUser) { isAdmin = false; renderAdminGate(); return; }
    W.fbUser.getIdTokenResult().then(function (r) {
      isAdmin = !!(r && r.claims && r.claims.admin === true);
      renderAdminGate();
      if (isAdmin) { loadPaymentSettings().then(loadAdminDashboard); }
    }).catch(function () { isAdmin = false; renderAdminGate(); });
  }
  function renderAdminGate() {
    var gate = $('wbAdminGate'), content = $('wbAdminContent');
    if (!gate || !content) return;
    if (!W.fbUser) { gate.textContent = 'Admin দেখতে Sign in করুন।'; content.style.display = 'none'; }
    else if (!isAdmin) { gate.textContent = 'এই অ্যাকাউন্টে Admin অনুমতি নেই। শুধু সার্ভার-সেট করা admin=true Custom Claim থাকলে এই অংশ খুলবে।'; content.style.display = 'none'; }
    else { gate.textContent = 'Admin অনুমতি যাচাই হয়েছে ✓'; content.style.display = 'block'; }
  }
  function refreshWallet() {
    if (!firebaseReady()) return Promise.resolve();
    return fbDb.collection('wallets').doc(safeUserId()).get().then(function (d) {
      walletData = d.exists ? d.data() : { available: 0, pending: 0, lifetimeEarned: 0, totalPaidOut: 0 };
      renderWallet();
    }).catch(function () {});
  }
  function renderBuyerStats() {
    var list = W.myOrders || [];
    if ($('wbBuyerOrders')) $('wbBuyerOrders').textContent = String(list.length);
    var spend = list.reduce(function (n, o) { return n + (['cancelled','refunded'].includes(o.status) ? 0 : Number(o.amount || 0)); }, 0);
    if ($('wbBuyerSpend')) $('wbBuyerSpend').textContent = '$' + spend.toFixed(2);
    var active = list.filter(function (o) { return !['completed','cancelled','refunded'].includes(o.status); }).length;
    if ($('wbActiveBuyerOrders')) $('wbActiveBuyerOrders').textContent = String(active);
  }
  function renderWallet() {
    var vals = { wbWalletAvailable: walletData.available, wbWalletPending: walletData.pending, wbWalletEarned: walletData.lifetimeEarned, wbWalletPaid: walletData.totalPaidOut };
    Object.keys(vals).forEach(function (id) { if ($(id)) $(id).textContent = '$' + (Number(vals[id]) || 0).toFixed(2); });
    if ($('wbRequestPayout')) $('wbRequestPayout').disabled = !firebaseReady() || Number(walletData.available || 0) <= 0;
  }
  function renderPayouts() {
    var box = $('wbPayoutList'); if (!box) return;
    if (!payoutItems.length) { box.textContent = 'এখনো কোনো পেআউট অনুরোধ নেই।'; return; }
    box.innerHTML = payoutItems.map(function (p) {
      return '<div class="wb-notice"><b>$' + Number(p.amount || 0).toFixed(2) + '</b> · ' + (p.method || 'পেআউট') + ' · ' + (p.status || 'pending') + '<div class="wb-small">' + esc(p.accountMasked || '') + (Number(p.expectedBdt) > 0 ? ' · আনুমানিক ৳' + Number(p.expectedBdt).toFixed(2) : '') + ' · ' + when(p.createdAt) + '</div></div>';
    }).join('');
  }
  function renderNotifications() {
    var box = $('wbNotificationList'); if (!box) return;
    if (!notifItems.length) { box.textContent = 'নতুন কোনো নোটিফিকেশন নেই।'; return; }
    box.innerHTML = notifItems.map(function (n) {
      var safeText = W.esc ? esc(n.body || n.title || 'আপডেট') : String(n.body || n.title || 'আপডেট');
      var safeTitle = W.esc ? esc(n.title || 'WorkBazaar') : String(n.title || 'WorkBazaar');
      return '<div class="wb-notice ' + (n.isRead ? '' : 'unread') + '"><div style="display:flex;justify-content:space-between;gap:10px"><b>' + safeTitle + '</b><span class="wb-small">' + when(n.createdAt) + '</span></div><div>' + safeText + '</div>' + (!n.isRead ? '<div class="wb-actions"><button class="btn" data-read-notif="' + n._id + '">পড়া হয়েছে</button></div>' : '') + '</div>';
    }).join('');
  }
  function updateNotificationBadge() {
    var unread = notifItems.filter(function (n) { return !n.isRead; }).length;
    var badge = $('inboxBadge');
    if (badge) { var total = (Number((W.workOrders || []).length) || 0) + unread; badge.textContent = String(total); badge.classList.toggle('show', total > 0); }
  }
  function markNotificationRead(id) {
    if (!firebaseReady()) return;
    fbDb.collection('notifications').doc(id).update({ isRead: true }).catch(function (e) { notify('নোটিফিকেশন আপডেট হয়নি: ' + e.message); });
  }
  var paymentSettings = {};
  function loadPaymentSettings() {
    if (!W.fbDb) return Promise.resolve();
    return fbDb.collection('settings').doc('payments').get().then(function (doc) { paymentSettings = doc.exists ? doc.data() : {}; renderPaymentDestination();
      if (isAdmin) { if ($('wbRecvBkash')) $('wbRecvBkash').value = paymentSettings.bkash || ''; if ($('wbRecvNagad')) $('wbRecvNagad').value = paymentSettings.nagad || ''; if ($('wbRecvWhatsApp')) $('wbRecvWhatsApp').value = paymentSettings.whatsapp || ''; if ($('wbRecvRate')) $('wbRecvRate').value = paymentSettings.bdtPerUsd || ''; }
    }).catch(function () { renderPaymentDestination(); });
  }
  function renderPaymentDestination() {
    var box = $('wbPaymentDest'); if (!box) return;
    var method = ($('mMethod') && $('mMethod').value || 'bKash').toLowerCase();
    var number = method === 'nagad' ? paymentSettings.nagad : paymentSettings.bkash;
    var rate = Number(paymentSettings.bdtPerUsd || 0);
    var orderBtn = $('orderBtn');
    var pack = W.currentGig && W.currentGig.packs ? W.currentGig.packs[Number(W.selectedPack) || 0] : null;
    var usd = pack ? Number(Array.isArray(pack) ? pack[1] : pack.price) : 0;
    var estimate = rate > 0 && usd > 0 ? ' · আনুমানিক পাঠাতে হবে ৳' + (usd * rate).toFixed(2) + ' (১ USD = ৳' + rate.toFixed(2) + ')' : '';
    box.textContent = number ? ('টাকা পাঠান ' + (method === 'nagad' ? 'Nagad' : 'bKash') + ' নম্বরে: ' + number + estimate + ' — টাকা পাঠানোর পর TrxID দিন।') : 'অ্যাডমিন এখনো ' + (method === 'nagad' ? 'Nagad' : 'bKash') + ' গ্রহণের নম্বর সেট করেননি। অর্ডার দেওয়ার আগে Admin-এর সঙ্গে যোগাযোগ করুন।';
    if (orderBtn) orderBtn.disabled = !number || !(rate > 0);
    if (number && !(rate > 0)) box.textContent += ' Admin এখনো USD থেকে BDT রেট সেট করেননি; আপাতত অর্ডার নেওয়া বন্ধ।';
  }
  function savePaymentSettings() {
    if (!isAdmin || !W.fbDb) return notify('শুধু Admin এই সেটিংস পরিবর্তন করতে পারবেন।');
    var data = { bkash: $('wbRecvBkash').value.trim(), nagad: $('wbRecvNagad').value.trim(), whatsapp: $('wbRecvWhatsApp').value.trim(), bdtPerUsd: Number($('wbRecvRate').value), updatedAt: firebase.firestore.FieldValue.serverTimestamp() };
    if (!data.bkash && !data.nagad) return notify('অন্তত একটি bKash/Nagad receiving number দিন।');
    if (!(data.bdtPerUsd > 0) || data.bdtPerUsd > 10000) return notify('সঠিক USD থেকে BDT exchange rate দিন।');
    fbDb.collection('settings').doc('payments').set(data, { merge: true }).then(function () { paymentSettings = data; renderPaymentDestination(); loadAdminDashboard(); notify('Buyer payment settings সেভ হয়েছে।'); }).catch(function (e) { notify('সেভ হয়নি: ' + e.message); });
  }
  function requestPayoutUi() {
    if (!firebaseReady()) return notify('প্রথমে Firebase Connect ও Sign in করুন।');
    var amount = Number(window.prompt('কত USD পেআউট নিতে চান? উপলব্ধ: $' + Number(walletData.available || 0).toFixed(2), String(walletData.available || '')));
    if (!(amount > 0)) return;
    var method = String(window.prompt('কোন মাধ্যমে নেবেন? bkash অথবা nagad লিখুন।', 'bkash') || '').toLowerCase();
    if (method !== 'bkash' && method !== 'nagad') return notify('bkash অথবা nagad লিখুন।');
    callable('requestPayout', { amount: amount, method: method }).then(function (r) { notify('পেআউট অনুরোধ পাঠানো হয়েছে। রেফারেন্স: ' + (r.payoutId || 'সেভ হয়েছে')); refreshWallet(); })
      .catch(function (e) { notify('পেআউট অনুরোধ হয়নি: ' + (e.message || e)); });
  }
  function uploadFile(file, path, maxBytes) {
    if (!file) return Promise.resolve('');
    if (!firebase.storage) return Promise.reject(new Error('Firebase Storage SDK লোড হয়নি।'));
    if (file.size > (maxBytes || 5 * 1024 * 1024)) return Promise.reject(new Error('ফাইলের আকার নির্ধারিত সীমার বেশি।'));
    var allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'application/zip'];
    if (allowed.indexOf(file.type) === -1) return Promise.reject(new Error('এই ফাইল টাইপ অনুমোদিত নয়।'));
    var ref = firebase.storage().ref().child(path);
    return ref.put(file, { contentType: file.type }).then(function (s) { return s.ref.getDownloadURL(); });
  }
  function imageUrlFor(g) { return cleanUrl(g && g.imageUrl); }
  function decorateGigCards() {
    if (!W.GIGS) return;
    var cards = document.querySelectorAll('#gigGrid .gig');
    cards.forEach(function (card, i) {
      var g = GIGS.filter(function (x) { var q = (x.title + ' ' + x.seller + ' ' + x.catLabel).toLowerCase(); var cat = activeCat === 'all' || x.cat === activeCat; var ok = !query || q.indexOf(query) > -1; return cat && ok; })[i];
      var url = imageUrlFor(g); var cover = card.querySelector('.cover');
      if (cover && url) { cover.classList.add('wb-has-image'); cover.style.backgroundImage = 'linear-gradient(180deg,rgba(0,0,0,.05),rgba(0,0,0,.48)),url("' + url.replace(/"/g, '%22') + '")'; }
    });
  }
  W.render = function () { oldRender(); decorateGigCards(); if (W.renderMyGigs) W.renderMyGigs(); };
  W.openModal = function (g) { oldOpenModal(g); var u = imageUrlFor(g); if (u && $('mCover')) { $('mCover').style.backgroundImage = 'linear-gradient(180deg,rgba(0,0,0,.05),rgba(0,0,0,.48)),url("' + u.replace(/"/g, '%22') + '")'; $('mCover').style.backgroundSize = 'cover'; $('mCover').style.backgroundPosition = 'center'; } renderPaymentDestination(); };

  function activeGigMine() {
    return (W.GIGS || []).filter(function (g) { return g.sellerUid && W.fbUser && g.sellerUid === fbUser.uid; });
  }
  W.renderMyGigs = function () {
    oldRenderMyGigs();
    var box = $('myGigsList'); if (!box || !W.fbUser) return;
    activeGigMine().forEach(function (g) {
      var row = Array.from(box.children).find(function (e) { return e.textContent.indexOf(g.title) >= 0; });
      if (!row || row.querySelector('[data-edit-gig]')) return;
      var actions = document.createElement('div'); actions.className = 'wb-actions'; actions.style.marginLeft = 'auto';
      actions.innerHTML = '<button class="btn" data-edit-gig="' + g.id + '">Edit</button><button class="btn" data-delete-gig="' + g.id + '">Delete</button>';
      row.appendChild(actions);
      if (imageUrlFor(g)) { var im = document.createElement('img'); im.className = 'wb-image'; im.src = imageUrlFor(g); im.alt = 'Gig cover'; row.insertBefore(im, row.firstChild); }
    });
  };
  function openGigEditor(g) {
    if (!firebaseReady()) return notify('Firebase Connect ও Sign in করুন।');
    if (!g || g.sellerUid !== fbUser.uid) return notify('শুধু নিজের Gig সম্পাদনা করা যাবে।');
    editingGigId = String(g.id);
    $('gTitle').value = g.title || ''; $('gCat').value = g.cat || 'general';
    var packs = g.packs || [];
    function price(n) { var p = packs.find(function (x) { return String(x[0]).toLowerCase() === n; }); return p ? p[1] : ''; }
    $('gPriceB').value = price('basic'); $('gPriceS').value = price('standard'); $('gPriceP').value = price('premium');
    $('gDays').value = parseInt(g.delivery, 10) || 2; $('gDesc').value = g.desc || '';
    if (typeof W.openGigForm === 'function') W.openGigForm();
    $('gigOverlay').classList.add('open');
    $('gigSaveBtn').textContent = 'পরিবর্তন সেভ করুন';
    if ($('gImage')) $('gImage').value = '';
  }
  function deleteGig(id) {
    if (!firebaseReady()) return;
    var g = (W.GIGS || []).find(function (x) { return String(x.id) === String(id); });
    if (!g || g.sellerUid !== fbUser.uid) return notify('শুধু নিজের Gig মুছতে পারবেন।');
    if (!window.confirm('এই Gig মুছে ফেলবেন?')) return;
    fbDb.collection('gigs').doc(String(id)).delete().then(function () {
      if (g.imagePath && firebase.storage) return firebase.storage().ref().child(g.imagePath).delete().catch(function () {});
    }).then(function () { notify('Gig মুছে ফেলা হয়েছে।'); }).catch(function (e) { notify('Gig মুছতে সমস্যা: ' + e.message); });
  }
  function saveGigUpgrade() {
    if (!firebaseReady()) return notify('Firebase Connect ও Sign in করুন।');
    var title = $('gTitle').value.trim().replace(/[<>]/g, '').slice(0, 100);
    var cat = $('gCat').value;
    var pB = Number($('gPriceB').value), pS = Number($('gPriceS').value), pP = Number($('gPriceP').value);
    var days = Math.max(1, parseInt($('gDays').value, 10) || 2);
    var desc = $('gDesc').value.trim().replace(/[<>]/g, '').slice(0, 3000);
    if (!title || !(pB > 0) || !(pS > 0) || !(pP > 0) || !desc) return notify('Title, তিনটি প্যাকেজের দাম এবং Description সঠিকভাবে পূরণ করুন।');
    var id = editingGigId;
    var data = { title: title, seller: fbUser.displayName || fbUser.email || 'Seller', sellerUid: fbUser.uid,
      cat: cat, catLabel: CAT_LABELS[cat] || cat, price: pB, delivery: days + ' days', color: CAT_COLORS[cat] || CAT_COLORS.general,
      desc: desc, packs: [{ name: 'Basic', price: pB, features: ['Standard delivery in ' + days + ' days', '2 revisions'] },
        { name: 'Standard', price: pS, features: ['Everything in Basic', 'Priority delivery', '5 revisions'] },
        { name: 'Premium', price: pP, features: ['Everything in Standard', 'Fastest delivery', 'Unlimited revisions'] }] };
    var file = $('gImage') && $('gImage').files && $('gImage').files[0];
    var btn = $('gigSaveBtn'); btn.disabled = true; btn.textContent = 'সেভ হচ্ছে…';
    var safeFileName = file ? file.name.replace(/[^a-zA-Z0-9._-]/g, '_') : '';
    var docRef = id ? fbDb.collection('gigs').doc(id) : fbDb.collection('gigs').doc();
    var imagePath = file ? ('gigImages/' + fbUser.uid + '/' + docRef.id + '-' + safeFileName) : '';
    var imagePromise = file ? uploadFile(file, imagePath, 5 * 1024 * 1024) : Promise.resolve('');
    imagePromise.then(function (url) {
      if (url) { data.imageUrl = url; data.imagePath = imagePath; }
      if (id) return docRef.update(Object.assign(data, { updatedAt: firebase.firestore.FieldValue.serverTimestamp() }));
      data.tag = 'New'; data.status = 'active'; data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
      return docRef.set(data);
    }).then(function () {
      btn.disabled = false; btn.textContent = 'Gig সেভ করুন →';
      if (typeof W.closeGigForm === 'function') W.closeGigForm();
      editingGigId = null; notify(id ? 'Gig আপডেট হয়েছে।' : 'নতুন Gig প্রকাশিত হয়েছে।');
    }).catch(function (e) { btn.disabled = false; btn.textContent = 'Gig সেভ করুন →'; notify('Gig সেভ হয়নি: ' + (e.message || e)); });
  }

  function perform(name, data, success) {
    callable(name, data).then(function (r) { notify(success || 'কাজটি সম্পন্ন হয়েছে।'); return r; })
      .catch(function (e) { notify((e.message || 'কাজটি সম্পন্ন হয়নি।') + (e.code ? ' [' + e.code + ']' : '')); });
  }
  function enhancedPlaceOrder() {
    if (!firebaseReady()) return notify('Firebase Connect ও Google Sign in করুন।');
    var selectedMethod = String($('mMethod').value || '').toLowerCase();
    var receivingNumber = selectedMethod === 'nagad' ? paymentSettings.nagad : paymentSettings.bkash;
    if (!receivingNumber || !(Number(paymentSettings.bdtPerUsd) > 0)) return notify('Admin-এর payment number ও USD/BDT rate সেট না হওয়া পর্যন্ত অর্ডার দেওয়া যাবে না।');
    var g = W.currentGig; if (!g || !g.id || !g.isFirestore) return notify('এই নমুনা Gig-টি Firebase-এ প্রকাশিত নয়। Seller-কে Firebase-এ Gig প্রকাশ করতে বলুন।');
    if (g.sellerUid === fbUser.uid) return notify('নিজের Gig-এ অর্ডার দেওয়া যাবে না।');
    var pack = g.packs[W.selectedPack || 0];
    var trxId = $('mTrx').value.trim();
    var senderNumber = $('mSender').value.trim();
    if (!trxId || !senderNumber) return notify('বিকাশ/নগদ TrxID ও প্রেরকের নম্বর লিখুন।');
    var btn = $('orderBtn'); btn.disabled = true; btn.textContent = 'অর্ডার তৈরি হচ্ছে…';
    callable('createOrder', { gigId: String(g.id), packName: pack[0], method: $('mMethod').value, trxId: trxId,
      senderNumber: senderNumber, notes: $('mNotes').value.trim() }).then(function (r) {
      btn.disabled = false; btn.textContent = 'Continue — Place Order';
      W.closeModal(); notify('অর্ডার জমা হয়েছে। Admin পেমেন্ট যাচাই করলে কাজ শুরু হবে।'); W.showPage('inbox');
    }).catch(function (e) { btn.disabled = false; btn.textContent = 'Continue — Place Order'; notify('অর্ডার তৈরি হয়নি: ' + (e.message || e)); });
  }
  function buildOrderCard(o, buyerView, adminView) {
    var div = document.createElement('div'); div.className = 'panel'; div.style.padding = '16px 18px';
    var who = buyerView ? ('Seller: ' + (o.seller || 'Seller')) : ('Buyer: ' + (o.buyerName || o.buyerEmail || 'Buyer'));
    var status = o.status || 'placed';
    var html = '<div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center"><div><b>' + esc(o.gigTitle || 'Order') + '</b><div class="wb-small">' + esc(who) + ' · ' + esc(o.pack || '') + '</div></div><span class="status ' + statusClass(status) + '">' + esc(statusLabel(status)) + '</span></div>'
      + '<div class="wb-order-meta"><span>Total: $' + Number(o.amount || 0).toFixed(2) + (o.expectedBdt != null ? ' · ৳' + Number(o.expectedBdt).toFixed(2) : '') + '</span><span>Seller: $' + Number(o.sellerGets || 0).toFixed(2) + '</span><span>Platform: $' + Number(o.fee || 0).toFixed(2) + '</span><span>' + esc(o.method || '') + ' · Trx: ' + esc(o.trxId || '') + '</span>' + (adminView ? '<span>Sender: ' + esc(o.senderNumber || '') + '</span>' : '') + '<span>' + when(o.createdAt) + '</span></div>';
    if (o.deliveryNote) html += '<div class="wb-notice"><b>Delivery</b><div>' + esc(o.deliveryNote) + '</div>' + (cleanUrl(o.deliveryUrl) ? '<a class="wb-muted-link" href="' + esc(cleanUrl(o.deliveryUrl)) + '" target="_blank" rel="noopener noreferrer">ডেলিভারি ফাইল খুলুন</a>' : '') + (o.deliveryFilePath ? '<div><button class="btn" data-download-delivery="' + esc(o.deliveryFilePath) + '">🔒 ডেলিভারি ফাইল ডাউনলোড</button></div>' : '') + '</div>';
    if (o.revisionNote) html += '<div class="wb-notice">Revision: ' + esc(o.revisionNote) + '</div>';
    if (o.review) html += '<div class="wb-small">Review: ★ ' + Number(o.review.stars || 0) + '/5 ' + esc(o.review.text || '') + '</div>';
    html += '<div class="wb-actions"><button class="btn" data-order-chat="' + o._id + '">💬 Chat</button>';
    if (adminView && status === 'payment_submitted') html += '<button class="btn btn-primary" data-admin-verify="' + o._id + '">পেমেন্ট যাচাই / Confirm</button>';
    if (adminView && (status === 'disputed' || status === 'confirmed' || status === 'in_progress')) html += '<button class="btn" data-admin-cancel="' + o._id + '">Cancel</button>';
    if (adminView && (status === 'disputed' || status === 'cancelled')) html += '<button class="btn btn-amber" data-admin-refund="' + o._id + '">Refund mark</button>';
    if (adminView && status === 'disputed') html += '<button class="btn btn-primary" data-admin-release="' + o._id + '">Dispute resolve: Seller</button>';
    if (!adminView && !buyerView && status === 'confirmed') html += '<button class="btn btn-primary" data-order-start="' + o._id + '">কাজ শুরু করুন</button>';
    if (!adminView && !buyerView && (status === 'in_progress' || status === 'revision_requested')) html += '<button class="btn btn-primary" data-order-deliver="' + o._id + '">ডেলিভারি দিন</button>';
    if (!adminView && buyerView && status === 'delivered') html += '<button class="btn btn-primary" data-order-complete="' + o._id + '">কাজ সম্পন্ন</button><button class="btn" data-order-revision="' + o._id + '">Revision চাই</button>';
    if (!adminView && (status === 'confirmed' || status === 'in_progress' || status === 'delivered' || status === 'revision_requested')) html += '<button class="btn" data-order-dispute="' + o._id + '">সমস্যা / Dispute</button>';
    if (!adminView && buyerView && status === 'payment_submitted') html += '<button class="btn" data-order-cancel="' + o._id + '">অর্ডার বাতিল</button>';
    html += '</div>';
    div.innerHTML = html;
    var chat = div.querySelector('[data-order-chat]'); if (chat) chat.addEventListener('click', function () { W.showPage('chat'); W.openThread('order', o._id); });
    var verify = div.querySelector('[data-admin-verify]'); if (verify) verify.addEventListener('click', function () { if (confirm('bKash/Nagad merchant/statement-এ টাকা যাচাই করেছেন?')) perform('adminVerifyPayment', { orderId: o._id }, 'পেমেন্ট Confirm হয়েছে। Seller কাজ শুরু করতে পারবেন।'); });
    var start = div.querySelector('[data-order-start]'); if (start) start.addEventListener('click', function () { perform('sellerStartOrder', { orderId: o._id }, 'অর্ডার In Progress হয়েছে।'); });
    var deliver = div.querySelector('[data-order-deliver]'); if (deliver) deliver.addEventListener('click', function () { openDelivery(o); });
    var complete = div.querySelector('[data-order-complete]'); if (complete) complete.addEventListener('click', function () { if (confirm('আপনি কি ডেলিভারি পেয়েছেন এবং কাজ সম্পন্ন হয়েছে?')) perform('completeOrder', { orderId: o._id }, 'অর্ডার সম্পন্ন হয়েছে। Seller wallet-এ 95% যোগ হয়েছে।'); });
    var revision = div.querySelector('[data-order-revision]'); if (revision) revision.addEventListener('click', function () { var note = prompt('কী পরিবর্তন দরকার লিখুন:'); if (note && note.trim()) perform('requestRevision', { orderId: o._id, note: note.trim() }, 'Revision request পাঠানো হয়েছে।'); });
    var download = div.querySelector('[data-download-delivery]'); if (download) download.addEventListener('click', function () { downloadPrivateFile(download.getAttribute('data-download-delivery')); });
    var dispute = div.querySelector('[data-order-dispute]'); if (dispute) dispute.addEventListener('click', function () { var note = prompt('সমস্যা বা অভিযোগের বিবরণ লিখুন:'); if (note && note.trim()) perform('createDispute', { orderId: o._id, note: note.trim() }, 'Dispute Admin-এর কাছে পাঠানো হয়েছে।'); });
    var cancel = div.querySelector('[data-order-cancel]'); if (cancel) cancel.addEventListener('click', function () { if (confirm('অর্ডার বাতিল করবেন?')) perform('cancelOrder', { orderId: o._id }, 'অর্ডার বাতিল হয়েছে।'); });
    var adminCancel = div.querySelector('[data-admin-cancel]'); if (adminCancel) adminCancel.addEventListener('click', function () { if (confirm('এই অর্ডার বাতিল করবেন?')) perform('adminSetOrderStatus', { orderId: o._id, status: 'cancelled', note: 'Admin cancellation' }, 'অর্ডার বাতিল হয়েছে।'); });
    var refund = div.querySelector('[data-admin-refund]'); if (refund) refund.addEventListener('click', function () { if (confirm('Buyer-কে বাইরে থেকে refund পাঠানোর পরই এটি চাপুন।')) perform('adminSetOrderStatus', { orderId: o._id, status: 'refunded', note: 'ম্যানুয়াল refund সম্পন্ন' }, 'Refund status আপডেট হয়েছে।'); });
    var release = div.querySelector('[data-admin-release]'); if (release) release.addEventListener('click', function () { if (confirm('প্রমাণ যাচাই করে সিদ্ধান্ত নিয়েছেন যে Seller-এর কাজের মূল্য release হবে?')) perform('adminResolveDisputeToSeller', { orderId: o._id }, 'Dispute Seller-এর পক্ষে resolve হয়েছে; 95% Wallet-এ যোগ হয়েছে।'); });
    return div;
  }
  W.renderOrders = function () {
    var box = $('ordersList'), empty = $('ordersEmpty'); if (!box) return;
    box.innerHTML = ''; (W.myOrders || []).forEach(function (o) { box.appendChild(buildOrderCard(o, true, false)); });
    if (empty) empty.style.display = (W.myOrders || []).length ? 'none' : 'block'; renderBuyerStats();
  };
  W.renderWork = function () {
    var box = $('workList'); if (!box || !W.fbUser) return;
    box.innerHTML = ''; if (!(W.workOrders || []).length) { box.innerHTML = '<p class="empty-note">এখনো কোনো অর্ডার আসেনি।</p>'; return; }
    W.workOrders.forEach(function (o) { box.appendChild(buildOrderCard(o, false, false)); });
  };
  function markThreadNotificationsRead(id) {
    if (!firebaseReady()) return;
    notifItems.filter(function (n) { return !n.isRead && n.kind === 'message' && n.refId === id; }).forEach(function (n) { markNotificationRead(n._id); });
  }
  function decorateConversationUnread() {
    var orderConvs = typeof W.conversations === 'function' ? W.conversations() : [];
    var list = $('convList'); if (!list) return;
    var orderButtons = Array.from(list.children).filter(function (b) { return !b.hasAttribute('data-support'); });
    orderButtons.forEach(function (b, i) {
      var c = orderConvs[i]; if (!c) return;
      var count = notifItems.filter(function (n) { return !n.isRead && n.kind === 'message' && n.refId === c.id; }).length;
      var tag = b.querySelector('.wb-unread-count'); if (tag) tag.remove();
      if (count) { var badge = document.createElement('span'); badge.className = 'wb-unread-count status later'; badge.textContent = count + ' unread'; b.appendChild(badge); }
    });
    Array.from(list.querySelectorAll('[data-support]')).forEach(function (b) {
      var id = b.getAttribute('data-support');
      var count = notifItems.filter(function (n) { return !n.isRead && n.kind === 'message' && n.refId === id; }).length;
      var tag = b.querySelector('.wb-unread-count'); if (tag) tag.remove();
      if (count) { var badge = document.createElement('span'); badge.className = 'wb-unread-count status later'; badge.textContent = count + ' unread'; b.appendChild(badge); }
    });
  }
  W.renderConvs = function () { if (oldRenderConvs) oldRenderConvs(); decorateConversationUnread(); };
  W.updateBadges = function () { if (oldUpdateBadges) oldUpdateBadges(); updateNotificationBadge(); };

  W.openThread = function (kind, id) {
    if (oldOpenThread) oldOpenThread(kind, id);
    markThreadNotificationsRead(id);
    if (kind === 'order' && W.currentThread && W.currentThread.order) {
      var complete = $('completeBtn');
      if (complete) complete.style.display = W.currentThread.order.status === 'delivered' && !W.currentThread.meSeller ? '' : 'none';
      var review = $('reviewBox'); if (review) review.style.display = W.currentThread.order.status === 'completed' && !W.currentThread.meSeller && !W.currentThread.order.review ? 'block' : 'none';
    }
  };

  function openDelivery(o) {
    deliveryOrder = o; deliveryFile = null;
    $('wbDeliveryOrderLabel').textContent = (o.gigTitle || 'Order') + ' · ' + (o.pack || '');
    $('wbDeliveryNote').value = ''; $('wbDeliveryUrl').value = ''; $('wbDeliveryFile').value = '';
    $('wbDeliveryOverlay').classList.add('open'); document.body.style.overflow = 'hidden';
  }
  function closeDelivery() { $('wbDeliveryOverlay').classList.remove('open'); document.body.style.overflow = ''; deliveryOrder = null; }
  function uploadPrivateFile(file, path) {
    if (!file) return Promise.resolve('');
    if (file.size > 20 * 1024 * 1024) return Promise.reject(new Error('ফাইলের আকার 20 MB-এর বেশি।'));
    var allowed = ['image/jpeg','image/png','image/webp','application/pdf','application/zip'];
    if (allowed.indexOf(file.type) === -1) return Promise.reject(new Error('এই ফাইল টাইপ অনুমোদিত নয়।'));
    var ref = firebase.storage().ref().child(path);
    return ref.put(file, { contentType: file.type }).then(function () { return path; });
  }
  function downloadPrivateFile(path) {
    if (!firebaseReady() || !path) return;
    firebase.storage().ref().child(path).getBlob().then(function (blob) {
      var url = URL.createObjectURL(blob); var a = document.createElement('a'); a.href = url; a.download = path.split('/').pop() || 'delivery-file';
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
    }).catch(function (e) { notify('ফাইল ডাউনলোড হয়নি: ' + e.message); });
  }
  function submitDeliveryUi() {
    if (!deliveryOrder || !firebaseReady()) return;
    var note = $('wbDeliveryNote').value.trim(); var url = $('wbDeliveryUrl').value.trim();
    if (!note) return notify('ডেলিভারি নোট লিখুন।');
    if (url && !cleanUrl(url)) return notify('লিংক অবশ্যই https:// দিয়ে শুরু হতে হবে।');
    var btn = $('wbDeliverySubmit'); btn.disabled = true; btn.textContent = 'আপলোড হচ্ছে…';
    var f = deliveryFile; var id = deliveryOrder._id;
    var filePath = f ? ('deliveryFiles/' + id + '/' + fbUser.uid + '/' + f.name.replace(/[^a-zA-Z0-9._-]/g, '_')) : '';
    var upload = f ? uploadPrivateFile(f, filePath) : Promise.resolve('');
    upload.then(function (storedPath) { return callable('submitDelivery', { orderId: id, note: note, deliveryUrl: url, deliveryFilePath: storedPath }); })
      .then(function () { btn.disabled = false; btn.textContent = 'ডেলিভারি জমা দিন'; closeDelivery(); notify('ডেলিভারি Buyer-এর কাছে পাঠানো হয়েছে।'); })
      .catch(function (e) { btn.disabled = false; btn.textContent = 'ডেলিভারি জমা দিন'; notify('ডেলিভারি জমা হয়নি: ' + e.message); });
  }

  function loadAdminDashboard() {
    if (!isAdmin || !firebaseReady()) return;
    Promise.all([
      fbDb.collection('orders').orderBy('createdAt', 'desc').limit(60).get(),
      fbDb.collection('payouts').where('status', '==', 'pending').orderBy('createdAt', 'desc').limit(40).get(),
      fbDb.collection('users').limit(100).get(),
      fbDb.collection('gigs').limit(100).get(),
      callable('adminListUsers', {})
    ]).then(function (results) {
      var orders = []; results[0].forEach(function (d) { var x = d.data(); x._id = d.id; orders.push(x); });
      var payouts = []; results[1].forEach(function (d) { var x = d.data(); x._id = d.id; payouts.push(x); });
      $('wbAdminUsers').textContent = String(results[2].size) + (results[2].size === 100 ? '+' : '');
      $('wbAdminOrders').textContent = String(orders.length);
      var pending = orders.filter(function (x) { return x.status === 'payment_submitted'; });
      $('wbAdminPending').textContent = String(pending.length);
      $('wbAdminPayouts').textContent = String(payouts.length);
      $('wbAdminPaymentQueue').innerHTML = pending.length ? '' : 'কোনো Payment verification pending নেই।';
      pending.forEach(function (o) { $('wbAdminPaymentQueue').appendChild(buildOrderCard(o, false, true)); });
      $('wbAdminPayoutQueue').innerHTML = payouts.length ? '' : 'কোনো payout pending নেই।';
      payouts.forEach(function (p) {
        var row = document.createElement('div'); row.className = 'wb-admin-row';
        row.innerHTML = '<div><b>$' + Number(p.amount || 0).toFixed(2) + '</b><div class="wb-small">' + esc(p.sellerName || p.sellerUid) + ' · ' + esc(p.method || '') + ' · ' + esc(p.accountNumber || p.accountMasked || '') + (Number(p.expectedBdt) > 0 ? ' · আনুমানিক ৳' + Number(p.expectedBdt).toFixed(2) : (Number(paymentSettings.bdtPerUsd) > 0 ? ' · আনুমানিক ৳' + (Number(p.amount || 0) * Number(paymentSettings.bdtPerUsd)).toFixed(2) : '')) + '</div></div><div class="wb-actions"><button class="btn btn-primary" data-payout-paid="' + p._id + '">Paid</button><button class="btn" data-payout-reject="' + p._id + '">Reject</button></div>';
        row.querySelector('[data-payout-paid]').addEventListener('click', function () { if (confirm('টাকা পাঠানোর পর Paid চাপুন।')) perform('adminUpdatePayout', { payoutId: p._id, status: 'paid', note: 'ম্যানুয়াল bKash/Nagad transfer সম্পন্ন' }, 'Payout Paid হিসেবে চিহ্নিত হয়েছে।'); });
        row.querySelector('[data-payout-reject]').addEventListener('click', function () { var note = prompt('Reject করার কারণ লিখুন:'); if (note) perform('adminUpdatePayout', { payoutId: p._id, status: 'rejected', note: note }, 'Payout বাতিল হয়েছে এবং ব্যালেন্স ফেরত গেছে।'); });
        $('wbAdminPayoutQueue').appendChild(row);
      });
      $('wbAdminOrderList').innerHTML = '';
      orders.slice(0, 15).forEach(function (o) { $('wbAdminOrderList').appendChild(buildOrderCard(o, false, true)); });
      var gigs = []; results[3].forEach(function (d) { var g = d.data(); g._id = d.id; gigs.push(g); });
      var adminUsers = (results[4] && results[4].users) || [];
      $('wbAdminUserList').innerHTML = adminUsers.length ? '' : 'কোনো User পাওয়া যায়নি।';
      adminUsers.forEach(function (u) { var userRow = document.createElement('div'); userRow.className = 'wb-admin-row';
        userRow.innerHTML = '<div><b>' + esc(u.displayName || u.email || u.uid) + '</b><div class="wb-small">' + esc(u.email || u.uid) + ' · ' + (u.admin ? 'Admin' : 'User') + ' · ' + (u.disabled ? 'Disabled' : 'Active') + '</div></div>' + (!u.admin ? '<button class="btn" data-user-toggle="' + u.uid + '" data-disabled="' + (!u.disabled) + '">' + (u.disabled ? 'Enable' : 'Disable') + '</button>' : '');
        var toggle = userRow.querySelector('[data-user-toggle]'); if (toggle) toggle.addEventListener('click', function () { var disabled = toggle.getAttribute('data-disabled') === 'true'; if (confirm(disabled ? 'এই User-এর Sign in বন্ধ করবেন?' : 'এই User-এর Sign in আবার চালু করবেন?')) perform('adminSetUserDisabled', { uid: u.uid, disabled: disabled }, disabled ? 'User account disabled হয়েছে।' : 'User account enabled হয়েছে।'); });
        $('wbAdminUserList').appendChild(userRow);
      });
      $('wbAdminGigList').innerHTML = gigs.length ? '' : 'কোনো Gig পাওয়া যায়নি।';
      gigs.forEach(function (g) { var row = document.createElement('div'); row.className = 'wb-admin-row';
        row.innerHTML = '<div><b>' + esc(g.title || 'Gig') + '</b><div class="wb-small">' + esc(g.seller || '') + ' · ' + esc(g.status || 'active') + ' · $' + Number(g.price || 0).toFixed(2) + '</div></div><div class="wb-actions"><button class="btn" data-gig-state="' + g._id + '" data-next-state="' + (g.status === 'paused' ? 'active' : 'paused') + '">' + (g.status === 'paused' ? 'আবার চালু' : 'Pause') + '</button></div>';
        row.querySelector('[data-gig-state]').addEventListener('click', function () { fbDb.collection('gigs').doc(g._id).update({ status: g.status === 'paused' ? 'active' : 'paused', updatedAt: firebase.firestore.FieldValue.serverTimestamp() }).then(function () { notify('Gig status আপডেট হয়েছে।'); loadAdminDashboard(); }).catch(function (e) { notify('Gig আপডেট হয়নি: ' + e.message); }); });
        $('wbAdminGigList').appendChild(row);
      });
    }).catch(function (e) { $('wbAdminGate').textContent = 'Admin ডেটা পড়া যায়নি: ' + (e.message || e); });
  }

  // Hook legacy lifecycle only after the original file has defined its handlers.
  W.subscribeUserData = function () { if (oldSubscribeUserData) oldSubscribeUserData(); listenExtras(); };
  W.onAuthChanged = function () {
    if (oldOnAuthChanged) oldOnAuthChanged();
    if (W.fbUser) { listenExtras(); loadPaymentSettings(); } else { paymentSettings = {}; renderPaymentDestination(); stopExtras(); isAdmin = false; notifItems = []; payoutItems = []; walletData = { available: 0, pending: 0, lifetimeEarned: 0, totalPaidOut: 0 }; renderWallet(); renderAdminGate(); renderNotifications(); }
  };
  W.disconnectFirebase = function () { stopExtras(); isAdmin = false; if (oldDisconnect) oldDisconnect(); renderAdminGate(); };

  // Capture handlers to replace the original direct-client payment/status code.
  document.addEventListener('click', function (ev) {
    var t = ev.target && ev.target.closest ? ev.target.closest('button') : null; if (!t) return;
    var id = t.id;
    if (t.classList && t.classList.contains('pack')) { setTimeout(renderPaymentDestination, 0); return; }
    if (id === 'gCloseBtn') { editingGigId = null; if ($('gigSaveBtn')) $('gigSaveBtn').textContent = 'Gig সেভ করুন →'; }
    if (id === 'signInBtn' || id === 'profileSignBtn') { ev.preventDefault(); ev.stopImmediatePropagation(); W.signIn(); return; }
    if (id === 'completeBtn') { ev.preventDefault(); ev.stopImmediatePropagation(); var th = W.currentThread; if (th && th.kind === 'order' && th.order && th.order.status === 'delivered') { if (confirm('আপনি কি কাজ সম্পন্ন হিসেবে গ্রহণ করছেন?')) perform('completeOrder', { orderId: th.id }, 'অর্ডার Complete হয়েছে; Seller balance আপডেট হয়েছে।'); } else notify('Seller-এর Delivery আসার পর Complete করতে পারবেন।'); return; }
    if (id === 'reviewSendBtn') { ev.preventDefault(); ev.stopImmediatePropagation(); var rt = W.currentThread; if (!rt || rt.kind !== 'order') return; perform('submitReview', { orderId: rt.id, stars: Number(W.reviewStars || 5), text: $('reviewText').value.trim() }, 'Review সেভ হয়েছে।'); return; }
    if (id === 'orderBtn') { ev.preventDefault(); ev.stopImmediatePropagation(); enhancedPlaceOrder(); return; }
    if (id === 'gigSaveBtn') { ev.preventDefault(); ev.stopImmediatePropagation(); saveGigUpgrade(); return; }
    if (t.hasAttribute('data-edit-gig')) { ev.preventDefault(); ev.stopImmediatePropagation(); var g = (W.GIGS || []).find(function (x) { return String(x.id) === t.getAttribute('data-edit-gig'); }); openGigEditor(g); return; }
    if (t.hasAttribute('data-delete-gig')) { ev.preventDefault(); ev.stopImmediatePropagation(); deleteGig(t.getAttribute('data-delete-gig')); return; }
    if (t.hasAttribute('data-read-notif')) { ev.preventDefault(); ev.stopImmediatePropagation(); markNotificationRead(t.getAttribute('data-read-notif')); return; }
  }, true);

  // Keep legacy sign-in and Firebase setup intact, but use mobile-friendly redirect auth.
  W.signIn = function () {
    if (!W.fbApp) return gotoKeyPanel();
    if (W.fbUser) { firebase.auth().signOut().then(function () { notify('Sign out হয়েছে।'); }); return; }
    var provider = new firebase.auth.GoogleAuthProvider();
    var mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    var method = mobile ? firebase.auth().signInWithRedirect(provider) : firebase.auth().signInWithPopup(provider);
    Promise.resolve(method).catch(function (e) { notify('Google Sign in হয়নি: ' + (e.message || e)); });
  };
  try {
    if (W.firebase && firebase.auth) firebase.auth().getRedirectResult().catch(function (e) { if (e && e.code !== 'auth/no-auth-event') notify('Google sign-in: ' + e.message); });
  } catch (e) {}

  // Admin-only payment settings can expose public receiving accounts, never admin privilege.
  function initEnhancedUi() {
    ensureUi();
    if (W.render) W.render();
    if (W.fbUser) listenExtras();
    renderAdminGate(); renderWallet();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initEnhancedUi); else initEnhancedUi();
  if (W.fbUser) { setTimeout(refreshAdminFlag, 300); setTimeout(loadPaymentSettings, 500); }
  // A modest refresh in case admin claim was just granted while the session was open.
  document.addEventListener('visibilitychange', function () { if (!document.hidden && W.fbUser) refreshAdminFlag(); });
})();
