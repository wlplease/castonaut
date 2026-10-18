import { initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, signInAnonymously } from 'firebase/auth';
import { addDoc, collection, doc, getFirestore, limit, onSnapshot, orderBy, query, serverTimestamp, setDoc } from 'firebase/firestore';

const env = import.meta.env;
const config = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  appId: env.VITE_FIREBASE_APP_ID,
};

export const cloudReady = Object.values(config).every(Boolean);
const app = cloudReady ? initializeApp(config) : null;
const auth = app ? getAuth(app) : null;
const db = app ? getFirestore(app) : null;
let user = null;
let unsubScores = () => {};
let unsubChat = () => {};

const localKey = 'afterhours-score-v1';
const nameKey = 'afterhours-name-v1';
export const getName = () => localStorage.getItem(nameKey) || '';
export const setName = name => localStorage.setItem(nameKey, name.slice(0, 18));
export const getLocalBest = () => Number(localStorage.getItem(localKey) || 0);

export async function connectArcade(onStatus) {
  if (!cloudReady) {
    onStatus('local');
    return;
  }
  onAuthStateChanged(auth, account => {
    user = account;
    onStatus(account ? 'online' : 'connecting');
  });
  try {
    if (!auth.currentUser) await signInAnonymously(auth);
  } catch (error) {
    console.error('Arcade sign-in failed', error);
    onStatus('offline');
  }
}

export function watchScores(onRows) {
  unsubScores();
  if (!db) {
    onRows([]);
    return;
  }
  unsubScores = onSnapshot(query(collection(db, 'scores'), orderBy('score', 'desc'), limit(20)), snap => {
    onRows(snap.docs.map(item => ({ id: item.id, ...item.data() })));
  }, error => {
    console.error('Leaderboard failed', error);
    onRows([]);
  });
}

export async function saveScore(score, name) {
  if (score > getLocalBest()) localStorage.setItem(localKey, String(score));
  if (!db || !user) return { saved: false, reason: 'Firebase is not connected' };
  try {
    await setDoc(doc(db, 'scores', user.uid), {
      uid: user.uid,
      name: name.slice(0, 18),
      score,
      game: 'neon-rush',
      updatedAt: serverTimestamp(),
    }, { merge: true });
    return { saved: true };
  } catch (error) {
    console.error('Score save failed', error);
    return { saved: false, reason: 'Score could not be saved online' };
  }
}

export function watchChat(onRows) {
  unsubChat();
  if (!db) {
    onRows([]);
    return;
  }
  unsubChat = onSnapshot(query(collection(db, 'chat'), orderBy('createdAt', 'desc'), limit(30)), snap => {
    onRows(snap.docs.map(item => ({ id: item.id, ...item.data() })).reverse());
  }, error => {
    console.error('Chat failed', error);
    onRows([]);
  });
}

export async function sendChat(body, name) {
  if (!db || !user) throw new Error('Connect Firebase to join the lobby chat.');
  await addDoc(collection(db, 'chat'), {
    uid: user.uid,
    name: name.slice(0, 18),
    body: body.slice(0, 160),
    createdAt: serverTimestamp(),
  });
}

export async function reportChat(messageId) {
  if (!db || !user) throw new Error('Connect to report a message.');
  await setDoc(doc(db, 'reports', `${user.uid}_${messageId}`), {
    uid: user.uid,
    messageId,
    createdAt: serverTimestamp(),
  });
}

export function watchQuarterBalance(onBalance) {
  if (!db || !user) { onBalance(null); return () => {}; }
  return onSnapshot(doc(db, 'arcadeBalances', user.uid), snap => onBalance(snap.exists() ? snap.data().quarters : 0), error => {
    console.error('Quarter balance failed', error);
    onBalance(null);
  });
}

export async function claimQuarter(hash, signature) {
  if (!user) throw new Error('Firebase sign-in is required to claim a quarter.');
  const token = await user.getIdToken();
  const response = await fetch('/api/claim', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ hash, signature }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Quarter claim could not be verified.');
  return result;
}

export const playerId = () => user?.uid || null;
