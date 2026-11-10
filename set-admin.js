'use strict';
// Run locally with Application Default Credentials and the target Firebase project.
// Never call this from the website or expose a service-account key to browser users.
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const projectId = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID;
const uid = process.env.ADMIN_UID;
if (!projectId || !uid) {
  console.error('Set FIREBASE_PROJECT_ID and ADMIN_UID before running this script.');
  process.exit(1);
}
initializeApp({ credential: applicationDefault(), projectId });
(async () => {
  const auth = getAuth();
  const user = await auth.getUser(uid);
  await auth.setCustomUserClaims(uid, { ...(user.customClaims || {}), admin: true });
  await getFirestore().collection('adminUsers').doc(uid).set({ uid, email: user.email || '', grantedAt: FieldValue.serverTimestamp() }, { merge: true });
  console.log(`Admin claim granted to UID ${uid}. User must sign out/in or refresh token.`);
})().catch((err) => { console.error(err); process.exit(1); });
