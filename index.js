'use strict';

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onDocumentCreated, onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const crypto = require('node:crypto');

initializeApp();
const db = getFirestore();
const REGION = 'asia-south1';
const PLATFORM_FEE_RATE = 0.05;
const CURRENCY = 'USD';

function requireUser(req) {
  if (!req.auth || !req.auth.uid) throw new HttpsError('unauthenticated', 'প্রথমে Sign in করুন।');
  return req.auth.uid;
}
function requireAdmin(req) {
  const uid = requireUser(req);
  if (req.auth.token.admin !== true) throw new HttpsError('permission-denied', 'Admin অনুমতি নেই।');
  return uid;
}
function text(value, max = 2000) {
  return String(value || '').trim().slice(0, max);
}
function positiveAmount(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || n > 1000000) throw new HttpsError('invalid-argument', 'সঠিক পরিমাণ দিন।');
  return Math.round(n * 100) / 100;
}
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function isParticipant(order, uid) { return order.buyerUid === uid || order.sellerUid === uid; }
async function getOrder(orderId) {
  const id = text(orderId, 128);
  if (!id) throw new HttpsError('invalid-argument', 'Order ID প্রয়োজন।');
  const ref = db.collection('orders').doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'অর্ডার পাওয়া যায়নি।');
  return { ref, data: snap.data(), id };
}
async function transitionOrder(orderId, validate, buildUpdate) {
  const id = text(orderId, 128);
  if (!id) throw new HttpsError('invalid-argument', 'Order ID প্রয়োজন।');
  const ref = db.collection('orders').doc(id);
  let before;
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError('not-found', 'অর্ডার পাওয়া যায়নি।');
    before = snap.data();
    validate(before);
    tx.update(ref, { ...buildUpdate(before), updatedAt: FieldValue.serverTimestamp() });
  });
  return { id, data: before };
}
async function pushNotification(uid, title, body, kind, refId) {
  if (!uid) return;
  await db.collection('notifications').add({
    uid, title: text(title, 120), body: text(body, 500), kind: text(kind, 40), refId: text(refId, 128),
    isRead: false, createdAt: FieldValue.serverTimestamp()
  });
}

// Buyer submits the payment reference. Amount and commission are always derived on the server.
exports.createOrder = onCall({ region: REGION, enforceAppCheck: false }, async (req) => {
  const uid = requireUser(req);
  const gigId = text(req.data && req.data.gigId, 128);
  const packName = text(req.data && req.data.packName, 40);
  const method = text(req.data && req.data.method, 20).toLowerCase();
  const trxId = text(req.data && req.data.trxId, 100);
  const senderNumber = text(req.data && req.data.senderNumber, 30);
  const notes = text(req.data && req.data.notes, 2000);
  if (!gigId || !packName || !trxId || !senderNumber || !['bkash', 'nagad'].includes(method)) {
    throw new HttpsError('invalid-argument', 'Gig, প্যাকেজ, payment method, TrxID ও প্রেরকের নম্বর প্রয়োজন।');
  }
  const gigSnap = await db.collection('gigs').doc(gigId).get();
  if (!gigSnap.exists) throw new HttpsError('not-found', 'এই Gig Firebase-এ নেই বা মুছে ফেলা হয়েছে।');
  const gig = gigSnap.data();
  if (!gig.sellerUid || gig.sellerUid === uid) throw new HttpsError('failed-precondition', 'নিজের Gig বা অকার্যকর Gig-এ অর্ডার করা যাবে না।');
  if (gig.status === 'paused' || gig.status === 'rejected') throw new HttpsError('failed-precondition', 'এই Gig বর্তমানে অর্ডার নেওয়ার জন্য চালু নেই।');
  const packs = Array.isArray(gig.packs) ? gig.packs : [];
  const pack = packs.find((p) => String(p.name || p[0] || '').toLowerCase() === packName.toLowerCase());
  if (!pack) throw new HttpsError('not-found', 'প্যাকেজ পাওয়া যায়নি।');
  const amount = positiveAmount(pack.price != null ? pack.price : pack[1]);
  const paymentSettingsSnap = await db.collection('settings').doc('payments').get();
  const paymentSettings = paymentSettingsSnap.exists ? paymentSettingsSnap.data() : {};
  const receivingNumber = method === 'nagad' ? paymentSettings.nagad : paymentSettings.bkash;
  const bdtPerUsd = Number(paymentSettings.bdtPerUsd || 0);
  if (!receivingNumber || !Number.isFinite(bdtPerUsd) || bdtPerUsd <= 0) {
    throw new HttpsError('failed-precondition', 'Admin-এর receiving number ও USD/BDT exchange rate সেট করা নেই।');
  }
  const expectedBdt = Math.round(amount * bdtPerUsd * 100) / 100;
  const fee = Math.round(amount * PLATFORM_FEE_RATE * 100) / 100;
  const sellerGets = Math.round((amount - fee) * 100) / 100;
  const trxHash = sha256(method + ':' + trxId.toLowerCase());
  const txnRef = db.collection('paymentTransactions').doc(trxHash);
  const gigRef = db.collection('gigs').doc(gigId);
  const orderRef = db.collection('orders').doc();
  await db.runTransaction(async (tx) => {
    const existing = await tx.get(txnRef);
    const currentGigSnap = await tx.get(gigRef);
    const profileSnap = await tx.get(db.collection('users').doc(uid));
    if (existing.exists) throw new HttpsError('already-exists', 'এই TrxID আগে ব্যবহার করা হয়েছে।');
    if (!currentGigSnap.exists || currentGigSnap.data().sellerUid !== gig.sellerUid || ['paused','rejected'].includes(currentGigSnap.data().status)) throw new HttpsError('failed-precondition', 'এই Gig এখন অর্ডার নিচ্ছে না।');
    const profile = profileSnap.exists ? profileSnap.data() : {};
    tx.update(gigRef, { orders: Number(currentGigSnap.data().orders || 0) + 1, updatedAt: FieldValue.serverTimestamp() });
    tx.create(orderRef, {
      gigId, gigTitle: text(gig.title, 120), seller: text(gig.seller, 100), sellerUid: gig.sellerUid,
      pack: packName, amount, currency: CURRENCY, sellerGets, fee, feeRate: PLATFORM_FEE_RATE,
      bdtPerUsd, expectedBdt, notes, method, senderNumber, trxId, buyerUid: uid,
      buyerName: text(req.auth.token.name || profile.name || '', 100), buyerEmail: text(req.auth.token.email || '', 180),
      status: 'payment_submitted', paymentStatus: 'pending_review',
      createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp()
    });
    tx.create(txnRef, { orderId: orderRef.id, buyerUid: uid, method, createdAt: FieldValue.serverTimestamp() });
  });
  await pushNotification(gig.sellerUid, 'নতুন অর্ডার', 'আপনার Gig-এ নতুন অর্ডার এসেছে। Payment যাচাই শেষে কাজ শুরু করুন।', 'order', orderRef.id);
  return { orderId: orderRef.id, amount, sellerGets, fee, status: 'payment_submitted' };
});


exports.adminListUsers = onCall({ region: REGION }, async (req) => {
  requireAdmin(req);
  const pageToken = text(req.data && req.data.pageToken, 1000) || undefined;
  const result = await getAuth().listUsers(50, pageToken);
  return {
    users: result.users.map((u) => ({ uid: u.uid, email: text(u.email, 180), displayName: text(u.displayName, 100), disabled: !!u.disabled, creationTime: u.metadata && u.metadata.creationTime || '' , admin: u.customClaims && u.customClaims.admin === true })),
    pageToken: result.pageToken || null
  };
});

exports.adminSetUserDisabled = onCall({ region: REGION }, async (req) => {
  const adminUid = requireAdmin(req);
  const uid = text(req.data && req.data.uid, 128);
  const disabled = req.data && req.data.disabled;
  if (!uid || typeof disabled !== 'boolean') throw new HttpsError('invalid-argument', 'User UID ও disabled true/false প্রয়োজন।');
  if (uid === adminUid && disabled) throw new HttpsError('failed-precondition', 'নিজের Admin account disable করা যাবে না।');
  const user = await getAuth().getUser(uid);
  if (user.customClaims && user.customClaims.admin === true) throw new HttpsError('failed-precondition', 'অন্য Admin account এই প্যানেল থেকে disable করা যাবে না।');
  await getAuth().updateUser(uid, { disabled });
  return { uid, disabled };
});

exports.adminVerifyPayment = onCall({ region: REGION }, async (req) => {
  const adminUid = requireAdmin(req);
  const { id } = await transitionOrder(req.data && req.data.orderId,
    (data) => { if (data.status !== 'payment_submitted') throw new HttpsError('failed-precondition', 'এই অর্ডারের পেমেন্ট আর Pending নয়।'); },
    () => ({ status: 'confirmed', paymentStatus: 'verified_manual', paymentConfirmedBy: adminUid, paymentConfirmedAt: FieldValue.serverTimestamp() }));
  return { orderId: id, status: 'confirmed' };
});

exports.sellerStartOrder = onCall({ region: REGION }, async (req) => {
  const uid = requireUser(req);
  const { id } = await transitionOrder(req.data && req.data.orderId,
    (data) => {
      if (data.sellerUid !== uid) throw new HttpsError('permission-denied', 'শুধু সংশ্লিষ্ট Seller কাজ শুরু করতে পারবেন।');
      if (data.status !== 'confirmed') throw new HttpsError('failed-precondition', 'Payment confirmed না হলে কাজ শুরু করা যাবে না।');
    },
    () => ({ status: 'in_progress', startedAt: FieldValue.serverTimestamp() }));
  return { orderId: id, status: 'in_progress' };
});

exports.submitDelivery = onCall({ region: REGION }, async (req) => {
  const uid = requireUser(req);
  const orderId = text(req.data && req.data.orderId, 128);
  const note = text(req.data && req.data.note, 3000);
  const deliveryUrl = text(req.data && req.data.deliveryUrl, 1000);
  const deliveryFilePath = text(req.data && req.data.deliveryFilePath, 500);
  if (!note) throw new HttpsError('invalid-argument', 'ডেলিভারি নোট লিখুন।');
  if (deliveryUrl && !/^https:\/\//i.test(deliveryUrl)) throw new HttpsError('invalid-argument', 'ডেলিভারি URL অবশ্যই HTTPS হতে হবে।');
  if (deliveryFilePath && !deliveryFilePath.startsWith('deliveryFiles/' + orderId + '/' + uid + '/')) throw new HttpsError('invalid-argument', 'Delivery file path সঠিক নয়।');
  const { id } = await transitionOrder(orderId,
    (data) => {
      if (data.sellerUid !== uid) throw new HttpsError('permission-denied', 'শুধু সংশ্লিষ্ট Seller ডেলিভারি দিতে পারবেন।');
      if (!['in_progress', 'revision_requested'].includes(data.status)) throw new HttpsError('failed-precondition', 'এই স্ট্যাটাসে ডেলিভারি জমা দেওয়া যাবে না।');
    },
    () => ({ status: 'delivered', deliveryNote: note, deliveryUrl, deliveryFilePath, deliveredAt: FieldValue.serverTimestamp() }));
  return { orderId: id, status: 'delivered' };
});

exports.requestRevision = onCall({ region: REGION }, async (req) => {
  const uid = requireUser(req);
  const note = text(req.data && req.data.note, 2000);
  if (!note) throw new HttpsError('invalid-argument', 'Revision-এর কারণ লিখুন।');
  const { id } = await transitionOrder(req.data && req.data.orderId,
    (data) => {
      if (data.buyerUid !== uid) throw new HttpsError('permission-denied', 'শুধু Buyer Revision চাইতে পারবেন।');
      if (data.status !== 'delivered') throw new HttpsError('failed-precondition', 'Delivery জমা না হলে Revision চাওয়া যাবে না।');
    },
    () => ({ status: 'revision_requested', revisionNote: note, revisionRequestedAt: FieldValue.serverTimestamp() }));
  return { orderId: id, status: 'revision_requested' };
});

exports.completeOrder = onCall({ region: REGION }, async (req) => {
  const uid = requireUser(req);
  const { ref, data, id } = await getOrder(req.data && req.data.orderId);
  if (data.buyerUid !== uid) throw new HttpsError('permission-denied', 'শুধু Buyer অর্ডার Complete করতে পারবেন।');
  if (data.status !== 'delivered') throw new HttpsError('failed-precondition', 'Seller Delivery না দিলে অর্ডার Complete করা যাবে না।');
  const walletRef = db.collection('wallets').doc(data.sellerUid);
  const ledgerRef = db.collection('ledger').doc('order_' + id);
  await db.runTransaction(async (tx) => {
    const orderSnap = await tx.get(ref);
    const ledgerSnap = await tx.get(ledgerRef);
    const walletSnap = await tx.get(walletRef);
    if (!orderSnap.exists || orderSnap.data().status !== 'delivered') throw new HttpsError('failed-precondition', 'Order status পরিবর্তিত হয়েছে; আবার লোড করুন।');
    if (ledgerSnap.exists) throw new HttpsError('already-exists', 'এই অর্ডারের আয় আগে Wallet-এ যোগ হয়েছে।');
    const w = walletSnap.exists ? walletSnap.data() : {};
    const earned = Number(data.sellerGets || 0);
    tx.update(ref, { status: 'completed', completedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    tx.set(walletRef, {
      available: Math.round((Number(w.available || 0) + earned) * 100) / 100,
      pending: Number(w.pending || 0),
      lifetimeEarned: Math.round((Number(w.lifetimeEarned || 0) + earned) * 100) / 100,
      totalPaidOut: Number(w.totalPaidOut || 0), updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    tx.create(ledgerRef, { sellerUid: data.sellerUid, orderId: id, amount: earned, currency: CURRENCY, type: 'earning', createdAt: FieldValue.serverTimestamp() });
  });
  return { status: 'completed', sellerGets: Number(data.sellerGets || 0) };
});


exports.submitReview = onCall({ region: REGION }, async (req) => {
  const uid = requireUser(req);
  const { ref, data } = await getOrder(req.data && req.data.orderId);
  if (data.buyerUid !== uid) throw new HttpsError('permission-denied', 'শুধু Buyer Review দিতে পারবেন।');
  const stars = Number(req.data && req.data.stars);
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) throw new HttpsError('invalid-argument', '১ থেকে ৫ স্টার নির্বাচন করুন।');
  const reviewText = text(req.data && req.data.text, 1000);
  const gigRef = db.collection('gigs').doc(data.gigId);
  await db.runTransaction(async (tx) => {
    const orderSnap = await tx.get(ref);
    const gigSnap = await tx.get(gigRef);
    if (!orderSnap.exists || orderSnap.data().status !== 'completed') throw new HttpsError('failed-precondition', 'Order Complete হওয়ার পর Review দিন।');
    if (orderSnap.data().review) throw new HttpsError('already-exists', 'এই অর্ডারে Review দেওয়া হয়েছে।');
    const gig = gigSnap.exists ? gigSnap.data() : {};
    const count = Number(gig.reviewCount || 0);
    const average = Number(gig.rating) || 0;
    const nextCount = count + 1;
    const nextAverage = ((average * count) + stars) / nextCount;
    tx.update(ref, { review: { stars, text: reviewText, by: uid, createdAt: FieldValue.serverTimestamp() }, updatedAt: FieldValue.serverTimestamp() });
    if (gigSnap.exists) tx.update(gigRef, { rating: nextAverage.toFixed(1), reviewCount: nextCount, updatedAt: FieldValue.serverTimestamp() });
  });
  return { saved: true };
});

exports.cancelOrder = onCall({ region: REGION }, async (req) => {
  const uid = requireUser(req);
  const { id } = await transitionOrder(req.data && req.data.orderId,
    (data) => {
      if (data.buyerUid !== uid) throw new HttpsError('permission-denied', 'Buyer-ই এই পর্যায়ে Cancel করতে পারবেন।');
      if (data.status !== 'payment_submitted') throw new HttpsError('failed-precondition', 'Payment যাচাই হয়ে গেলে সরাসরি Cancel করা যাবে না। Admin-এর কাছে Dispute দিন।');
    },
    () => ({ status: 'cancelled', cancelledBy: uid, cancelledAt: FieldValue.serverTimestamp() }));
  return { orderId: id, status: 'cancelled' };
});

exports.createDispute = onCall({ region: REGION }, async (req) => {
  const uid = requireUser(req);
  const note = text(req.data && req.data.note, 2000);
  if (!note) throw new HttpsError('invalid-argument', 'সমস্যার বিবরণ লিখুন।');
  const { id } = await transitionOrder(req.data && req.data.orderId,
    (data) => {
      if (!isParticipant(data, uid)) throw new HttpsError('permission-denied', 'আপনি এই অর্ডারের অংশ নন।');
      if (!['confirmed', 'in_progress', 'delivered', 'revision_requested'].includes(data.status)) throw new HttpsError('failed-precondition', 'এই পর্যায়ে Dispute খোলা যাবে না।');
    },
    () => ({ status: 'disputed', dispute: { note, openedBy: uid, openedAt: FieldValue.serverTimestamp() } }));
  return { orderId: id, status: 'disputed' };
});

exports.adminSetOrderStatus = onCall({ region: REGION }, async (req) => {
  const adminUid = requireAdmin(req);
  const status = text(req.data && req.data.status, 30);
  const note = text(req.data && req.data.note, 500);
  if (!['cancelled', 'refunded'].includes(status)) throw new HttpsError('invalid-argument', 'Admin এই Action-এ শুধু cancelled/refunded দিতে পারবেন।');
  const { id } = await transitionOrder(req.data && req.data.orderId,
    (data) => {
      if (status === 'refunded' && !['disputed', 'cancelled'].includes(data.status)) throw new HttpsError('failed-precondition', 'Refund-এর আগে order disputed/cancelled হতে হবে।');
      if (status === 'cancelled' && !['payment_submitted', 'confirmed', 'in_progress', 'delivered', 'revision_requested', 'disputed'].includes(data.status)) throw new HttpsError('failed-precondition', 'এই অর্ডার আর Cancel করা যাবে না।');
    },
    () => ({ status, adminNote: note, adminUpdatedBy: adminUid, refundedAt: status === 'refunded' ? FieldValue.serverTimestamp() : null }));
  return { orderId: id, status };
});

exports.adminResolveDisputeToSeller = onCall({ region: REGION }, async (req) => {
  const adminUid = requireAdmin(req);
  const { ref, data, id } = await getOrder(req.data && req.data.orderId);
  if (data.status !== 'disputed') throw new HttpsError('failed-precondition', 'শুধু Disputed order resolve করা যাবে।');
  const walletRef = db.collection('wallets').doc(data.sellerUid);
  const ledgerRef = db.collection('ledger').doc('order_' + id);
  await db.runTransaction(async (tx) => {
    const orderSnap = await tx.get(ref);
    const ledgerSnap = await tx.get(ledgerRef);
    const walletSnap = await tx.get(walletRef);
    if (!orderSnap.exists || orderSnap.data().status !== 'disputed') throw new HttpsError('failed-precondition', 'Order status পরিবর্তিত হয়েছে।');
    if (ledgerSnap.exists) throw new HttpsError('already-exists', 'এই অর্ডারের Seller earning আগেই credit হয়েছে।');
    const w = walletSnap.exists ? walletSnap.data() : {};
    const earned = Number(data.sellerGets || 0);
    tx.update(ref, { status: 'completed', completedAt: FieldValue.serverTimestamp(), disputeResolution: 'released_to_seller', resolvedBy: adminUid, resolvedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    tx.set(walletRef, { available: Math.round((Number(w.available || 0) + earned) * 100) / 100, pending: Number(w.pending || 0), lifetimeEarned: Math.round((Number(w.lifetimeEarned || 0) + earned) * 100) / 100, totalPaidOut: Number(w.totalPaidOut || 0), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    tx.create(ledgerRef, { sellerUid: data.sellerUid, orderId: id, amount: earned, currency: CURRENCY, type: 'dispute_release', createdAt: FieldValue.serverTimestamp() });
  });
  return { status: 'completed', sellerGets: Number(data.sellerGets || 0) };
});

exports.requestPayout = onCall({ region: REGION }, async (req) => {
  const uid = requireUser(req);
  const amount = positiveAmount(req.data && req.data.amount);
  const walletRef = db.collection('wallets').doc(uid);
  const userRef = db.collection('users').doc(uid);
  const payoutRef = db.collection('payouts').doc();
  const paymentSettingsSnap = await db.collection('settings').doc('payments').get();
  const paymentSettings = paymentSettingsSnap.exists ? paymentSettingsSnap.data() : {};
  const bdtPerUsd = Number(paymentSettings.bdtPerUsd || 0);
  if (!Number.isFinite(bdtPerUsd) || bdtPerUsd <= 0) throw new HttpsError('failed-precondition', 'Admin-এর USD/BDT exchange rate সেট করা নেই।');
  const expectedBdt = Math.round(amount * bdtPerUsd * 100) / 100;
  await db.runTransaction(async (tx) => {
    const [walletSnap, userSnap] = await Promise.all([tx.get(walletRef), tx.get(userRef)]);
    const w = walletSnap.exists ? walletSnap.data() : {};
    const user = userSnap.exists ? userSnap.data() : {};
    if (amount > Number(w.available || 0)) throw new HttpsError('failed-precondition', 'উপলব্ধ ব্যালেন্স যথেষ্ট নয়।');
    const requestedMethod = text(req.data && req.data.method, 20).toLowerCase();
    const method = requestedMethod || (user.bkash ? 'bkash' : user.nagad ? 'nagad' : '');
    if (!['bkash', 'nagad'].includes(method)) throw new HttpsError('invalid-argument', 'bKash বা Nagad নির্বাচন করুন।');
    const account = method === 'bkash' ? user.bkash : user.nagad;
    if (!account) throw new HttpsError('failed-precondition', 'নির্বাচিত পদ্ধতির payout number Profile-এ সেভ করুন।');
    tx.create(payoutRef, {
      sellerUid: uid, sellerName: text(req.auth.token.name || user.name || '', 100), amount, currency: CURRENCY,
      method, accountNumber: String(account), accountMasked: String(account).replace(/.(?=.{4})/g, '•'), bdtPerUsd, expectedBdt, status: 'pending',
      createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp()
    });
    tx.set(walletRef, { available: Math.round((Number(w.available || 0) - amount) * 100) / 100,
      pending: Math.round((Number(w.pending || 0) + amount) * 100) / 100, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  });
  return { payoutId: payoutRef.id, status: 'pending' };
});

exports.adminUpdatePayout = onCall({ region: REGION }, async (req) => {
  const adminUid = requireAdmin(req);
  const payoutId = text(req.data && req.data.payoutId, 128);
  const status = text(req.data && req.data.status, 20);
  const note = text(req.data && req.data.note, 500);
  if (!payoutId || !['paid', 'rejected'].includes(status)) throw new HttpsError('invalid-argument', 'Payout ID এবং paid/rejected status প্রয়োজন।');
  const payoutRef = db.collection('payouts').doc(payoutId);
  let targetUid = '';
  await db.runTransaction(async (tx) => {
    const payoutSnap = await tx.get(payoutRef);
    if (!payoutSnap.exists) throw new HttpsError('not-found', 'Payout পাওয়া যায়নি।');
    const p = payoutSnap.data(); targetUid = p.sellerUid;
    if (p.status !== 'pending') throw new HttpsError('failed-precondition', 'এই Payout ইতোমধ্যে প্রসেস হয়েছে।');
    const walletRef = db.collection('wallets').doc(p.sellerUid);
    const walletSnap = await tx.get(walletRef); const w = walletSnap.exists ? walletSnap.data() : {};
    const amount = Number(p.amount || 0);
    const pending = Math.max(0, Number(w.pending || 0) - amount);
    tx.update(payoutRef, { status, adminNote: note, reviewedBy: adminUid, reviewedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    tx.set(walletRef, {
      pending: Math.round(pending * 100) / 100,
      available: Math.round((Number(w.available || 0) + (status === 'rejected' ? amount : 0)) * 100) / 100,
      totalPaidOut: Math.round((Number(w.totalPaidOut || 0) + (status === 'paid' ? amount : 0)) * 100) / 100,
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
  });
  await pushNotification(targetUid, status === 'paid' ? 'Payout পাঠানো হয়েছে' : 'Payout অনুরোধ বাতিল', status === 'paid' ? 'আপনার payout paid হিসেবে চিহ্নিত হয়েছে।' : 'আপনার payout rejected হয়েছে: ' + note, 'payout', payoutId);
  return { payoutId, status };
});

// Notifications for new messages. Chat access is constrained by Firestore Rules.
exports.notifyNewMessage = onDocumentCreated({ document: 'messages/{messageId}', region: REGION }, async (event) => {
  const m = event.data && event.data.data(); if (!m || !m.fromUid || !m.threadId) return;
  let recipients = [];
  if (m.kind === 'order') {
    const order = await db.collection('orders').doc(m.threadId).get();
    if (order.exists) { const o = order.data(); recipients = [o.buyerUid, o.sellerUid].filter((x) => x && x !== m.fromUid); }
  } else if (m.kind === 'support') {
    const support = await db.collection('support').doc(m.threadId).get();
    if (support.exists) {
      const owner = support.data().uid;
      if (owner !== m.fromUid) recipients = [owner];
      else {
        const admins = await db.collection('adminUsers').limit(20).get();
        recipients = admins.docs.map((d) => d.id).filter((x) => x !== m.fromUid);
      }
    }
  }
  await Promise.all(recipients.map((uid) => pushNotification(uid, 'নতুন মেসেজ', text(m.text, 180), 'message', m.threadId)));
});

exports.notifyOrderStatus = onDocumentUpdated({ document: 'orders/{orderId}', region: REGION }, async (event) => {
  const before = event.data.before.data(); const after = event.data.after.data();
  if (!before || !after || before.status === after.status) return;
  const body = 'অর্ডার ' + text(after.gigTitle, 100) + ' — নতুন স্ট্যাটাস: ' + text(after.status, 40);
  await Promise.all([after.buyerUid, after.sellerUid].filter(Boolean).map((uid) => pushNotification(uid, 'Order update', body, 'order', event.params.orderId)));
});
