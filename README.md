# برنامج المتجر (React + Supabase + PWA)

## 1) Supabase
1. أنشئ مشروعاً على supabase.com.
2. SQL Editor: الصق محتوى `supabase/schema.sql` وشغّله.
3. Authentication > Users: أضف مستخدمك، وانسخ الـ UUID، ثم شغّل السطر الأخير في الملف لتصبح مديراً.
4. Project Settings > API: انسخ Project URL و anon key.

## 2) تشغيل محلي
    cp .env.example .env     # ضع القيم
    npm install
    npm run dev

## 3) GitHub Pages
1. أنشئ مستودعاً وارفع المشروع على فرع `main`.
2. Settings > Secrets and variables > Actions: أضف `VITE_SUPABASE_URL` و `VITE_SUPABASE_ANON_KEY`.
3. Settings > Pages > Source: اختر **GitHub Actions**.
4. كل push على main ينشر الموقع تلقائياً.
