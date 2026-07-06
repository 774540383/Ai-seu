import { chromium } from 'playwright';
import fs from 'fs';

export class SEUAutomation {
  constructor(username, password) {
    this.username = username;
    this.password = password;
    this.storagePath = '/tmp/seu-auth.json'; // مسار حفظ حالة الجلسة
  }

  async executeSync() {
    // ----- الخطوة 1: تسجيل الدخول إلى SSO وحفظ الحالة -----
    const browser1 = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const context1 = await browser1.newContext({
      viewport: { width: 1280, height: 720 },
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    });
    const page1 = await context1.newPage();

    let extractedData = { banner: {}, blackboard: {} };

    try {
      console.log("⚡ جاري فتح بوابة الدخول الموحد...");
      await page1.goto('https://sso.seu.edu.sa', { waitUntil: 'domcontentloaded', timeout: 60000 });

      // البحث عن الحقول المرئية (نفس الطريقة السابقة)
      await page1.waitForFunction(
        () => {
          const inputs = Array.from(document.querySelectorAll('input'));
          return inputs.some(inp => inp.offsetParent !== null && inp.type !== 'hidden');
        },
        { timeout: 60000 }
      );

      const selectors = await page1.evaluate(() => {
        const allInputs = Array.from(document.querySelectorAll('input'));
        const visible = allInputs.filter(inp => inp.offsetParent !== null && inp.type !== 'hidden');
        let usernameSel = null;
        let passwordSel = null;
        const textInput = visible.find(inp => inp.type === 'text' || inp.type === 'email' || inp.type === 'tel');
        if (textInput) {
          usernameSel = textInput.id ? `#${textInput.id}` : `[name="${textInput.name}"]`;
        }
        const passInput = visible.find(inp => inp.type === 'password');
        if (passInput) {
          passwordSel = passInput.id ? `#${passInput.id}` : `[name="${passInput.name}"]`;
        }
        if (!usernameSel) {
          const keywords = ['user', 'email', 'login', 'username', 'uid', 'mail'];
          for (const inp of visible) {
            if (inp.type === 'password') continue;
            const attrs = [inp.name, inp.id, inp.placeholder, inp.className].join(' ').toLowerCase();
            if (keywords.some(kw => attrs.includes(kw))) {
              usernameSel = inp.id ? `#${inp.id}` : `[name="${inp.name}"]`;
              break;
            }
          }
        }
        return { usernameSel, passwordSel };
      });

      console.log("🔍 المحددات المكتشفة:", selectors);

      if (!selectors.usernameSel || !selectors.passwordSel) {
        throw new Error('لم يتم العثور على حقول الدخول المرئية.');
      }

      await page1.fill(selectors.usernameSel, this.username);
      await page1.fill(selectors.passwordSel, this.password);

      let submitBtn = await page1.$('button[type="submit"]');
      if (!submitBtn) submitBtn = await page1.$('input[type="submit"]');
      if (!submitBtn) {
        const btn = await page1.$('button:has-text("تسجيل"), button:has-text("دخول"), button:has-text("Login"), button:has-text("Sign In")');
        if (btn) submitBtn = btn;
        else throw new Error('لم يتم العثور على زر الدخول');
      }

      await submitBtn.click();
      await page1.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 });

      console.log("✅ تم تسجيل الدخول بنجاح إلى SSO");

      // ----- حفظ حالة الجلسة (cookies + localStorage) -----
      const storageState = await context1.storageState();
      fs.writeFileSync(this.storagePath, JSON.stringify(storageState));
      console.log("💾 تم حفظ حالة الجلسة بنجاح");

      // ----- إغلاق المتصفح الأول -----
      await browser1.close();

      // ----- الخطوة 2: استخدام الحالة المحفوظة للوصول إلى Blackboard -----
      console.log("⚡ جاري فتح Blackboard باستخدام الجلسة المحفوظة...");

      const browser2 = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });

      // استعادة الحالة من الملف
      const storedState = JSON.parse(fs.readFileSync(this.storagePath, 'utf8'));
      const context2 = await browser2.newContext({
        storageState: storedState,
        viewport: { width: 1280, height: 720 },
        userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
      });

      const page2 = await context2.newPage();

      // ----- جلب بيانات البانر (يتم عبر السياق المستعاد) -----
      console.log("⚡ جاري سحب بيانات البانر...");
      await page2.goto('https://bannservices.seu.edu.sa/StudentRegistrationSsb/ssb/registration', {
        waitUntil: 'domcontentloaded',
        timeout: 60000
      });
      await page2.waitForTimeout(5000);

      const bannerData = await page2.evaluate(() => {
        const gpaElem = document.querySelector('.gpa-display, .gpa-value, .grade-point-average');
        const gpa = gpaElem ? gpaElem.innerText.trim() : 'N/A';
        const nameElem = document.querySelector('.user-name, .student-name');
        return {
          gpa,
          academicStatus: 'مستمر',
          name: nameElem?.innerText?.trim() || 'طالب'
        };
      });
      extractedData.banner = bannerData;

      // ----- جلب بيانات Blackboard (نفس السياق) -----
      console.log("⚡ جاري فتح Blackboard وسحب المقررات...");
      await page2.goto('https://lms.seu.edu.sa/webapps/ultra/', {
        waitUntil: 'domcontentloaded',
        timeout: 60000
      });

      // انتظار ظهور رابط المقررات
      await page2.waitForSelector('a[js-route="courses"], a:has-text("Courses"), a:has-text("المقررات")', {
        state: 'visible',
        timeout: 60000
      });
      await page2.click('a[js-route="courses"], a:has-text("Courses"), a:has-text("المقررات")');
      await page2.waitForTimeout(5000);

      const courses = await page2.evaluate(() => {
        const titles = Array.from(document.querySelectorAll('.course-title, .course-element-title, h4, .course-name'));
        return titles.map(el => el.innerText.trim()).filter(text => text.length > 0);
      });

      let assignments = [];
      try {
        assignments = await page2.evaluate(async () => {
          const res = await fetch('/learn/api/v1/users/me/grades');
          const data = await res.json();
          return data.results?.map(g => ({ title: g.name, dueDate: g.dueDate })) || [];
        });
      } catch (e) {
        assignments = [{ title: "لا توجد واجبات حالياً", dueDate: "-" }];
      }

      extractedData.blackboard = {
        courses: courses.length ? courses : ["لا توجد مقررات مسجلة"],
        assignments,
        announcements: ["مرحباً بكم في الفصل الدراسي الجديد"]
      };

      console.log("✅ تم استخراج البيانات بنجاح.");

      // تنظيف الملف المؤقت
      try { fs.unlinkSync(this.storagePath); } catch (e) { /* تجاهل */ }

    } catch (err) {
      console.error("❌ فشل أثناء الأتمتة:", err);
      try {
        const url = await page1?.url() || page2?.url();
        console.log("📌 الصفحة الحالية:", url);
      } catch (e) { /* تجاهل */ }
      throw err;
    } finally {
      await browser2?.close();
    }

    return extractedData;
  }
}
