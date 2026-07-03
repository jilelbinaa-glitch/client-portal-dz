/**
 * ══════════════════════════════════════════════════════════
 *  BRIDGE.JS — طبقة البيانات المشتركة
 *  Firebase Firestore — تزامن لحظي بين بوابة العملاء ومنصة المكتب
 *  مكتب جيل البناء للدراسات
 * ══════════════════════════════════════════════════════════
 */

// ── Firebase Config ─────────────────────────────────────
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, collection, doc, addDoc, getDoc, getDocs,
  updateDoc, onSnapshot, query, orderBy, where,
  serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyC2W3B4F-elXqMYpzTTyUY-elBR29hgWc8",
  authDomain: "client-portal-dz.firebaseapp.com",
  projectId: "client-portal-dz",
  storageBucket: "client-portal-dz.firebasestorage.app",
  messagingSenderId: "949905750584",
  appId: "1:949905750584:web:4c6032dcfdf1fe1a73c4cd",
  measurementId: "G-X22LF4DQWW"
};

const app = initializeApp(firebaseConfig);
const db  = getFirestore(app);

// ── مفاتيح المجموعات ────────────────────────────────────
const COL = {
  requests: 'requests',
  quotes:   'quotes',
  messages: 'messages',
  notifs:   'notifications',
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

// ── uid ─────────────────────────────────────────────────
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2); }

// ── رقم الطلب ───────────────────────────────────────────
async function ticketNum() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm   = String(now.getMonth() + 1).padStart(2, '0');
  const dd   = String(now.getDate()).padStart(2, '0');
  const prefix = `JIL-${yyyy}-${mm}-${dd}-`;

  // عدّ الطلبات الصادرة في نفس اليوم لتحديد الترتيب
  const snap = await getDocs(query(collection(db, COL.requests), where('ticket', '>=', prefix), where('ticket', '<', prefix + '\uffff')));
  const n = (snap.size + 1).toString().padStart(3, '0');
  return prefix + n;
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
    // الحفاظ على القيم الخاصة بـ Firestore (مثل serverTimestamp) دون تعديل
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
    const ref = await addDoc(collection(db, COL.requests), req);
    const result = { id: ref.id, ...req, ticket };

    // إشعار للمكتب
    await Notifs.add('office', {
      type: 'new_request', icon: '📨',
      title: 'طلب جديد من عميل',
      body: `${data.name} — ${data.building || 'مشروع'} — ${data.projWilaya || data.wilaya || ''}`,
      ticket, reqId: ref.id, link: 'requests'
    });

    emit('request:new', result);
    return result;
  },

  async getAll() {
    const snap = await getDocs(query(collection(db, COL.requests), orderBy('submittedAt', 'desc')));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  async get(id) {
    // بحث بالـ ticket أولاً (الحالة الأكثر شيوعاً من بوابة العملاء)
    try {
      const snap = await getDocs(query(collection(db, COL.requests), where('ticket', '==', id)));
      if (!snap.empty) return { id: snap.docs[0].id, ...snap.docs[0].data() };
    } catch (err) {
      console.error('Requests.get (by ticket) failed:', err);
      throw err;
    }
    // بحث بالـ ID المباشر (يُستخدم داخلياً من منصة المكتب)
    try {
      const direct = await getDoc(doc(db, COL.requests, id));
      if (direct.exists()) return { id: direct.id, ...direct.data() };
    } catch (err) {
      // معرف غير صالح كـ document ID — ليس خطأ حقيقي، فقط لم يُطابق
      console.warn('Requests.get (by id) skipped:', err.message);
    }
    return null;
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

  // مراقبة لحظية
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
    const snap = await getDoc(doc(db, COL.quotes, id));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
  },

  async getByReq(reqId) {
    const snap = await getDocs(query(collection(db, COL.quotes), where('reqId', '==', reqId)));
    if (snap.empty) return null;
    const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    all.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
    return all[0];
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

  watchByReq(reqId, cb) {
    return onSnapshot(query(collection(db, COL.quotes), where('reqId', '==', reqId)), snap => {
      if (snap.empty) { cb(null); return; }
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      all.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
      cb(all[0]);
    });
  }
};

// ══════════════════════════════════════════════════════════
//  MESSAGES
// ══════════════════════════════════════════════════════════
const Messages = {

  async send(reqId, from, text, attachments) {
    const req = await Requests.get(reqId);
    const msg = clean({
      reqId, ticket: req?.ticket || '', from, text,
      attachments: attachments || [],
      ts: serverTimestamp(), read: false
    });
    const ref = await addDoc(collection(db, COL.messages), msg);
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
    const snap = await getDocs(query(collection(db, COL.messages), where('reqId', '==', reqId)));
    const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    all.sort((a, b) => toMillis(a.ts) - toMillis(b.ts));
    return all;
  },

  async markRead(reqId, reader) {
    const snap = await getDocs(query(collection(db, COL.messages), where('reqId', '==', reqId)));
    const promises = snap.docs.filter(d => d.data().from !== reader && !d.data().read).map(d => updateDoc(d.ref, { read: true }));
    await Promise.all(promises);
    emit('messages:read', { reqId, reader });
  },

  async officeUnreadTotal() {
    const snap = await getDocs(query(collection(db, COL.messages), where('from', '==', 'client')));
    return snap.docs.filter(d => !d.data().read).length;
  },

  watchThread(reqId, cb) {
    return onSnapshot(query(collection(db, COL.messages), where('reqId', '==', reqId)), snap => {
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      all.sort((a, b) => toMillis(a.ts) - toMillis(b.ts));
      cb(all);
    });
  }
};

// ══════════════════════════════════════════════════════════
//  NOTIFICATIONS
// ══════════════════════════════════════════════════════════
const Notifs = {

  async add(target, data) {
    const notif = clean({ target, ...data, ts: serverTimestamp(), read: false });
    await addDoc(collection(db, COL.notifs), notif);
    emit('notif:' + target, data);
  },

  async get(target) {
    const snap = await getDocs(query(collection(db, COL.notifs), where('target', '==', target)));
    const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    all.sort((a, b) => toMillis(b.ts) - toMillis(a.ts));
    return all;
  },

  async markRead(target, id) {
    await updateDoc(doc(db, COL.notifs, id), { read: true });
  },

  async markAllRead(target) {
    const snap = await getDocs(query(collection(db, COL.notifs), where('target', '==', target)));
    await Promise.all(snap.docs.filter(d => !d.data().read).map(d => updateDoc(d.ref, { read: true })));
  },

  async unread(target) {
    const snap = await getDocs(query(collection(db, COL.notifs), where('target', '==', target)));
    return snap.docs.filter(d => !d.data().read).length;
  },

  watch(target, cb) {
    return onSnapshot(query(collection(db, COL.notifs), where('target', '==', target)), snap => {
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
const Bridge = { Requests, Quotes, Messages, Notifs, STATUS_MAP, SVC_NAMES, fmtDate, fmtNum, on, emit, uid, db };
window.Bridge = Bridge;
export default Bridge;
