# مكتب جيل البناء للهندسة المعمارية والعمرانية
## Jel Al-Bina'a — Architecture & Urban Studies

---

## الملفات / Files

| الملف | الدور |
|---|---|
| `client_portal.html` | **تطبيق العملاء الجديد** — تسجيل + اختيار خدمة + طلبات + متابعة |
| `index.html` | موقع بوابة العملاء (ويب - الإصدار القديم) |
| `app.html` | تطبيق الجوال PWA القديم |
| `architecture_pm.html` | منصة المكتب الداخلية للمهندسين |
| `bridge.js` | طبقة Firebase المشتركة |
| `firestore.rules` | قواعد الأمان — انسخه في Firebase Console |
| `sw.js` | Service Worker للعمل أوفلاين |
| `manifest.json` | بيانات PWA |
| `logo.png / 180 / 512` | شعار المكتب |

---

## ⚠️ خطوتان ضروريتان قبل الاستخدام

### 1. تفعيل Email/Password Authentication
1. [console.firebase.google.com](https://console.firebase.google.com) → مشروعك
2. **Build → Authentication → Sign-in method**
3. فعّل **Email/Password** → Save
4. (اختياري) فعّل **Anonymous** أيضاً

### 2. نشر قواعد Firestore
1. **Firestore Database → Rules**
2. احذف المحتوى القديم → الصق محتوى `firestore.rules` → **Publish**

---

## الروابط بعد النشر

| الصفحة | الرابط |
|---|---|
| **تطبيق العملاء (جديد)** | `.../client_portal.html` |
| موقع العملاء (قديم) | `.../index.html` أو `/` |
| تطبيق الجوال PWA | `.../app.html` |
| منصة المكتب | `.../architecture_pm.html` |

---

## مسار العميل الجديد

```
1. يفتح client_portal.html
2. ينشئ حساباً (اسم + هاتف + رقم التعريف الوطني + بريد + كلمة مرور)
3. يختار نوع الخدمة:
   📐 دراسة المشروع  ← مخططات + رخصة + دراسة هيكلية
   🏗️ إنجاز المشروع ← إشراف ميداني + متابعة الورشة
4. يملأ نموذج الطلب (4 خطوات)
5. يحصل على رقم JIL-YYYY-MM-DD-NNN
6. يتابع طلبه ويتواصل مع المكتب من نفس التطبيق
```

---

## معلومات التواصل
- 📞 0796 532 884 — 0670 158 793
- 📧 jil.elbinaa@gmail.com
