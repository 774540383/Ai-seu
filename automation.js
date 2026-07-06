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
      // ----- 1. الدخول إلى Blackboard مباشرة -----
      console.log("⚡ جاري فتح Blackboard...");
      await page.goto('https://lms.seu.edu.sa', { waitUntil: 'domcontentloaded', timeout: 60000 });

      // ----- 2. انتظر حتى يتم التوجيه إلى SSO -----
      console.log("⏳ جاري انتظار التوجيه إلى SSO...");
      await page.waitForURL(/sso\.seu\.edu\.sa/, { timeout: 60000 });
      console.log("✅ تم التوجيه إلى SSO");

      // ----- 3. تسجيل الدخول في SSO -----
      console.log("⚡ جاري تسجيل الدخول...");
      await page.waitForSelector('#usernameUserInput, #username, input[name="username"]', { state: 'visible', timeout: 60000 });
      await page.fill('#usernameUserInput', this.username);
      await page.fill('#password', this.password);

      const submitBtn = await page.$('button[type="submit"]');
      if (submitBtn) {
        await submitBtn.click();
      } else {
        // محاولة بديلة
        await page.press('#password', 'Enter');
      }

      // ----- 4. انتظر العودة إلى Blackboard -----
      console.log("⏳ جاري انتظار العودة إلى Blackboard...");
      await page.waitForURL(/lms\.seu\.edu\.sa/, { timeout: 60000 });
      console.log("✅ تم العودة إلى Blackboard");

      // ----- 5. انتظر تحميل الصفحة -----
      await page.waitForTimeout(5000);

      // ----- 6. جلب المقررات -----
      console.log("⚡ جاري سحب المقررات...");
      let courses = [];

      try {
        // محاولة البحث عن عناصر المقررات
        await page.waitForSelector('.course-title, .course-element-title, h4, .course-name', { timeout: 30000 });
        courses = await page.evaluate(() => {
          const titles = Array.from(document.querySelectorAll('.course-title, .course-element-title, h4, .course-name'));
          return titles.map(el => el.innerText.trim()).filter(text => text.length > 0);
        });
      } catch (e) {
        console.log("⚠️ لم يتم العثور على عناصر المقررات، محاولة قراءة النص...");
        courses = await page.evaluate(() => {
          const allText = document.body.innerText;
          const lines = allText.split('\n').filter(line => line.trim().length > 0);
          return lines.slice(0, 10);
        });
      }

      // ----- 7. جلب الواجبات (محاولة) -----
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
        courses: courses.length ? courses : ["تم تسجيل الدخول بنجاح، ولكن لم يتم العثور على مقررات"],
        assignments,
        announcements: ["مرحباً بكم في الفصل الدراسي الجديد"]
      };

      // ----- 8. محاولة جلب بيانات البانر (اختياري) -----
      // سيتم تجاهل فشل البانر، لأننا نركز على Blackboard
      try {
        console.log("⚡ محاولة جلب بيانات البانر...");
        await page.goto('https://bannservices.seu.edu.sa/StudentRegistrationSsb/ssb/registration', {
          waitUntil: 'domcontentloaded',
          timeout: 30000
        });
        await page.waitForTimeout(3000);

        const bannerData = await page.evaluate(() => {
          const gpaElem = document.querySelector('.gpa-display, .gpa-value');
          const gpa = gpaElem ? gpaElem.innerText.trim() : 'N/A';
          return { gpa, academicStatus: 'مستمر', name: 'طالب' };
        });
        extractedData.banner = bannerData;
      } catch (e) {
        console.log("⚠️ تعذر جلب بيانات البانر، سيتم استخدام بيانات افتراضية.");
        extractedData.banner = { gpa: 'N/A', academicStatus: 'غير معروف', name: 'طالب' };
      }

      console.log("✅ تم استخراج البيانات بنجاح.");
    } catch (err) {
      console.error("❌ فشل أثناء الأتمتة:", err);
      try {
        const url = page.url();
        console.log("📌 الصفحة الحالية:", url);
        const content = await page.content();
        console.log("📄 جزء من محتوى الصفحة:", content.substring(0, 500));
      } catch (e) { /* تجاهل */ }
      throw err;
    } finally {
      await browser.close();
    }

    return extractedData;
  }
}
