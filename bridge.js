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
  updateDoc, deleteDoc, onSnapshot, query, orderBy, where, collectionGroup,
  serverTimestamp, Timestamp, runTransaction, connectFirestoreEmulator
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getAuth, signInAnonymously, onAuthStateChanged,
  signInWithEmailAndPassword, signOut as fbSignOut,
  createUserWithEmailAndPassword, updateProfile, deleteUser,
  sendPasswordResetEmail, sendEmailVerification, connectAuthEmulator
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getStorage, ref as storageRef, uploadBytes, getDownloadURL, connectStorageEmulator
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

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
const storage = getStorage(app);

// ══════════════════════════════════════════════════════════
//  بيئة تجربة منفصلة تماماً عن Firebase الحقيقي —
//  عند التشغيل محلياً (localhost) عبر Firebase Emulator Suite،
//  يتصل التطبيق تلقائياً بالمحاكيات المحلية بدل المشروع الفعلي.
//  لا حاجة لأي تعديل عند النشر الحقيقي — هذا الشرط لا يتفعّل إلا محلياً.
// ══════════════════════════════════════════════════════════
const _isLocalTest = ['localhost', '127.0.0.1'].includes(location.hostname);
if (_isLocalTest) {
  try {
    connectFirestoreEmulator(db, '127.0.0.1', 8081);
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectStorageEmulator(storage, '127.0.0.1', 9199);
    console.log('%c🧪 وضع التجربة: متصل بمحاكيات Firebase المحلية — لا بيانات حقيقية', 'color:#c9a84c;font-weight:bold');
  } catch (e) { console.warn('تعذر الاتصال بالمحاكيات المحلية — تأكد من تشغيل: firebase emulators:start', e); }
}

// تطبيق ثانوي منفصل — يُستخدم فقط لإنشاء حسابات لأشخاص آخرين
// (مثل المدير العام يُنشئ حساب مدير فرع) دون أن يفقد المُنشئ جلسته الحالية.
const secondaryApp  = initializeApp(firebaseConfig, 'AccountCreator');
const secondaryAuth = getAuth(secondaryApp);
if (_isLocalTest) { try { connectAuthEmulator(secondaryAuth, 'http://127.0.0.1:9099', { disableWarnings: true }); } catch(e){} }

// ── مفاتيح المجموعات ────────────────────────────────────
const COL = {
  requests:     'requests',
  quotes:       'quotes',
  officeNotifs: 'office_notifications',
  counters:     'counters',
  teamMembers:  'team_members',
  execProjects: 'exec_projects',
  workOffers:   'work_offers',
  workApps:     'work_applications',
  materials:      'materials',
  materialOrders: 'material_orders',
  studyOffers:    'study_offers',
  officeManagers: 'office_managers',
  warehouses:     'warehouses',
  stockMovements: 'stock_movements',
};

// ── مراحل الإنجاز الموحّدة (10 مراحل) ───────────────────
const EXEC_PHASES = [
  { key:'excavation',  label:'الحفر والترابية',              boqChapter:2,     defaultPay:'daily' },
  { key:'structure',   label:'الهيكل الخرساني',               boqChapter:3,     defaultPay:'daily' },
  { key:'masonry',     label:'البناء والمباني',                boqChapter:4,     defaultPay:'daily' },
  { key:'utilities',   label:'التمديدات الصحية والكهربائية',   boqChapter:'5+6', defaultPay:'daily' },
  { key:'plastering',  label:'اللياسة',                        boqChapter:8,     defaultPay:'daily' },
  { key:'tiling',      label:'التبليط والتكسية',               boqChapter:7,     defaultPay:'piece' },
  { key:'painting',    label:'الطلاء',                         boqChapter:8,     defaultPay:'daily' },
  { key:'carpentry',   label:'النجارة والألمنيوم',             boqChapter:9,     defaultPay:'piece' },
  { key:'outdoor',     label:'التهيئة الخارجية',               boqChapter:10,    defaultPay:'daily' },
  { key:'handover',    label:'التسليم النهائي',                boqChapter:null,  defaultPay:null },
];

// ── تخصصات العمال ────────────────────────────────────────
const SPECIALTIES = ['بناء','حديد وخرسانة','كهرباء','سباكة','نجارة وألمنيوم','دهان','بلاط وتكسية','عزل وتهيئة'];

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
  // يُستدعى من index.html / app.html — يضمن جلسة صالحة
  async ready() {
    if (!auth.currentUser) {
      try { await signInAnonymously(auth); }
      catch (err) {
        console.warn('Anonymous auth not available:', err.code);
      }
    }
    return _authReadyPromise;
  },

  // ── تسجيل حساب عميل جديد ──────────────────────────────
  async registerClient(name, phone, nin, email, password) {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(cred.user, { displayName: name });
    // حفظ بيانات العميل في Firestore
    await setDoc(doc(db, 'clients', cred.user.uid), {
      uid: cred.user.uid, name, phone, nin, email,
      role: 'client',
      createdAt: serverTimestamp(),
      wilaya: '', profileComplete: false
    });
    try { await sendEmailVerification(cred.user); } catch(e) {}
    emit('auth:changed', cred.user);
    return cred.user;
  },

  // ── تسجيل دخول عميل ────────────────────────────────────
  async loginClient(email, password) {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    emit('auth:changed', cred.user);
    return cred.user;
  },

  // ── الحصول على بيانات العميل من Firestore ───────────────
  async getClientProfile(uid) {
    const snap = await getDoc(doc(db, 'clients', uid || auth.currentUser?.uid));
    return snap.exists() ? { uid: snap.id, ...snap.data() } : null;
  },

  // كل العملاء المسجّلين — للمكتب فقط (اختيار عميل عند إنشاء مشروع إنجاز مثلاً)
  async getAllClients() {
    const snap = await getDocs(collection(db, 'clients'));
    return snap.docs.map(d => ({ uid: d.id, ...d.data() }));
  },

  // ── تحديث بيانات العميل ────────────────────────────────
  async updateClientProfile(data) {
    const uid = auth.currentUser?.uid; if (!uid) throw new Error('Not logged in');
    await updateDoc(doc(db, 'clients', uid), { ...data, updatedAt: serverTimestamp() });
  },

  // ── إعادة تعيين كلمة السر ──────────────────────────────
  async resetPassword(email) {
    await sendPasswordResetEmail(auth, email);
  },

  // ── تسجيل دخول المكتب (داشبورد architecture_pm) ────────
  async signIn(email, password) {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    return cred.user;
  },

  async signOut() { await fbSignOut(auth); emit('auth:changed', null); },
  currentUser() { return auth.currentUser; },
  isAnonymous() { return !!auth.currentUser?.isAnonymous; },
  isLoggedIn()  { return !!auth.currentUser && !auth.currentUser.isAnonymous; },
  onChange(cb)  { on('auth:changed', cb); if (_authResolved) cb(auth.currentUser); }
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

// ── رقم مشروع الإنجاز — نفس مبدأ رقم الطلب لكن بادئة مختلفة ─
async function execTicketNum() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm   = String(now.getMonth() + 1).padStart(2, '0');
  const dd   = String(now.getDate()).padStart(2, '0');
  const dateKey = `EXEC-${yyyy}${mm}${dd}`;
  const prefix  = `JIL-EXEC-${yyyy}-${mm}-${dd}-`;

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

// ── رقم طلبية مواد — نفس المبدأ ببادئة مختلفة ───────────
async function matTicketNum() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm   = String(now.getMonth() + 1).padStart(2, '0');
  const dd   = String(now.getDate()).padStart(2, '0');
  const dateKey = `MAT-${yyyy}${mm}${dd}`;
  const prefix  = `JIL-MAT-${yyyy}-${mm}-${dd}-`;

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

  async updateStatus(id, status, statusLabel, desc, officeNotes, dates) {
    const ref = doc(db, COL.requests, id);
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    const old = snap.data();
    const timeline = [...(old.timeline || []), { step:status, label:statusLabel, desc:desc||'', done:true, ts:new Date().toISOString() }];
    const extra = {};
    if (officeNotes !== undefined) extra.officeNotes = officeNotes;
    if (dates?.startDate)    extra.startDate    = dates.startDate;
    if (dates?.deliveryDate) extra.deliveryDate = dates.deliveryDate;
    const update = clean({ status, statusLabel, updatedAt: serverTimestamp(), timeline, ...extra });
    await updateDoc(ref, update);
    const updated = { id, ...old, ...update };

    // إشعار للعميل
    const notifBody = statusLabel + (desc ? ' — ' + desc : '') +
      (dates?.deliveryDate ? ` — تاريخ التسليم: ${dates.deliveryDate}` : '');
    await Notifs.add('client_' + old.ticket, {
      type: 'status_update', icon: '🔄',
      title: 'تحديث على طلبك',
      body: notifBody,
      ticket: old.ticket, reqId: id
    });

    emit('request:updated', updated);
    return updated;
  },

  // رفع مرفق حقيقي (صور/مخططات) إلى Firebase Storage → {name,url,size}
  async uploadFile(ticket, file) {
    const path = `request_files/${ticket}/${Date.now()}_${file.name}`;
    const ref = storageRef(storage, path);
    await uploadBytes(ref, file);
    const url = await getDownloadURL(ref);
    return { name: file.name, url, size: file.size };
  },

  async attachFiles(ticket, fileMetas) {
    await updateDoc(doc(db, COL.requests, ticket), clean({ files: fileMetas, updatedAt: serverTimestamp() }));
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

  async send(reqId, from, text, attachments, humanReply) {
    const req = await Requests.get(reqId);
    const msg = clean({
      reqId, ticket: req?.ticket || '', from, text,
      attachments: attachments || [],
      humanReply: from === 'office' ? true : (humanReply || false),
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
  if (target.startsWith('client_exec_')) {
    const projectId = target.slice(12);
    return { col: collection(db, COL.execProjects, projectId, 'notifications'), isClient: true };
  }
  if (target.startsWith('team_')) {
    const uidT = target.slice(5);
    return { col: collection(db, COL.teamMembers, uidT, 'notifications'), isClient: true };
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
//  TEAM — مؤسسة جيل البناء للإنجاز
//  team_members/{uid}: مهندسو الإشراف الميداني وعمّال الورشة.
//  حساب حقيقي (Email/Password) — نفس منطق حساب العميل، لكن
//  بحالة 'pending' حتى يوافق المكتب فتصبح 'active'.
// ══════════════════════════════════════════════════════════
const Team = {

  async registerEngineer(name, phone, nin, email, password, specialty, visitFee) {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    try {
      await updateProfile(cred.user, { displayName: name });
      const member = clean({
        uid: cred.user.uid, name, phone, nin, email,
        role: 'engineer', specialty: specialty || 'إشراف عام',
        visitFee: Number(visitFee) || 0,
        status: 'pending', currentProjectId: null,
        createdAt: serverTimestamp(),
      });
      await setDoc(doc(db, COL.teamMembers, cred.user.uid), member);
      await Notifs.add('office', {
        type: 'team_join_request', icon: '👷',
        title: 'طلب انضمام مهندس', body: `${name} — ${specialty || 'إشراف عام'}`,
      });
    } catch (err) {
      // فشل حفظ الملف — تراجع عن إنشاء الحساب حتى يمكن إعادة المحاولة بنفس البريد
      try { await deleteUser(cred.user); } catch (e2) {}
      throw err;
    }
    emit('auth:changed', cred.user);
    return cred.user;
  },

  // مهندس متابعة تنفيذ دائم — تصنيف منفصل تماماً عن مهندس الدراسات الفريلانسر
  async registerSupervisor(name, phone, nin, email, password, specialty, visitFee, extra) {
    extra = extra || {};
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    try {
      await updateProfile(cred.user, { displayName: name });
      const member = clean({
        uid: cred.user.uid, name, phone, nin, email,
        role: 'supervisor', specialty: specialty || 'إشراف عام',
        visitFee: Number(visitFee) || 0,
        wilaya: extra.wilaya || '', commune: extra.commune || '',
        directoryVisible: !!extra.directoryVisible,
        status: 'pending', currentProjectId: null,
        createdAt: serverTimestamp(),
      });
      await setDoc(doc(db, COL.teamMembers, cred.user.uid), member);
      await Notifs.add('office', {
        type: 'team_join_request', icon: '🏗️',
        title: 'طلب انضمام مهندس متابعة تنفيذ', body: `${name} — ${specialty || 'إشراف عام'}`,
      });
    } catch (err) {
      try { await deleteUser(cred.user); } catch (e2) {}
      throw err;
    }
    emit('auth:changed', cred.user);
    return cred.user;
  },

  // مدير المستودعات يُنشئ حساب عضو فريق مستودع مباشرة (يبقى مسجّلاً دخوله هو)
  async registerWarehouseStaff(name, phone, email, password, warehouseId) {
    const cred = await createUserWithEmailAndPassword(secondaryAuth, email, password);
    try {
      await updateProfile(cred.user, { displayName: name });
      await setDoc(doc(db, COL.teamMembers, cred.user.uid), clean({
        uid: cred.user.uid, name, phone, email,
        role: 'warehouse_staff', warehouseId: warehouseId || null,
        status: 'active', createdAt: serverTimestamp(),
      }));
    } finally {
      await fbSignOut(secondaryAuth);
    }
    return { uid: cred.user.uid, name, email };
  },

  async registerWorker(name, phone, nin, email, password, specialties, payType, rate, extra) {
    extra = extra || {};
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    try {
      await updateProfile(cred.user, { displayName: name });
      const member = clean({
        uid: cred.user.uid, name, phone, nin, email,
        role: 'worker', specialties: specialties || [],
        payType: payType || 'daily',                 // 'daily' | 'piece'
        dailyWage: payType === 'daily' ? (Number(rate) || 0) : 0,
        phaseRate: payType === 'piece' ? (Number(rate) || 0) : 0,
        wilaya: extra.wilaya || '', commune: extra.commune || '',
        directoryVisible: !!extra.directoryVisible,
        status: 'pending', currentProjectId: null, currentPhase: null,
        createdAt: serverTimestamp(),
      });
      await setDoc(doc(db, COL.teamMembers, cred.user.uid), member);
      await Notifs.add('office', {
        type: 'team_join_request', icon: '🔨',
        title: 'طلب انضمام عامل', body: `${name} — ${(specialties||[]).join('، ')}`,
      });
    } catch (err) {
      try { await deleteUser(cred.user); } catch (e2) {}
      throw err;
    }
    emit('auth:changed', cred.user);
    return cred.user;
  },

  // دليل التواصل المباشر — مهندسو متابعة وعمال نشطون وافقوا على إظهار بياناتهم
  async getDirectory() {
    const snap = await getDocs(collection(db, COL.teamMembers));
    return snap.docs
      .map(d => ({ uid: d.id, ...d.data() }))
      .filter(m => m.status === 'active' && m.directoryVisible === true && (m.role === 'supervisor' || m.role === 'worker'));
  },

  async login(email, password) {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    emit('auth:changed', cred.user);
    return cred.user;
  },

  async getProfile(uid) {
    const snap = await getDoc(doc(db, COL.teamMembers, uid || auth.currentUser?.uid));
    return snap.exists() ? { uid: snap.id, ...snap.data() } : null;
  },

  watchProfile(uid, cb) {
    return onSnapshot(doc(db, COL.teamMembers, uid), snap => { cb(snap.exists() ? { uid: snap.id, ...snap.data() } : null); });
  },

  async updateProfile_(uid, data) {
    await updateDoc(doc(db, COL.teamMembers, uid), clean({ ...data, updatedAt: serverTimestamp() }));
  },

  // المدير الفرعي يوصي بقبول عضو في فريقه — بانتظار موافقة المدير العام النهائية
  async managerRecommend(uid, managerUid) {
    await updateDoc(doc(db, COL.teamMembers, uid), clean({ status: 'manager_approved', recommendedBy: managerUid || null, recommendedAt: serverTimestamp() }));
    await Notifs.add('office', { type:'team_recommend', icon:'📝', title:'توصية بقبول عضو فريق', body:'بانتظار موافقتك النهائية' });
    emit('team:recommended', uid);
  },

  // المكتب فقط — يوافق على طلب انضمام
  async approve(uid) {
    await updateDoc(doc(db, COL.teamMembers, uid), { status: 'active', approvedAt: serverTimestamp() });
    await Notifs.add('team_' + uid, { type:'team_approved', icon:'✅', title:'تم قبول انضمامك!', body:'يمكنك الآن استخدام التطبيق بالكامل' });
    emit('team:approved', uid);
  },

  async reject(uid) {
    await updateDoc(doc(db, COL.teamMembers, uid), { status: 'rejected' });
    emit('team:rejected', uid);
  },

  async suspend(uid) {
    await updateDoc(doc(db, COL.teamMembers, uid), { status: 'suspended' });
    emit('team:suspended', uid);
  },

  // تصفح شامل — للمكتب فقط
  async getAll() {
    const snap = await getDocs(collection(db, COL.teamMembers));
    return snap.docs.map(d => ({ uid: d.id, ...d.data() }));
  },

  watchAll(cb) {
    return onSnapshot(collection(db, COL.teamMembers), snap => {
      cb(snap.docs.map(d => ({ uid: d.id, ...d.data() })));
    });
  },

  // فلترة العميل تتم محلياً (Client-side) لتجنّب فهارس مركّبة
  async getPending() { return (await this.getAll()).filter(m => m.status === 'pending'); },
  async getActiveBySpecialty(spec) {
    return (await this.getAll()).filter(m => m.status === 'active' &&
      (m.specialty === spec || (m.specialties || []).includes(spec)));
  },

  // ── الحضور اليومي (payType:'daily') ─────────────────────
  // team_members/{uid}/attendance/{YYYY-MM-DD} → { status:'P'|'A'|'V'|'H' }
  async setAttendance(uid, dateKey, status) {
    const ref = doc(db, COL.teamMembers, uid, 'attendance', dateKey);
    if (!status) { await setDoc(ref, { status: null }); return; }
    await setDoc(ref, { status, ts: serverTimestamp() });
  },

  async getMonthAttendance(uid, yyyyMm) {
    const snap = await getDocs(collection(db, COL.teamMembers, uid, 'attendance'));
    return snap.docs.filter(d => d.id.startsWith(yyyyMm)).map(d => ({ date: d.id, ...d.data() }));
  },

  // تقرير الأجور الشهري لكل العمال ذوي الأجر اليومي (نفس معادلة النظام الحالي)
  async monthlyWageReport(yyyyMm) {
    const members = (await this.getAll()).filter(m => m.role === 'worker' && m.payType === 'daily' && m.status === 'active');
    const rows = [];
    for (const m of members) {
      const att = await this.getMonthAttendance(m.uid, yyyyMm);
      const P = att.filter(a => a.status === 'P').length;
      const A = att.filter(a => a.status === 'A').length;
      const V = att.filter(a => a.status === 'V').length;
      const gross = P * (m.dailyWage || 0);
      const ded = A > 3 ? (A - 3) * (m.dailyWage || 0) * 0.5 : 0;
      rows.push({ uid: m.uid, name: m.name, specialty: (m.specialties||[]).join('، '), dailyWage: m.dailyWage, P, A, V, gross, ded, net: gross - ded });
    }
    return rows;
  },
};

// ══════════════════════════════════════════════════════════
//  EXEC PROJECTS — مشاريع الإنجاز
//  exec_projects/{JIL-EXEC-...}: مربوطة اختيارياً بطلب الدراسة
//  الأصلي (sourceTicket). تتبّع 10 مراحل تنفيذ + الفريق المُسند.
// ══════════════════════════════════════════════════════════
const ExecProjects = {

  async create(data) {
    const projectId = await execTicketNum();
    const phases = EXEC_PHASES.map(p => ({ ...p, status: 'pending', startDate: null, endDate: null }));
    phases[0].status = 'current';
    const project = clean({
      projectId, ...data,
      phases, currentPhaseIndex: 0,
      team: { engineerId: null, workerIds: [] },
      status: 'awaiting_start',
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    });
    await setDoc(doc(db, COL.execProjects, projectId), project);
    await Notifs.add('office', { type:'exec_project_new', icon:'🏗️', title:'مشروع إنجاز جديد', body: data.clientName || '' });
    emit('exec:created', project);
    return project;
  },

  async get(id) {
    if (!id) return null;
    const snap = await getDoc(doc(db, COL.execProjects, id));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
  },

  // مشاريع عميل معيّن — فلترة بشرط واحد فقط
  async getByClient(clientId) {
    const snap = await getDocs(query(collection(db, COL.execProjects), where('clientId', '==', clientId)));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  // مشاريع مهندس معيّن (حسب team.engineerId) — فلترة بشرط واحد فقط
  async getByEngineer(engineerId) {
    const snap = await getDocs(query(collection(db, COL.execProjects), where('team.engineerId', '==', engineerId)));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  watchByEngineer(engineerId, cb) {
    return onSnapshot(query(collection(db, COL.execProjects), where('team.engineerId', '==', engineerId)), snap => {
      cb(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
  },

  async getAll() {
    const snap = await getDocs(query(collection(db, COL.execProjects), orderBy('createdAt', 'desc')));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  // مراقبة لحظية شاملة — للمكتب فقط
  watchAll(cb) {
    return onSnapshot(query(collection(db, COL.execProjects), orderBy('createdAt', 'desc')), snap => {
      cb(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
  },

  watchOne(id, cb) {
    return onSnapshot(doc(db, COL.execProjects, id), snap => { if (snap.exists()) cb({ id: snap.id, ...snap.data() }); });
  },

  watchByClient(clientId, cb) {
    return onSnapshot(query(collection(db, COL.execProjects), where('clientId', '==', clientId)), snap => {
      cb(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
  },

  async assignTeam(id, { engineerId, workerIds }) {
    const update = {};
    if (engineerId !== undefined) update['team.engineerId'] = engineerId;
    if (workerIds  !== undefined) update['team.workerIds']  = workerIds;
    await updateDoc(doc(db, COL.execProjects, id), { ...update, updatedAt: serverTimestamp() });
    if (engineerId) { try { await Team.updateProfile_(engineerId, { currentProjectId: id }); } catch(e) {} }
    emit('exec:teamAssigned', { id, engineerId, workerIds });
  },

  // الانتقال للمرحلة التالية — يُحدّث حالة المراحل ويُشعر الفريق والعميل
  async advancePhase(id) {
    const ref = doc(db, COL.execProjects, id);
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    const p = snap.data();
    const idx = p.currentPhaseIndex ?? 0;
    const phases = [...p.phases];
    phases[idx] = { ...phases[idx], status: 'done', endDate: new Date().toISOString() };
    const nextIdx = idx + 1;
    let status = p.status;
    if (nextIdx < phases.length) {
      phases[nextIdx] = { ...phases[nextIdx], status: 'current', startDate: new Date().toISOString() };
      status = 'in_progress';
    } else {
      status = 'completed';
    }
    await updateDoc(ref, clean({ phases, currentPhaseIndex: Math.min(nextIdx, phases.length - 1), status, updatedAt: serverTimestamp() }));

    await Notifs.add('client_exec_' + id, { type:'phase_advanced', icon:'📊', title:'تحديث مرحلة المشروع', body: nextIdx < phases.length ? `بدأت مرحلة: ${phases[nextIdx].label}` : 'اكتمل تنفيذ المشروع 🎉' });
    emit('exec:phaseAdvanced', { id, nextIdx });
    return { id, phases, status };
  },

  // ── محاضر زيارة الورشة (مرتبطة بأتعاب المهندس) ──────────
  // exec_projects/{id}/visits/{autoId}
  async addVisit(projectId, { engineerId, date, notes, progress, issues, photos }) {
    const eng = await Team.getProfile(engineerId);
    const visit = clean({
      engineerId, engineerName: eng?.name || '', date: date || new Date().toISOString().slice(0,10),
      notes: notes || '', progress: progress || 0, issues: issues || '', photos: photos || [],
      feeCharged: eng?.visitFee || 0,
      createdAt: serverTimestamp(),
    });
    const ref = await addDoc(collection(db, COL.execProjects, projectId, 'visits'), visit);
    await Notifs.add('client_exec_' + projectId, { type:'visit_added', icon:'📋', title:'محضر زيارة جديد', body: notes || '' });
    emit('exec:visitAdded', { projectId, id: ref.id, ...visit });
    return { id: ref.id, ...visit };
  },

  async uploadVisitPhoto(projectId, file) {
    const path = `visit_photos/${projectId}/${Date.now()}_${file.name}`;
    const ref = storageRef(storage, path);
    await uploadBytes(ref, file);
    const url = await getDownloadURL(ref);
    return { name: file.name, url };
  },

  async getVisits(projectId) {
    const snap = await getDocs(collection(db, COL.execProjects, projectId, 'visits'));
    return snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a,b) => toMillis(b.createdAt) - toMillis(a.createdAt));
  },

  watchVisits(projectId, cb) {
    return onSnapshot(collection(db, COL.execProjects, projectId, 'visits'), snap => {
      cb(snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a,b) => toMillis(b.createdAt) - toMillis(a.createdAt)));
    });
  },

  // ── ملاحظات العميل على سير الإنجاز + ردّ المكتب ─────────
  // exec_projects/{id}/comments/{autoId}
  async addComment(projectId, { from, text }) {
    const comment = clean({ from, text, createdAt: serverTimestamp() });
    const ref = await addDoc(collection(db, COL.execProjects, projectId, 'comments'), comment);
    if (from === 'client') {
      await Notifs.add('office', { type:'exec_comment', icon:'💬', title:'ملاحظة جديدة من العميل', body: text });
    } else {
      await Notifs.add('client_exec_' + projectId, { type:'exec_comment_reply', icon:'💬', title:'رد المكتب على ملاحظتك', body: text });
    }
    emit('exec:comment', { projectId, id: ref.id, ...comment });
    return { id: ref.id, ...comment };
  },

  watchComments(projectId, cb) {
    return onSnapshot(query(collection(db, COL.execProjects, projectId, 'comments'), orderBy('createdAt','asc')), snap => {
      cb(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
  },

  // أتعاب مهندس معيّن خلال شهر معيّن — تُجمع بتصفّح مشاريعه فقط (بدون collectionGroup)
  async monthlyEngineerFees(engineerId, yyyyMm) {
    const eng = await Team.getProfile(engineerId);
    if (!eng?.currentProjectId) return { visits: 0, total: 0 };
    const visits = (await this.getVisits(eng.currentProjectId)).filter(v => (v.date || '').startsWith(yyyyMm));
    return { visits: visits.length, total: visits.reduce((s,v) => s + (v.feeCharged || 0), 0) };
  },
};

// ══════════════════════════════════════════════════════════
//  WORK OFFERS & APPLICATIONS — عروض العمل للعمال
// ══════════════════════════════════════════════════════════
const Offers = {

  async publish(data) {
    const offer = clean({ ...data, status: 'open', createdAt: serverTimestamp() });
    const ref = await addDoc(collection(db, COL.workOffers), offer);
    emit('offer:published', { id: ref.id, ...offer });
    return { id: ref.id, ...offer };
  },

  async close(id) { await updateDoc(doc(db, COL.workOffers, id), { status: 'closed' }); },

  async getAll() {
    const snap = await getDocs(query(collection(db, COL.workOffers), orderBy('createdAt', 'desc')));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  // العروض المفتوحة حسب تخصص عامل معيّن — فلترة شرط واحد + محلية
  async getOpenBySpecialty(specialty) {
    const snap = await getDocs(query(collection(db, COL.workOffers), where('specialty', '==', specialty)));
    return snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(o => o.status === 'open');
  },

  watchAll(cb) {
    return onSnapshot(query(collection(db, COL.workOffers), orderBy('createdAt', 'desc')), snap => {
      cb(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
  },
};

const Applications = {

  async getAll() {
    const snap = await getDocs(collection(db, COL.workApps));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  watchAll(cb) {
    return onSnapshot(collection(db, COL.workApps), snap => {
      cb(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
  },

  async apply(offerId, workerId) {
    const worker = await Team.getProfile(workerId);
    const offerSnap = await getDoc(doc(db, COL.workOffers, offerId));
    if (!offerSnap.exists()) return null;
    const offer = offerSnap.data();
    const application = clean({
      offerId, projectId: offer.projectId, workerId,
      workerName: worker?.name || '', specialty: offer.specialty,
      status: 'pending', appliedAt: serverTimestamp(),
    });
    const ref = await addDoc(collection(db, COL.workApps), application);
    await Notifs.add('office', { type:'work_application', icon:'📝', title:'طلب انضمام لعرض عمل', body:`${worker?.name || ''} — ${offer.specialty}` });
    emit('application:new', { id: ref.id, ...application });
    return { id: ref.id, ...application };
  },

  async getForOffer(offerId) {
    const snap = await getDocs(query(collection(db, COL.workApps), where('offerId', '==', offerId)));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  async getForWorker(workerId) {
    const snap = await getDocs(query(collection(db, COL.workApps), where('workerId', '==', workerId)));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  watchForWorker(workerId, cb) {
    return onSnapshot(query(collection(db, COL.workApps), where('workerId', '==', workerId)), snap => {
      cb(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
  },

  // قبول طلب: يضيف العامل لفريق المشروع ويحدّث حالته + يغلق العرض إن اكتملت الشواغر
  async respond(appId, accepted) {
    const ref = doc(db, COL.workApps, appId);
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    const app = snap.data();
    await updateDoc(ref, { status: accepted ? 'accepted' : 'rejected', respondedAt: serverTimestamp() });

    if (accepted) {
      const project = await ExecProjects.get(app.projectId);
      const workerIds = [...new Set([...(project?.team?.workerIds || []), app.workerId])];
      await ExecProjects.assignTeam(app.projectId, { workerIds });
      await Team.updateProfile_(app.workerId, { currentProjectId: app.projectId, currentPhase: app.offerId });

      const offerSnap = await getDoc(doc(db, COL.workOffers, app.offerId));
      if (offerSnap.exists()) {
        const offer = offerSnap.data();
        const acceptedCount = (await this.getForOffer(app.offerId)).filter(a => a.status === 'accepted').length + 1;
        if (acceptedCount >= (offer.slotsNeeded || 1)) await Offers.close(app.offerId);
      }
    }

    await Notifs.add('team_' + app.workerId, {
      type: accepted ? 'application_accepted' : 'application_rejected',
      icon: accepted ? '✅' : '❌',
      title: accepted ? 'تم قبول طلبك!' : 'لم يُقبل طلبك',
      body: app.specialty,
    });
    emit('application:responded', { id: appId, accepted });
    return { id: appId, ...app, status: accepted ? 'accepted' : 'rejected' };
  },
};

// ══════════════════════════════════════════════════════════
//  STUDY OFFERS — سوق مشاريع الدراسة للمهندسين الفريلانسر
//  study_offers/{requestId}: نسخة "آمنة" من الطلب بدون أي بيانات
//  شخصية عن العميل (لا اسم، لا هاتف، لا بريد، لا رقم تعريف) —
//  فقط متطلبات المشروع، لعرضها للمهندسين قبل قبولهم للمشروع.
// ══════════════════════════════════════════════════════════
const StudyOffers = {

  // ينشرها المكتب بعد موافقة العميل على عرض السعر ودفعه
  async publish(reqId, offerData) {
    const ref = doc(db, COL.studyOffers, reqId);
    const offer = clean({
      reqId,
      ...offerData, // building, floors, area, rooms, services, projWilaya, commune, landInfo, desc, timeline
      feePercent: Number(offerData.feePercent) || 0,
      feeAmount:  Number(offerData.feeAmount)  || 0,
      status: 'open',
      assignedEngineer: null,
      assignedEngineerName: null,
      createdAt: serverTimestamp(),
    });
    await setDoc(ref, offer);
    await updateDoc(doc(db, COL.requests, reqId), clean({ studyOfferPublished: true, updatedAt: serverTimestamp() }));
    emit('studyOffer:published', { id: reqId, ...offer });
    return { id: reqId, ...offer };
  },

  async get(id) {
    const snap = await getDoc(doc(db, COL.studyOffers, id));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
  },

  // المشاريع المتاحة للمهندسين (لم تُسنَد بعد) — مرتّبة الأحدث أولاً
  watchOpen(cb) {
    return onSnapshot(query(collection(db, COL.studyOffers), orderBy('createdAt', 'desc')), snap => {
      cb(snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(o => o.status === 'open'));
    });
  },

  // المشاريع المسندة لمهندس معيّن
  watchMine(engineerUid, cb) {
    return onSnapshot(query(collection(db, COL.studyOffers), where('assignedEngineer', '==', engineerUid)), snap => {
      cb(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
  },

  // المهندس يقبل المشروع + الأتعاب المقترحة معاً (خطوة واحدة)
  async acceptFee(offerId, engineerUid, engineerName) {
    const ref = doc(db, COL.studyOffers, offerId);
    const snap = await getDoc(ref);
    if (!snap.exists() || snap.data().status !== 'open') return null;
    await updateDoc(ref, clean({
      status: 'assigned', assignedEngineer: engineerUid, assignedEngineerName: engineerName || '', assignedAt: serverTimestamp(),
    }));
    await updateDoc(doc(db, COL.requests, offerId), clean({
      assignedEngineer: engineerUid, assignedEngineerName: engineerName || '',
      status: 'engineer_assigned', statusLabel: 'تم إسناد المشروع لمهندس دراسات', updatedAt: serverTimestamp(),
    }));
    await Notifs.add('office', { type: 'study_offer_accepted', icon: '📐', title: 'مهندس قبل مشروع دراسة', body: engineerName || '' });
    emit('studyOffer:accepted', { id: offerId, engineerUid });
    return true;
  },

  // رفع ملف دراسة إلى Firebase Storage → يرجع {name,url,size}
  async uploadFile(offerId, file) {
    const path = `study_files/${offerId}/${Date.now()}_${file.name}`;
    const ref = storageRef(storage, path);
    await uploadBytes(ref, file);
    const url = await getDownloadURL(ref);
    return { name: file.name, url, size: file.size };
  },

  // المهندس يرسل ملفات الدراسة للمراجعة (يستبدل أي ملفات سابقة بأحدث نسخة)
  async submitFiles(offerId, fileMetas) {
    await updateDoc(doc(db, COL.studyOffers, offerId), clean({
      files: fileMetas, status: 'submitted', submittedAt: serverTimestamp(),
    }));
    await Notifs.add('office', { type: 'study_files_submitted', icon: '📎', title: 'المهندس رفع ملفات الدراسة', body: '' });
    emit('studyOffer:filesSubmitted', { id: offerId });
  },

  // المكتب يطّلع على الملفات ثم يرسلها للعميل للمراجعة النهائية
  async sendToClient(offerId) {
    await updateDoc(doc(db, COL.studyOffers, offerId), clean({ status: 'client_review', sentToClientAt: serverTimestamp() }));
    await updateDoc(doc(db, COL.requests, offerId), clean({ studyReviewReady: true, status: 'client_review', statusLabel: 'التصميم بانتظار مراجعتك', updatedAt: serverTimestamp() }));
    await Notifs.add('client_' + offerId, { type: 'design_ready', icon: '🎨', title: 'تصميمك جاهز للمراجعة', body: 'يمكنك الاطّلاع عليه وإبداء ملاحظاتك' });
  },

  // العميل يطلب تعديلاً (رفع تحفظات) — مفتوح بلا حد لعدد الجولات
  async requestRevision(offerId, note) {
    const ref = doc(db, COL.studyOffers, offerId);
    const snap = await getDoc(ref); if (!snap.exists()) return;
    const notes = snap.data().revisionNotes || [];
    notes.push({ text: note, ts: new Date().toISOString(), from: 'client' });
    await updateDoc(ref, clean({ status: 'revisions_requested', revisionNotes: notes }));
    await updateDoc(doc(db, COL.requests, offerId), clean({ status: 'revisions_requested', statusLabel: 'العميل طلب تعديلات على التصميم', updatedAt: serverTimestamp() }));
    await Notifs.add('office', { type: 'study_revision', icon: '✏️', title: 'العميل طلب تعديلات على التصميم', body: note });
  },

  // العميل يوافق نهائياً على التصميم
  async approve(offerId) {
    await updateDoc(doc(db, COL.studyOffers, offerId), clean({ status: 'approved', approvedAt: serverTimestamp() }));
    await updateDoc(doc(db, COL.requests, offerId), clean({ status: 'study_approved', statusLabel: 'تمت الموافقة على الدراسة', updatedAt: serverTimestamp() }));
    await Notifs.add('office', { type: 'study_approved', icon: '✅', title: 'العميل وافق على التصميم النهائي', body: '' });
  },

  // المكتب يدفع أتعاب المهندس بعد موافقة العميل
  async markPaid(offerId) {
    const offer = await this.get(offerId);
    await updateDoc(doc(db, COL.studyOffers, offerId), clean({ status: 'paid', paidAt: serverTimestamp() }));
    if (offer?.assignedEngineer) {
      await Notifs.add('team_' + offer.assignedEngineer, { type: 'fee_paid', icon: '💰', title: 'تم دفع أتعابك', body: (offer.feeAmount||0).toLocaleString('ar-DZ') + ' دج' });
    }
  },

  // انتقال المشروع لمؤسسة الإنجاز بعد اكتمال الدراسة والدفع
  async handToExecution(offerId) {
    await updateDoc(doc(db, COL.studyOffers, offerId), clean({ status: 'handed_to_execution', handedAt: serverTimestamp() }));
    await updateDoc(doc(db, COL.requests, offerId), clean({ status: 'execution', statusLabel: 'انتقل المشروع لمؤسسة الإنجاز', updatedAt: serverTimestamp() }));
  },

  // إغلاق نهائي لطلبات "دراسة ورخصة فقط" — لا يوجد انتقال للإنجاز
  async close(offerId) {
    await updateDoc(doc(db, COL.studyOffers, offerId), clean({ status: 'closed', closedAt: serverTimestamp() }));
    await updateDoc(doc(db, COL.requests, offerId), clean({ status: 'study_closed', statusLabel: 'تم تسليم الدراسة نهائياً', updatedAt: serverTimestamp() }));
  },
};

// ══════════════════════════════════════════════════════════
//  MATERIALS — مستودع بيع مواد البناء
//  materials/{id}: كتالوج مركزي بالأسعار الوحدوية + المخزون الفعلي.
// ══════════════════════════════════════════════════════════
const Materials = {

  async add(data) {
    const material = clean({ ...data, stockQty: Number(data.stockQty)||0, minThreshold: Number(data.minThreshold)||0, unitPrice: Number(data.unitPrice)||0, updatedAt: serverTimestamp() });
    const ref = await addDoc(collection(db, COL.materials), material);
    return { id: ref.id, ...material };
  },

  async update(id, data) {
    await updateDoc(doc(db, COL.materials, id), clean({ ...data, updatedAt: serverTimestamp() }));
  },

  async remove(id) { await deleteDoc(doc(db, COL.materials, id)); },

  async get(id) {
    const snap = await getDoc(doc(db, COL.materials, id));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
  },

  async getAll() {
    const snap = await getDocs(collection(db, COL.materials));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  watchAll(cb) {
    return onSnapshot(collection(db, COL.materials), snap => {
      cb(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
  },

  // تعديل المخزون بفارق (موجب = توريد جديد، سالب = صرف/بيع)
  async adjustStock(id, delta) {
    const ref = doc(db, COL.materials, id);
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) return;
      const cur = Number(snap.data().stockQty) || 0;
      tx.update(ref, { stockQty: Math.max(0, cur + delta), updatedAt: serverTimestamp() });
    });
  },

  // تسجيل حركة مخزون (سلع داخلة أو سلع مباعة يدوياً) مع سجل تتبع
  async recordMovement({ materialId, warehouseId, type, qty, note, staffId, staffName }) {
    const q = Number(qty) || 0;
    if (q <= 0) throw new Error('الكمية يجب أن تكون أكبر من صفر');
    await this.adjustStock(materialId, type === 'in' ? q : -q);
    await addDoc(collection(db, COL.stockMovements), clean({
      materialId, warehouseId: warehouseId || null, type, qty: q,
      note: note || '', staffId: staffId || null, staffName: staffName || '',
      createdAt: serverTimestamp(),
    }));
  },

  watchMovements(warehouseId, cb) {
    return onSnapshot(query(collection(db, COL.stockMovements), where('warehouseId', '==', warehouseId), orderBy('createdAt', 'desc')), snap => {
      cb(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
  },
};

// ══════════════════════════════════════════════════════════
//  WAREHOUSES — مستودعات مواد البناء حسب الموقع
//  warehouses/{id}: مستودع مرتبط بولاية/بلدية معيّنة، يزوّد
//  المشاريع الموجودة في تلك المنطقة.
// ══════════════════════════════════════════════════════════
const Warehouses = {
  async create({ name, wilaya, commune }) {
    const ref = await addDoc(collection(db, COL.warehouses), clean({
      name, wilaya: wilaya || '', commune: commune || '', createdAt: serverTimestamp(),
    }));
    return { id: ref.id, name, wilaya, commune };
  },

  async get(id) {
    const snap = await getDoc(doc(db, COL.warehouses, id));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
  },

  watchAll(cb) {
    return onSnapshot(collection(db, COL.warehouses), snap => {
      cb(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
  },

  async remove(id) { await deleteDoc(doc(db, COL.warehouses, id)); },

  // يبحث عن مستودع يخدم منطقة مشروع معيّن (نفس الولاية، ويُفضَّل نفس البلدية)
  async findServing(wilaya, commune, allWarehouses) {
    const list = allWarehouses || (await getDocs(collection(db, COL.warehouses))).docs.map(d => ({ id: d.id, ...d.data() }));
    return list.find(w => w.wilaya === wilaya && w.commune === commune)
        || list.find(w => w.wilaya === wilaya)
        || null;
  },
};

// ══════════════════════════════════════════════════════════
//  MATERIAL ORDERS — طلبيات/فواتير مواد لمشروع (تُصرف من المخزون)
// ══════════════════════════════════════════════════════════
const MaterialOrders = {

  // items: [{materialId, name, unit, qty, unitPrice}]
  // execProjectId + phaseLabel + supervisorId: عند ربط الطلب بمشروع إنجاز نشط —
  // الطلب حينها يمر أولاً على مهندس المتابعة قبل أن يصل للمستودع
  async create({ projectLabel, clientId, clientName, clientPhone, address, items, notes, source, execProjectId, phaseLabel, supervisorId, fulfillmentMode, warehouseId }) {
    const orderId = await matTicketNum();
    const priced = (items || []).map(it => ({ ...it, subtotal: (Number(it.qty)||0) * (Number(it.unitPrice)||0) }));
    const totalCost = priced.reduce((s, it) => s + it.subtotal, 0);
    const mode = fulfillmentMode === 'pickup' ? 'pickup' : 'delivery';
    // إن كان المشروع مرتبطاً لكن لم يُعيَّن له مهندس متابعة بعد، لا يصح تعليق
    // الطلب في حالة "بانتظار مهندس" بلا مستلم — يُحوَّل مباشرة للمكتب بدل ضياعه.
    const hasSupervisor = !!supervisorId;
    const linked = !!execProjectId && hasSupervisor;
    // طلبات "الاستلام اليدوي" حجز فقط — لا تمر بموافقة مهندس ولا تُخصم من
    // المخزون إلا لحظة الاستلام الفعلي والدفع نقداً بالمستودع.
    const status = mode === 'pickup' ? 'reserved' : (linked ? 'pending_supervisor' : 'draft');
    const order = clean({
      orderId, projectLabel: projectLabel || '', clientId: clientId || null, clientName: clientName || '',
      clientPhone: clientPhone || '', address: address || '',
      items: priced, totalCost, notes: notes || '',
      execProjectId: execProjectId || null, phaseLabel: phaseLabel || null, supervisorId: supervisorId || null,
      fulfillmentMode: mode, warehouseId: warehouseId || null,
      source: source || 'office', status, createdAt: serverTimestamp(),
    });
    await setDoc(doc(db, COL.materialOrders, orderId), order);
    if (mode === 'pickup') {
      await Notifs.add('office', { type:'material_reserved', icon:'🏬', title:'حجز استلام يدوي جديد', body:`${clientName||''} — ${priced.length} بند — ${totalCost.toLocaleString('ar-DZ')} دج` });
    } else if (linked) {
      await Notifs.add('team_' + supervisorId, { type:'material_review', icon:'📦', title:'طلب مواد بانتظار موافقتك', body:`${phaseLabel||''} — ${priced.length} بند` });
    } else if ((source || 'office') === 'client') {
      await Notifs.add('office', { type:'material_order_new', icon:'📦', title:'طلبية مواد جديدة من عميل', body:`${clientName||''} — ${priced.length} بند — ${totalCost.toLocaleString('ar-DZ')} دج` });
    }
    return order;
  },

  // تأكيد استلام الحجز اليدوي فعلياً بالمستودع (دفع نقدي، خصم فوري من المخزون)
  async markPickedUp(orderId) {
    const ref = doc(db, COL.materialOrders, orderId);
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    const order = snap.data();
    for (const it of (order.items || [])) {
      if (it.materialId) await Materials.adjustStock(it.materialId, -(Number(it.qty)||0));
    }
    await updateDoc(ref, { status: 'picked_up', pickedUpAt: serverTimestamp() });
    return { id: orderId, ...order, status: 'picked_up' };
  },

  // مهندس المتابعة يوافق على الطلب (يصبح جاهزاً للمستودع كأي طلبية عادية)
  async approveBySupervisor(orderId) {
    await updateDoc(doc(db, COL.materialOrders, orderId), clean({ status: 'draft', supervisorApprovedAt: serverTimestamp() }));
    await Notifs.add('office', { type:'material_order_new', icon:'📦', title:'طلبية مواد وافق عليها مهندس المتابعة', body:'' });
  },

  // مهندس المتابعة يرفض الطلب (غير مناسب للمرحلة الحالية مثلاً)
  async rejectBySupervisor(orderId, note) {
    await updateDoc(doc(db, COL.materialOrders, orderId), clean({ status: 'rejected_by_supervisor', supervisorNote: note || '' }));
  },

  // طلبيات مشروع إنجاز معيّن (لعرضها للعميل ولمهندس المتابعة)
  watchByProject(execProjectId, cb) {
    return onSnapshot(query(collection(db, COL.materialOrders), where('execProjectId', '==', execProjectId)), snap => {
      cb(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
  },

  // الطلبيات بانتظار موافقة مهندس متابعة معيّن
  watchPendingForSupervisor(supervisorId, cb) {
    return onSnapshot(query(collection(db, COL.materialOrders), where('supervisorId', '==', supervisorId)), snap => {
      cb(snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(o => o.status === 'pending_supervisor'));
    });
  },

  // طلبيات عميل معيّن — فلترة بشرط واحد فقط
  async getByClient(clientId) {
    const snap = await getDocs(query(collection(db, COL.materialOrders), where('clientId', '==', clientId)));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  watchByClient(clientId, cb) {
    return onSnapshot(query(collection(db, COL.materialOrders), where('clientId', '==', clientId)), snap => {
      cb(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
  },

  async get(id) {
    const snap = await getDoc(doc(db, COL.materialOrders, id));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
  },

  async getAll() {
    const snap = await getDocs(query(collection(db, COL.materialOrders), orderBy('createdAt', 'desc')));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  watchAll(cb) {
    return onSnapshot(query(collection(db, COL.materialOrders), orderBy('createdAt', 'desc')), snap => {
      cb(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
  },

  // تأكيد الطلبية — يصرف الكميات من المخزون فعلياً
  async confirm(orderId) {
    const ref = doc(db, COL.materialOrders, orderId);
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    const order = snap.data();
    for (const it of (order.items || [])) {
      if (it.materialId) {
        const qty = Number(it.qty) || 0;
        await Materials.adjustStock(it.materialId, -qty);
        try {
          const matSnap = await getDoc(doc(db, COL.materials, it.materialId));
          const whId = matSnap.exists() ? (matSnap.data().warehouseId || null) : null;
          await addDoc(collection(db, COL.stockMovements), clean({
            materialId: it.materialId, warehouseId: whId, type: 'out', qty,
            note: `بيع — طلبية ${orderId}${order.projectLabel?' — '+order.projectLabel:''}`,
            createdAt: serverTimestamp(),
          }));
        } catch (e) { console.error('stock movement log failed:', e); }
      }
    }
    await updateDoc(ref, { status: 'confirmed', confirmedAt: serverTimestamp() });
    return { id: orderId, ...order, status: 'confirmed' };
  },

  async cancel(orderId) {
    await updateDoc(doc(db, COL.materialOrders, orderId), { status: 'cancelled' });
  },
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
  engineer_assigned:   { label:'قيد إعداد الدراسة',        color:'#2dd4bf', bg:'rgba(45,212,191,.15)',  badge:'bt' },
  client_review:       { label:'🎨 التصميم جاهز للمراجعة', color:'#c9a84c', bg:'rgba(201,168,76,.15)',  badge:'bg' },
  revisions_requested: { label:'بانتظار تعديل المهندس',    color:'#fbbf24', bg:'rgba(251,191,36,.15)',  badge:'ba' },
  study_approved:      { label:'تمت الموافقة على الدراسة', color:'#4ade80', bg:'rgba(74,222,128,.15)',  badge:'bg' },
  study_closed:        { label:'📄 تم التسليم النهائي (دراسة فقط)', color:'#c9a84c', bg:'rgba(201,168,76,.15)', badge:'bg' },
  execution:           { label:'🏗️ قيد الإنجاز',           color:'#a78bfa', bg:'rgba(167,139,250,.15)', badge:'bp' },
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
//  MANAGERS — الترتيب الهرمي لفريق المكتب
//  office_managers/{uid}: حساب مدير فرع (دراسات / إنجاز / مستودعات)
//  ينشئه المدير العام مباشرة. من لا يملك سجلاً هنا ويدخل عبر
//  architecture_pm.html يُعتبر تلقائياً "المدير العام" (كامل الصلاحيات).
// ══════════════════════════════════════════════════════════
const MANAGER_ROLES = {
  studies_manager:   'مدير الدراسات',
  execution_manager: 'مدير مؤسسة الإنجاز',
  warehouse_manager: 'مدير المستودعات',
};

const Managers = {
  // المدير العام يُنشئ حساب مدير فرع مباشرة (يبقى هو مسجّلاً دخوله)
  async create(name, email, password, role) {
    if (!MANAGER_ROLES[role]) throw new Error('دور مدير غير صالح');
    const cred = await createUserWithEmailAndPassword(secondaryAuth, email, password);
    try {
      await updateProfile(cred.user, { displayName: name });
      await setDoc(doc(db, COL.officeManagers, cred.user.uid), clean({
        uid: cred.user.uid, name, email, role, status: 'active',
        createdBy: auth.currentUser?.uid || null, createdAt: serverTimestamp(),
      }));
    } finally {
      await fbSignOut(secondaryAuth); // تنظيف الجلسة الثانوية دون التأثير على جلسة المدير العام
    }
    return { uid: cred.user.uid, name, email, role };
  },

  async getProfile(uid) {
    const snap = await getDoc(doc(db, COL.officeManagers, uid));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
  },

  watchAll(cb) {
    return onSnapshot(collection(db, COL.officeManagers), snap => {
      cb(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
  },

  async suspend(uid) {
    await updateDoc(doc(db, COL.officeManagers, uid), clean({ status: 'suspended' }));
  },
  async reactivate(uid) {
    await updateDoc(doc(db, COL.officeManagers, uid), clean({ status: 'active' }));
  },

  roleLabel(role) { return MANAGER_ROLES[role] || role; },
};

// ══════════════════════════════════════════════════════════
//  EXPORT
// ══════════════════════════════════════════════════════════
const Bridge = {
  Auth, Requests, Quotes, Messages, Notifs, STATUS_MAP, SVC_NAMES, fmtDate, fmtNum, on, emit, uid, db,
  Team, ExecProjects, Offers, Applications, StudyOffers, EXEC_PHASES, SPECIALTIES,
  Materials, MaterialOrders, Managers, MANAGER_ROLES, Warehouses,
};
window.Bridge = Bridge;
export default Bridge;
