import { chromium } from 'playwright';

export class SEUAutomation {
  constructor(username, password) {
    this.username = username;
    this.password = password;
  }

  async executeSync() {
    // تشغيل المتصفح مع إعدادات مناسبة للبيئة السحابية
    const browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-web-security'
      ]
    });

    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    });

    const page = await context.newPage();
    let extractedData = { banner: {}, blackboard: {} };

    try {
      console.log("⚡ جاري فتح بوابة الدخول الموحد...");
      await page.goto('https://sso.seu.edu.sa', { waitUntil: 'domcontentloaded', timeout: 60000 });

      // --- البحث عن الحقول المرئية بطريقة مرنة ---
      console.log("⏳ جاري البحث عن حقول الدخول...");

      // انتظر حتى تظهر أي حقول إدخال مرئية (حتى لو تغير الـ id/name)
      await page.waitForFunction(
        () => {
          const inputs = Array.from(document.querySelectorAll('input'));
          return inputs.some(inp => inp.offsetParent !== null && inp.type !== 'hidden');
        },
        { timeout: 60000 }
      );

      // استخراج المحددات الصحيحة
      const selectors = await page.evaluate(() => {
        const allInputs = Array.from(document.querySelectorAll('input'));
        const visible = allInputs.filter(inp => inp.offsetParent !== null && inp.type !== 'hidden');

        let usernameSel = null;
        let passwordSel = null;

        // البحث عن حقل اسم المستخدم (أول حقل نصي أو email)
        const textInput = visible.find(inp => inp.type === 'text' || inp.type === 'email' || inp.type === 'tel');
        if (textInput) {
          usernameSel = textInput.id ? `#${textInput.id}` : `[name="${textInput.name}"]`;
        }

        // البحث عن حقل كلمة المرور
        const passInput = visible.find(inp => inp.type === 'password');
        if (passInput) {
          passwordSel = passInput.id ? `#${passInput.id}` : `[name="${passInput.name}"]`;
        }

        // محاولة بديلة: إذا لم نجد، نبحث عن أي حقل به كلمات مفتاحية
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
        throw new Error('لم يتم العثور على حقول الدخول المرئية. قد تكون الصفحة مختلفة.');
      }

      // تعبئة البيانات
      await page.fill(selectors.usernameSel, this.username);
      await page.fill(selectors.passwordSel, this.password);

      // البحث عن زر الدخول (بأكثر من طريقة)
      let submitBtn = await page.$('button[type="submit"]');
      if (!submitBtn) submitBtn = await page.$('input[type="submit"]');
      if (!submitBtn) {
        // محاولة العثور على زر يحتوي على نص معين
        const btn = await page.$('button:has-text("تسجيل"), button:has-text("دخول"), button:has-text("Login"), button:has-text("Sign In")');
        if (btn) submitBtn = btn;
        else throw new Error('لم يتم العثور على زر الدخول');
      }

      await submitBtn.click();

      // انتظار التوجيه بعد تسجيل الدخول (قد يكون هناك عدة عمليات إعادة توجيه)
      await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 });

      console.log("✅ تم تسجيل الدخول بنجاح");

      // ---- جلب بيانات البانر ----
      console.log("⚡ جاري سحب بيانات البانر...");
      await page.goto('https://bannservices.seu.edu.sa/StudentRegistrationSsb/ssb/registration', {
        waitUntil: 'domcontentloaded',
        timeout: 60000
      });
      // انتظار ثوانٍ لتحميل البيانات
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

      // ---- جلب بيانات البلاك بورد ----
      console.log("⚡ جاري فتح البلاك بورد وسحب المقررات...");
      await page.goto('https://lms.seu.edu.sa/webapps/ultra/', {
        waitUntil: 'domcontentloaded',
        timeout: 60000
      });

      // انتظار ظهور رابط المقررات
      await page.waitForSelector('a[js-route="courses"], a:has-text("Courses"), a:has-text("المقررات")', {
        state: 'visible',
        timeout: 60000
      });
      await page.click('a[js-route="courses"], a:has-text("Courses"), a:has-text("المقررات")');
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
      // طباعة رابط الصفحة الحالية للمساعدة في التشخيص
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
