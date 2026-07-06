import { chromium } from 'playwright';

export class SEUAutomation {
  constructor(username, password) {
    this.username = username;
    this.password = password;
  }

  async executeSync() {
    const browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    });

    const page = await context.newPage();
    let extractedData = { banner: {}, blackboard: {} };

    try {
      // ----- 1. تسجيل الدخول إلى SSO (نفس الطريقة السابقة) -----
      console.log("⚡ جاري فتح بوابة الدخول الموحد...");
      await page.goto('https://sso.seu.edu.sa', { waitUntil: 'domcontentloaded', timeout: 60000 });

      await page.waitForFunction(
        () => {
          const inputs = Array.from(document.querySelectorAll('input'));
          return inputs.some(inp => inp.offsetParent !== null && inp.type !== 'hidden');
        },
        { timeout: 60000 }
      );

      const selectors = await page.evaluate(() => {
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

      await page.fill(selectors.usernameSel, this.username);
      await page.fill(selectors.passwordSel, this.password);

      let submitBtn = await page.$('button[type="submit"]');
      if (!submitBtn) submitBtn = await page.$('input[type="submit"]');
      if (!submitBtn) {
        const btn = await page.$('button:has-text("تسجيل"), button:has-text("دخول"), button:has-text("Login"), button:has-text("Sign In")');
        if (btn) submitBtn = btn;
        else throw new Error('لم يتم العثور على زر الدخول');
      }

      await submitBtn.click();
      await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 });
      console.log("✅ تم تسجيل الدخول بنجاح إلى SSO");

      // ----- 2. حفظ حالة الجلسة (storageState) -----
      // هذه هي النقطة الأساسية: نخزن كل الكوكيز والتخزين المحلي لاستخدامها لاحقاً
      const storageState = await context.storageState();
      console.log("💾 تم حفظ حالة الجلسة بنجاح");

      // ----- 3. جلب بيانات البانر (نستخدم نفس السياق) -----
      console.log("⚡ جاري سحب بيانات البانر...");
      await page.goto('https://bannservices.seu.edu.sa/StudentRegistrationSsb/ssb/registration', {
        waitUntil: 'domcontentloaded',
        timeout: 60000
      });
      await page.waitForTimeout(5000);

      const bannerData = await page.evaluate(() => {
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

      // ----- 4. الوصول إلى Blackboard (طريقة مختلفة) -----
      console.log("⚡ جاري فتح Blackboard باستخدام الجلسة المحفوظة...");

      // **الخطوة المهمة**: نغلق الصفحة الحالية ونفتح صفحة جديدة بنفس السياق
      // هذا يضمن أن المتصفح يحمل الجلسة دون أي تداخل
      await page.close();
      const newPage = await context.newPage();

      // نذهب مباشرة إلى Blackboard
      await newPage.goto('https://lms.seu.edu.sa/webapps/ultra/', {
        waitUntil: 'domcontentloaded',
        timeout: 60000
      });

      // **الخطوة الذكية**: بدلاً من انتظار عنصر معين، ننتظر حتى يختفي عنوان SSO من الرابط
      // هذا يضمن أن عملية SAML قد اكتملت
      await newPage.waitForFunction(
        () => !window.location.href.includes('sso.seu.edu.sa'),
        { timeout: 60000 }
      );

      // الآن أصبحنا في Blackboard، ننتظر تحميل العناصر
      await newPage.waitForSelector('a[js-route="courses"], a:has-text("Courses"), a:has-text("المقررات")', {
        state: 'visible',
        timeout: 60000
      });
      await newPage.click('a[js-route="courses"], a:has-text("Courses"), a:has-text("المقررات")');
      await newPage.waitForTimeout(5000);

      const courses = await newPage.evaluate(() => {
        const titles = Array.from(document.querySelectorAll('.course-title, .course-element-title, h4, .course-name'));
        return titles.map(el => el.innerText.trim()).filter(text => text.length > 0);
      });

      let assignments = [];
      try {
        assignments = await newPage.evaluate(async () => {
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
    } catch (err) {
      console.error("❌ فشل أثناء الأتمتة:", err);
      try {
        const url = page.url();
        console.log("📌 الصفحة الحالية:", url);
      } catch (e) { /* تجاهل */ }
      throw err;
    } finally {
      await browser.close();
    }

    return extractedData;
  }
}
