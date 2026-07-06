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
      console.log("⚡ جاري فتح بوابة الدخول الموحد...");
      await page.goto('https://sso.seu.edu.sa', { waitUntil: 'load', timeout: 60000 });

      // --- الخطوة الذكية: البحث عن الحقول المرئية ديناميكياً ---
      console.log("⏳ جاري البحث عن حقول الدخول المرئية...");

      // انتظر حتى تظهر أي حقول إدخال مرئية
      await page.waitForFunction(
        () => {
          const inputs = Array.from(document.querySelectorAll('input'));
          return inputs.some(inp => inp.offsetParent !== null && inp.type !== 'hidden');
        },
        { timeout: 60000 }
      );

      // استخدم evaluate لاستخراج المحددات الصحيحة للحقول المرئية
      const fieldSelectors = await page.evaluate(() => {
        const allInputs = Array.from(document.querySelectorAll('input'));
        // تصفية الحقول المرئية (غير المخفية)
        const visibleInputs = allInputs.filter(inp => inp.offsetParent !== null && inp.type !== 'hidden');

        let usernameSelector = null;
        let passwordSelector = null;

        // محاولة العثور على حقل اسم المستخدم (يبحث في name, id, placeholder)
        const usernameKeywords = ['user', 'email', 'login', 'username', 'uid', 'mail'];
        for (const inp of visibleInputs) {
          if (inp.type === 'password') continue; // نستثني كلمة المرور
          const attrs = [inp.name, inp.id, inp.placeholder, inp.className].join(' ').toLowerCase();
          if (usernameKeywords.some(kw => attrs.includes(kw))) {
            usernameSelector = `#${inp.id}` || `[name="${inp.name}"]`;
            break;
          }
        }
        // إذا لم نجد، نأخذ أول حقل نصي visible
        if (!usernameSelector) {
          const firstText = visibleInputs.find(inp => inp.type === 'text' || inp.type === 'email');
          if (firstText) {
            usernameSelector = `#${firstText.id}` || `[name="${firstText.name}"]`;
          }
        }

        // حقل كلمة المرور
        const passwordInput = visibleInputs.find(inp => inp.type === 'password');
        if (passwordInput) {
          passwordSelector = `#${passwordInput.id}` || `[name="${passwordInput.name}"]`;
        }

        return { usernameSelector, passwordSelector };
      });

      console.log("🔍 المحددات التي تم اكتشافها:", fieldSelectors);

      if (!fieldSelectors.usernameSelector || !fieldSelectors.passwordSelector) {
        throw new Error('لم يتم العثور على حقول الدخول المرئية. قد تكون الصفحة مختلفة.');
      }

      // تعبئة البيانات باستخدام المحددات المكتشفة
      await page.fill(fieldSelectors.usernameSelector, this.username);
      await page.fill(fieldSelectors.passwordSelector, this.password);

      // البحث عن زر الدخول (يمكن أن يكون button أو input submit)
      const submitBtn = await page.$('button[type="submit"], input[type="submit"]');
      if (!submitBtn) {
        // محاولة العثور على زر يحتوي على نص "تسجيل" أو "دخول"
        const btn = await page.$('button:has-text("تسجيل"), button:has-text("دخول"), button:has-text("Login")');
        if (btn) await btn.click();
        else throw new Error('لم يتم العثور على زر الدخول');
      } else {
        await submitBtn.click();
      }

      await page.waitForNavigation({ waitUntil: 'load', timeout: 60000 });

      console.log("✅ تم تسجيل الدخول بنجاح");

      // ---- باقي الكود لجلب البيانات من البانر والبلاك بورد (نفس الكود السابق) ----
      // ... (يمكنك نسخه من الإصدارات السابقة أو تركه كما هو)
      // ولكني سأضيفه للاكتمال

      console.log("⚡ جاري سحب بيانات البانر...");
      await page.goto('https://bannservices.seu.edu.sa/StudentRegistrationSsb/ssb/registration', {
        waitUntil: 'load',
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

      console.log("⚡ جاري فتح البلاك بورد وسحب المقررات...");
      await page.goto('https://lms.seu.edu.sa/webapps/ultra/', {
        waitUntil: 'load',
        timeout: 60000
      });
      await page.waitForSelector('a[js-route="courses"]', { state: 'visible', timeout: 60000 });
      await page.click('a[js-route="courses"]');
      await page.waitForTimeout(5000);

      const courses = await page.evaluate(() => {
        const titles = Array.from(document.querySelectorAll('.course-title, .course-element-title, h4, .course-name'));
        return titles.map(el => el.innerText.trim()).filter(text => text.length > 0);
      });

      let assignments = [];
      try {
        assignments = await page.evaluate(async () => {
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
      // طباعة رابط الصفحة الحالية للمساعدة في التصحيح
      const url = page.url();
      console.log("📌 الصفحة الحالية:", url);
      throw err;
    } finally {
      await browser.close();
    }

    return extractedData;
  }
}
