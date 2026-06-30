# مكتب جيل البناء للدراسات
## Jil El Bina Architecture & Engineering Office

موقع إلكتروني متكامل لإدارة طلبات العملاء وعمليات المكتب المعماري — **يعمل الآن بقاعدة بيانات Firebase حقيقية ومتزامنة لحظياً.**

---

## هيكل الملفات

```
/
├── index.html           ← بوابة العملاء (الصفحة الرئيسية)
├── architecture_pm.html ← منصة المكتب الداخلية
├── bridge.js            ← طبقة الربط مع Firebase Firestore
├── firestore.rules      ← قواعد الأمان (للنسخ إلى Firebase Console)
└── README.md
```

---

## ⚠️ خطوة ضرورية أولاً: تفعيل Firestore وقواعد الأمان

قبل النشر، يجب إعداد قاعدة البيانات في مشروع Firebase:

### 1. تفعيل Firestore Database
1. اذهب إلى [console.firebase.google.com](https://console.firebase.google.com)
2. افتح مشروعك `client-portal-dz`
3. من القائمة الجانبية: **Build → Firestore Database**
4. انقر **Create database**
5. اختر **Start in production mode** ثم **Next**
6. اختر أقرب موقع جغرافي (مثلاً `eur3` أو `me-west1`) ثم **Enable**

### 2. نسخ قواعد الأمان
1. داخل Firestore Database، اذهب إلى تبويب **Rules**
2. احذف المحتوى الموجود
3. افتح ملف `firestore.rules` المرفق هنا وانسخ محتواه بالكامل
4. الصقه في المحرر ثم انقر **Publish**

> بدون هذه الخطوة، ستظهر رسالة **"Missing or insufficient permissions"** ولن يعمل الموقع.

---

## النشر على GitHub Pages

1. ارفع الملفات الأربعة (`index.html`, `architecture_pm.html`, `bridge.js`, و`firestore.rules` اختياري) إلى مستودعك على GitHub
2. **Settings → Pages → Branch: main → Save**
3. موقعك يصبح متاحاً على:
   ```
   https://[username].github.io/jil-elbina/
   ```

---

## كيف يعمل الربط الآن؟

| العنصر | الوصف |
|---|---|
| **قاعدة البيانات** | Firebase Firestore — سحابية، حقيقية، مشتركة بين كل الزوار |
| **التزامن** | لحظي (`onSnapshot`) — أي تحديث في بوابة العملاء يظهر فوراً في منصة المكتب والعكس |
| **الطلبات الجديدة** | تظهر تلقائياً في منصة المكتب دون الحاجة لتحديث الصفحة |
| **الرسائل والدردشة** | تتزامن لحظياً بين العميل والمكتب |
| **عروض الأسعار** | عند قبول/رفض العميل، تتحدث حالة الطلب فوراً في الطرفين |

---

## معلومات Firebase المستخدمة

```
Project ID: client-portal-dz
المجموعات (Collections):
  - requests       (طلبات العملاء)
  - quotes         (عروض الأسعار)
  - messages       (الدردشة)
  - notifications  (الإشعارات)
```

يمكنك مراقبة البيانات مباشرة من:
**Firebase Console → Firestore Database → Data**

---

## ملاحظات تقنية

- المشروع **static بالكامل** — لا يوجد خادم backend منفصل
- يُستخدم Firebase SDK v10 عبر CDN مباشرة (لا حاجة لـ npm/build step)
- الملفان الرئيسيان (`index.html` و`architecture_pm.html`) يستوردان `bridge.js` كـ **ES Module**
- جميع عمليات Firestore غير متزامنة (async/await) — أي تأخير بسيط في الشبكة طبيعي
- بيانات المشاريع/الفريق/التكاليف في منصة المكتب لا تزال تُحفظ محلياً (localStorage) — فقط الطلبات/العروض/الرسائل مرتبطة بـ Firebase

---

## استكشاف الأخطاء

| المشكلة | الحل |
|---|---|
| "Missing or insufficient permissions" | تأكد من نشر قواعد `firestore.rules` في Firebase Console |
| الطلبات لا تظهر في منصة المكتب | تحقق من Console المتصفح (F12) لرؤية رسائل الخطأ |
| "The query requires an index" | انقر الرابط الظاهر في رسالة الخطأ في Console — سينشئ Firebase الفهرس تلقائياً خلال دقائق |

---

## التواصل

- 📞 0796 532 884
- 📞 0670 158 793
- 📧 jil.elbinaa@gmail.com
