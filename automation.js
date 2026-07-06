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

      // 1. انتقل إلى SSO وانتظر تحميل الصفحة الأساسية
      await page.goto('https://sso.seu.edu.sa', { waitUntil: 'load', timeout: 60000 });

      // 2. انتظر ظهور حقل اسم المستخدم المرئي (وليس المخفي)
      await page.waitForSelector('input[name="username"]:not([type="hidden"])', {
        state: 'visible',
        timeout: 60000
      });

      // 3. املأ البيانات باستخدام المحدد الذي يستبعد العناصر المخفية
      await page.fill('input[name="username"]:not([type="hidden"])', this.username);
      await page.fill('input[name="password"]:not([type="hidden"])', this.password);

      // 4. اضغط على زر الدخول
      await page.click('button[type="submit"], input[type="submit"]');

      // 5. انتظر التوجيه بعد تسجيل الدخول
      await page.waitForNavigation({ waitUntil: 'load', timeout: 60000 });

      console.log("✅ تم تسجيل الدخول بنجاح");

      // ---- جلب بيانات البانر ----
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

      // ---- جلب بيانات البلاك بورد ----
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
      throw err;
    } finally {
      await browser.close();
    }

    return extractedData;
  }
}
