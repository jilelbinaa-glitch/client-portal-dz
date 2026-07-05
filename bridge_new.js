/**
 * ══════════════════════════════════════════════════════════
 *  BRIDGE.JS — طبقة البيانات المشتركة
 *  Firebase Firestore + Auth — تزامن لحظي بين بوابة العملاء ومنصة المكتب
 *  مكتب جيل البناء للدراسات
 *
 *  ملاحظة أمنية:
 *  هذا الملف يعمل مع قواعد أمان Firestore صارمة (انظر firestore.rules).
 *  - العميل (بوابة الموقع / تطبيق الجوال) يدخل بحساب مجهول (Anonymous Auth)
 *    تلقائياً — بدون أي واجهة تسجيل دخول، شفاف تماماً للمستخدم.
 *  - المكتب (منصة architecture_pm.html) يجب أن يسجّل دخول بإيميل/كلمة سر
 *    حقيقية (Bridge.Auth.signIn) قبل أي وصول لبيانات كل العملاء.
 * ══════════════════════════════════════════════════════════
 */

// ── Firebase Config ─────────────────────────────────────
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, collection, doc, setDoc, addDoc, getDoc, getDocs,
  updateDoc, onSnapshot, query, orderBy, where, collectionGroup,
  serverTimestamp, Timestamp, runTransaction
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getAuth, signInAnonymously, onAuthStateChanged,
  signInWithEmailAndPassword, signOut as fbSignOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyC2W3B4F-elXqMYpzTTyUY-elBR29hgWc8",
  authDomain: "client-portal-dz.firebaseapp.com",
  projectId: "client-portal-dz",
  storageBucket: "client-portal-dz.firebasestorage.app",
  messagingSenderId: "949905750584",
  appId: "1:949905750584:web:4c6032dcfdf1fe1a73c4cd",
  measurementId: "G-X22LF4DQWW"
};

const app  = initializeApp(firebaseConfig);
const db   = getFirestore(app);
const auth = getAuth(app);

// ── مفاتيح المجموعات ────────────────────────────────────
const COL = {
  requests:     'requests',
  quotes:       'quotes',
  officeNotifs: 'office_notifications',
  counters:     'counters',
};

// ── المستمعون للأحداث (محلي) ───────────────────────────
const _listeners = {};
function on(event, cb) {
  if (!_listeners[event]) _listeners[event] = [];
  _listeners[event].push(cb);
}
function emit(event, data) {
  (_listeners[event] || []).forEach(cb => cb(data));
}

// ══════════════════════════════════════════════════════════
//  AUTH
//  - ready(): يضمن وجود جلسة (مجهولة إن لم تكن هناك جلسة أصلاً)
//    ينادى مرة عند بدء بوابة الموقع/تطبيق الجوال قبل أي عملية بيانات.
//  - signIn(): تسجيل دخول حقيقي للمكتب بإيميل/كلمة سر.
// ══════════════════════════════════════════════════════════
let _authReadyResolve;
const _authReadyPromise = new Promise(res => { _authReadyResolve = res; });
let _authResolved = false;

onAuthStateChanged(auth, user => {
  if (!_authResolved) { _authResolved = true; _authReadyResolve(user); }
  emit('auth:changed', user);
});

const Auth = {
  // يُستدعى من index.html / app.html — يضمن جلسة مجهولة صالحة
  async ready() {
    if (!auth.currentUser) {
      try { await signInAnonymously(auth); }
      catch (err) {
        // إذا لم يكن Anonymous Auth مفعّلاً، نتابع بدونه
        // (الـ Firestore rules يجب أن تسمح بـ create بدون auth في هذه الحالة)
        console.warn('Anonymous auth not available, continuing without auth:', err.code);
      }
    }
    return _authReadyPromise;
  },
  // يُستدعى من architecture_pm.html — تسجيل دخول حقيقي للموظف
  async signIn(email, password) {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    return cred.user;
  },
  async signOut() {
    await fbSignOut(auth);
  },
  currentUser() { return auth.currentUser; },
  isAnonymous() { return !!auth.currentUser?.isAnonymous; },
  onChange(cb) { on('auth:changed', cb); if (_authResolved) cb(auth.currentUser); }
};

// ── uid (محلي — لأغراض غير حساسة فقط) ──────────────────
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2); }

// ── رقم الطلب — عدّاد تفاعلي آمن (لا يتطلب قراءة كل الطلبات) ─
async function ticketNum() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm   = String(now.getMonth() + 1).padStart(2, '0');
  const dd   = String(now.getDate()).padStart(2, '0');
  const dateKey = `${yyyy}${mm}${dd}`;
  const prefix  = `JIL-${yyyy}-${mm}-${dd}-`;

  const counterRef = doc(db, COL.counters, dateKey);
  const n = await runTransaction(db, async (tx) => {
    const snap = await tx.get(counterRef);
    const next = snap.exists() ? (Number(snap.data().n) || 0) + 1 : 1;
    if (snap.exists()) tx.update(counterRef, { n: next });
    else tx.set(counterRef, { n: next });
    return next;
  });
  return prefix + String(n).padStart(3, '0');
}

// ── تحويل Timestamp إلى ISO ─────────────────────────────
function toISO(val) {
  if (!val) return null;
  if (val instanceof Timestamp) return val.toDate().toISOString();
  if (val?.seconds) return new Date(val.seconds * 1000).toISOString();
  return val;
}

// تحويل أي شكل من أشكال الطابع الزمني إلى رقم (ميلي ثانية) للترتيب
function toMillis(val) {
  if (!val) return 0;
  if (val instanceof Timestamp) return val.toMillis();
  if (typeof val?.seconds === 'number') return val.seconds * 1000;
  if (typeof val === 'string') return new Date(val).getTime() || 0;
  return 0;
}

// ── تنظيف الكائن من undefined ───────────────────────────
function clean(obj) {
  const result = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) { result[k] = null; continue; }
    if (v !== null && typeof v === 'object' && v.constructor && v.constructor.name &&
        (v.constructor.name.includes('FieldValue') || v.constructor.name.includes('Sentinel') || typeof v._methodName === 'string')) {
      result[k] = v;
      continue;
    }
    if (Array.isArray(v)) {
      result[k] = JSON.parse(JSON.stringify(v, (kk, vv) => vv === undefined ? null : vv));
      continue;
    }
    if (v !== null && typeof v === 'object') {
      result[k] = clean(v);
      continue;
    }
    result[k] = v;
  }
  return result;
}

// ══════════════════════════════════════════════════════════
//  REQUESTS
//  معرّف المستند = رقم التذكرة (ticket) نفسه.
//  → معرفة رقم التذكرة تكفي لقراءة الطلب (مثل رقم تتبّع شحنة)،
//    لكن لا يمكن لأحد "تصفّح" كل الطلبات إلا المكتب (بعد تسجيل الدخول).
// ══════════════════════════════════════════════════════════
const Requests = {

  async submit(data) {
    const ticket = await ticketNum();
    const req = clean({
      ticket,
      ...data,
      status: 'pending',
      statusLabel: 'قيد المعالجة',
      submittedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      officeNotes: '',
      quoteId: null,
      projectId: null,
      timeline: [{ step:'submitted', label:'استلام الطلب', desc:'تم استلام طلبك', done:true, ts: new Date().toISOString() }]
    });
    await setDoc(doc(db, COL.requests, ticket), req);
    const result = { id: ticket, ...req, ticket };

    // إشعار للمكتب
    await Notifs.add('office', {
      type: 'new_request', icon: '📨',
      title: 'طلب جديد من عميل',
      body: `${data.name} — ${data.building || 'مشروع'} — ${data.projWilaya || data.wilaya || ''}`,
      ticket, reqId: ticket, link: 'requests'
    });

    emit('request:new', result);
    return result;
  },

  async getAll() {
    const snap = await getDocs(query(collection(db, COL.requests), orderBy('submittedAt', 'desc')));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  // البحث بالتذكرة أو بالمعرّف الداخلي — الاثنان متطابقان الآن
  async get(id) {
    if (!id) return null;
    try {
      const snap = await getDoc(doc(db, COL.requests, String(id).trim().toUpperCase()));
      return snap.exists() ? { id: snap.id, ...snap.data() } : null;
    } catch (err) {
      console.error('Requests.get failed:', err);
      return null;
    }
  },

  async updateStatus(id, status, statusLabel, desc, officeNotes) {
    const ref = doc(db, COL.requests, id);
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    const old = snap.data();
    const timeline = [...(old.timeline || []), { step:status, label:statusLabel, desc:desc||'', done:true, ts:new Date().toISOString() }];
    const update = clean({ status, statusLabel, updatedAt: serverTimestamp(), timeline, ...(officeNotes !== undefined ? { officeNotes } : {}) });
    await updateDoc(ref, update);
    const updated = { id, ...old, ...update };

    // إشعار للعميل
    await Notifs.add('client_' + old.ticket, {
      type: 'status_update', icon: '🔄',
      title: 'تحديث على طلبك',
      body: statusLabel + (desc ? ' — ' + desc : ''),
      ticket: old.ticket, reqId: id
    });

    emit('request:updated', updated);
    return updated;
  },

  async convertToProject(reqId, projectId) {
    const ref = doc(db, COL.requests, reqId);
    const snap = await getDoc(ref);
    if (!snap.exists()) return;
    const old = snap.data();
    const timeline = [...(old.timeline || []), { step:'project_created', label:'بداية المشروع', desc:'تم إنشاء المشروع', done:true, ts:new Date().toISOString() }];
    await updateDoc(ref, clean({ projectId, status:'project_created', statusLabel:'تم إنشاء المشروع', updatedAt:serverTimestamp(), timeline }));
    emit('request:converted', { reqId, projectId });
  },

  async stats() {
    const all = await this.getAll();
    return {
      total:    all.length,
      pending:  all.filter(r => r.status === 'pending').length,
      reviewing:all.filter(r => r.status === 'reviewing').length,
      quoted:   all.filter(r => r.status === 'quoted').length,
      accepted: all.filter(r => r.status === 'accepted').length,
      rejected: all.filter(r => r.status === 'rejected').length,
      converted:all.filter(r => r.status === 'project_created').length,
    };
  },

  // مراقبة لحظية — للمكتب فقط (يتطلب تسجيل دخول)
  watchAll(cb) {
    return onSnapshot(query(collection(db, COL.requests), orderBy('submittedAt', 'desc')), snap => {
      cb(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
  },

  watchOne(id, cb) {
    return onSnapshot(doc(db, COL.requests, id), snap => {
      if (snap.exists()) cb({ id: snap.id, ...snap.data() });
    });
  }
};

// ══════════════════════════════════════════════════════════
//  QUOTES
//  تبقى مجموعة عليا (top-level) — الوصول لعرض واحد بمعرّفه مسموح
//  للجميع (نفس مبدأ رقم التذكرة)، لكن تصفّح كل العروض محصور بالمكتب.
//  العميل يصل لعرضه عبر req.quoteId المخزّن أصلاً في مستند طلبه —
//  دون حاجة لأي استعلام "بحث/تصفّح".
// ══════════════════════════════════════════════════════════
const Quotes = {

  async create(reqId, data) {
    const req = await Requests.get(reqId);
    if (!req) return null;
    const quote = clean({
      reqId, ticket: req.ticket, clientName: req.name,
      ...data,
      status: 'sent',
      createdAt: serverTimestamp(),
      viewedAt: null, respondedAt: null, clientResponse: ''
    });
    const ref = await addDoc(collection(db, COL.quotes), quote);
    const result = { id: ref.id, ...quote };

    // تحديث الطلب
    await Requests.updateStatus(reqId, 'quoted', 'عرض السعر جاهز', 'تم إرسال عرض الأسعار التفصيلي');
    await updateDoc(doc(db, COL.requests, reqId), { quoteId: ref.id });

    // إشعار للعميل
    await Notifs.add('client_' + req.ticket, {
      type: 'quote_ready', icon: '💰',
      title: 'عرض السعر جاهز!',
      body: `تم إعداد عرض أسعار لمشروعك — ${data.totalLabel || ''}`,
      ticket: req.ticket, quoteId: ref.id
    });

    emit('quote:created', result);
    return result;
  },

  async get(id) {
    if (!id) return null;
    const snap = await getDoc(doc(db, COL.quotes, id));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
  },

  // يقرأ quoteId من مستند الطلب نفسه بدل تصفّح مجموعة العروض
  async getByReq(reqId) {
    const req = await Requests.get(reqId);
    if (!req?.quoteId) return null;
    return await this.get(req.quoteId);
  },

  async getAll() {
    const snap = await getDocs(query(collection(db, COL.quotes), orderBy('createdAt', 'desc')));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  async markViewed(id) {
    const ref = doc(db, COL.quotes, id);
    const snap = await getDoc(ref);
    if (snap.exists() && !snap.data().viewedAt) {
      await updateDoc(ref, { viewedAt: serverTimestamp() });
      emit('quote:viewed', { id, ...snap.data() });
    }
  },

  async respond(id, accepted, comment) {
    const ref = doc(db, COL.quotes, id);
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    const q = snap.data();
    const update = clean({ status: accepted ? 'accepted' : 'rejected', respondedAt: serverTimestamp(), clientResponse: comment || '' });
    await updateDoc(ref, update);
    await Requests.updateStatus(q.reqId, accepted ? 'accepted' : 'rejected',
      accepted ? 'تم القبول — المشروع قيد الإطلاق' : 'تم الرفض', comment || '');

    await Notifs.add('office', {
      type: accepted ? 'quote_accepted' : 'quote_rejected',
      icon: accepted ? '✅' : '❌',
      title: accepted ? 'عرض السعر مقبول!' : 'رُفض عرض السعر',
      body: q.clientName + (comment ? ' — ' + comment : ''),
      ticket: q.ticket, quoteId: id
    });

    const result = { id, ...q, ...update };
    emit('quote:responded', result);
    return result;
  },

  // مراقبة لحظية لعرض طلب معيّن — تتبع مستند الطلب (quoteId) بدل استعلام تصفّح
  watchByReq(reqId, cb) {
    let quoteUnsub = null;
    const reqUnsub = onSnapshot(doc(db, COL.requests, reqId), snap => {
      if (quoteUnsub) { quoteUnsub(); quoteUnsub = null; }
      const qid = snap.exists() ? snap.data().quoteId : null;
      if (!qid) { cb(null); return; }
      quoteUnsub = onSnapshot(doc(db, COL.quotes, qid), qsnap => {
        cb(qsnap.exists() ? { id: qsnap.id, ...qsnap.data() } : null);
      });
    });
    return () => { reqUnsub(); if (quoteUnsub) quoteUnsub(); };
  }
};

// ══════════════════════════════════════════════════════════
//  MESSAGES
//  تُخزَّن الآن كمجموعة فرعية requests/{ticket}/messages —
//  معرفة رقم التذكرة (المسار نفسه) شرط لازم لقراءة المحادثة،
//  والمكتب وحده يملك رؤية شاملة عبر كل التذاكر (collection group).
// ══════════════════════════════════════════════════════════
function msgsCol(reqId) { return collection(db, COL.requests, reqId, 'messages'); }

const Messages = {

  async send(reqId, from, text, attachments) {
    const req = await Requests.get(reqId);
    const msg = clean({
      reqId, ticket: req?.ticket || '', from, text,
      attachments: attachments || [],
      ts: serverTimestamp(), read: false
    });
    const ref = await addDoc(msgsCol(reqId), msg);
    const result = { id: ref.id, ...msg };

    const target = from === 'client' ? 'office' : 'client_' + (req?.ticket || '');
    await Notifs.add(target, {
      type: 'new_message',
      icon: from === 'client' ? '💬' : '📩',
      title: from === 'client' ? 'رسالة من العميل' : 'رد من المكتب',
      body: text.substring(0, 80) + (text.length > 80 ? '...' : ''),
      ticket: req?.ticket || '', reqId
    });

    emit('message:new', result);
    return result;
  },

  async getThread(reqId) {
    const snap = await getDocs(msgsCol(reqId));
    const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    all.sort((a, b) => toMillis(a.ts) - toMillis(b.ts));
    return all;
  },

  async markRead(reqId, reader) {
    const snap = await getDocs(msgsCol(reqId));
    const promises = snap.docs.filter(d => d.data().from !== reader && !d.data().read).map(d => updateDoc(d.ref, { read: true }));
    await Promise.all(promises);
    emit('messages:read', { reqId, reader });
  },

  // إجمالي غير المقروء من العملاء — للمكتب فقط (collection group)
  async officeUnreadTotal() {
    const snap = await getDocs(query(collectionGroup(db, 'messages'), where('from', '==', 'client')));
    return snap.docs.filter(d => !d.data().read).length;
  },

  watchThread(reqId, cb) {
    return onSnapshot(msgsCol(reqId), snap => {
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      all.sort((a, b) => toMillis(a.ts) - toMillis(b.ts));
      cb(all);
    });
  },

  // مراقبة لحظية شاملة لكل رسائل العملاء عبر كل التذاكر — للمكتب فقط
  watchAllClientMessages(cb) {
    return onSnapshot(query(collectionGroup(db, 'messages'), where('from', '==', 'client')), cb);
  }
};

// ══════════════════════════════════════════════════════════
//  NOTIFICATIONS
//  إشعارات المكتب → مجموعة عليا office_notifications (محصورة بالمكتب)
//  إشعارات عميل معيّن → requests/{ticket}/notifications (بمعرفة التذكرة)
// ══════════════════════════════════════════════════════════
function notifTarget(target) {
  if (target === 'office') {
    return { col: collection(db, COL.officeNotifs), isClient: false };
  }
  const ticket = target.startsWith('client_') ? target.slice(7) : target;
  return { col: collection(db, COL.requests, ticket, 'notifications'), isClient: true };
}

const Notifs = {

  async add(target, data) {
    const { col } = notifTarget(target);
    const notif = clean({ target, ...data, ts: serverTimestamp(), read: false });
    await addDoc(col, notif);
    emit('notif:' + target, data);
  },

  async get(target) {
    const { col } = notifTarget(target);
    const snap = await getDocs(col);
    const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    all.sort((a, b) => toMillis(b.ts) - toMillis(a.ts));
    return all;
  },

  async markRead(target, id) {
    const { col } = notifTarget(target);
    await updateDoc(doc(col, id), { read: true });
  },

  async markAllRead(target) {
    const { col } = notifTarget(target);
    const snap = await getDocs(col);
    await Promise.all(snap.docs.filter(d => !d.data().read).map(d => updateDoc(d.ref, { read: true })));
  },

  async unread(target) {
    const { col } = notifTarget(target);
    const snap = await getDocs(col);
    return snap.docs.filter(d => !d.data().read).length;
  },

  watch(target, cb) {
    const { col } = notifTarget(target);
    return onSnapshot(col, snap => {
      cb(snap.docs.filter(d => !d.data().read).length);
    });
  }
};

// ══════════════════════════════════════════════════════════
//  STATUS MAP & HELPERS
// ══════════════════════════════════════════════════════════
const STATUS_MAP = {
  pending:         { label:'قيد المعالجة',   color:'#fbbf24', bg:'rgba(251,191,36,.15)',  badge:'ba' },
  reviewing:       { label:'قيد الدراسة',    color:'#2dd4bf', bg:'rgba(45,212,191,.15)',  badge:'bt' },
  quoted:          { label:'عرض السعر جاهز', color:'#c9a84c', bg:'rgba(201,168,76,.15)',  badge:'bg' },
  accepted:        { label:'مقبول',           color:'#4ade80', bg:'rgba(74,222,128,.15)',  badge:'bg' },
  rejected:        { label:'مرفوض',           color:'#f87171', bg:'rgba(248,113,113,.15)', badge:'br' },
  project_created: { label:'مشروع نشط',       color:'#a78bfa', bg:'rgba(167,139,250,.15)', badge:'bp' },
};

const SVC_NAMES = {
  study:'الدراسة المعمارية', permit:'ملف رخصة البناء',
  structure:'الدراسة الهيكلية', supervision:'الإشراف على الإنجاز',
  interior:'التصميم الداخلي', estimate:'تقدير التكاليف'
};

function fmtDate(iso) {
  if (!iso) return '—';
  const d = iso?.seconds ? new Date(iso.seconds * 1000) : new Date(iso);
  return d.toLocaleString('ar-DZ', { year:'numeric', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
}

function fmtNum(n) { return Number(n || 0).toLocaleString('ar-DZ'); }

// ══════════════════════════════════════════════════════════
//  EXPORT
// ══════════════════════════════════════════════════════════
const Bridge = { Auth, Requests, Quotes, Messages, Notifs, STATUS_MAP, SVC_NAMES, fmtDate, fmtNum, on, emit, uid, db };
window.Bridge = Bridge;
export default Bridge;
