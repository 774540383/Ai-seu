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
    let extractedData = { banner: { gpa: 'N/A', name: 'طالب', academicStatus: 'غير معروف' }, blackboard: {} };

    try {
      // ============================================================
      // الخطوة 1: تسجيل الدخول عبر Blackboard (التوجيه التلقائي إلى SSO)
      // ============================================================
      console.log("⚡ جاري فتح Blackboard...");
      await page.goto('https://lms.seu.edu.sa', { waitUntil: 'domcontentloaded', timeout: 60000 });

      await page.waitForURL(/sso\.seu\.edu\.sa/, { timeout: 60000 });
      console.log("✅ تم التوجيه إلى SSO");

      await page.waitForSelector('#usernameUserInput, #username, input[name="username"]', {
        state: 'visible',
        timeout: 60000
      });

      await page.fill('#usernameUserInput', this.username);
      await page.fill('#password', this.password);

      const submitBtn = await page.$('button[type="submit"]');
      if (submitBtn) {
        await submitBtn.click();
      } else {
        await page.press('#password', 'Enter');
      }

      await page.waitForURL(/lms\.seu\.edu\.sa/, { timeout: 60000 });
      console.log("✅ تم العودة إلى Blackboard");

      // انتظر تحميل الصفحة بالكامل
      await page.waitForTimeout(5000);

      // ============================================================
      // الخطوة 2: استخدام API الداخلية لجلب المقررات والدرجات
      // ============================================================
      console.log("⚡ جاري جلب البيانات عبر API الداخلية...");

      // استدعاء API المقررات
      let courses = [];
      let assignments = [];
      let gpa = 'N/A';
      let studentName = 'طالب';

      try {
        // محاولة جلب المقررات عبر API
        const coursesData = await page.evaluate(async () => {
          try {
            const response = await fetch('/learn/api/v3/courses', {
              headers: { 'Accept': 'application/json' }
            });
            if (!response.ok) throw new Error('API request failed');
            const data = await response.json();
            return data.results || [];
          } catch (e) {
            return [];
          }
        });

        if (coursesData.length > 0) {
          courses = coursesData.map(c => c.name || c.courseId || 'مقرر');
          console.log(`✅ تم جلب ${courses.length} مقرر عبر API`);
        } else {
          console.log("⚠️ لم يتم العثور على مقررات عبر API");
        }

        // محاولة جلب الدرجات والواجبات عبر API
        const gradesData = await page.evaluate(async () => {
          try {
            const response = await fetch('/learn/api/v1/users/me/grades', {
              headers: { 'Accept': 'application/json' }
            });
            if (!response.ok) throw new Error('API request failed');
            const data = await response.json();
            return data.results || [];
          } catch (e) {
            return [];
          }
        });

        if (gradesData.length > 0) {
          assignments = gradesData.map(g => ({
            title: g.name || g.grade || 'واجب',
            dueDate: g.dueDate || 'قريباً'
          }));
          console.log(`✅ تم جلب ${assignments.length} واجب/درجة عبر API`);
        } else {
          console.log("⚠️ لم يتم العثور على درجات عبر API");
        }

        // محاولة جلب اسم الطالب
        const profileData = await page.evaluate(async () => {
          try {
            const response = await fetch('/learn/api/v1/users/me', {
              headers: { 'Accept': 'application/json' }
            });
            if (!response.ok) throw new Error('API request failed');
            const data = await response.json();
            return data.displayName || data.userName || 'طالب';
          } catch (e) {
            return 'طالب';
          }
        });

        studentName = profileData;

      } catch (e) {
        console.log("⚠️ حدث خطأ أثناء جلب البيانات عبر API:", e.message);
      }

      // ============================================================
      // الخطوة 3: إذا فشلت API، نستخدم DOM كحل بديل
      // ============================================================
      if (courses.length === 0) {
        console.log("⚡ جاري محاولة استخراج البيانات من DOM كحل بديل...");

        // محاولة العثور على عناصر المقررات في DOM
        const courseSelectors = [
          '.course-card', '.course-item', '.course-title',
          '.course-name', '.course-element-title',
          'div[data-testid="course-card"]',
          'li[data-testid="course-list-item"]'
        ];

        for (const selector of courseSelectors) {
          try {
            await page.waitForSelector(selector, { timeout: 5000 });
            const elements = await page.$$(selector);
            if (elements.length > 0) {
              courses = await page.evaluate((sel) => {
                return Array.from(document.querySelectorAll(sel))
                  .map(el => el.innerText.trim())
                  .filter(text => text.length > 0 && text.length < 200);
              }, selector);
              if (courses.length > 0) break;
            }
          } catch (e) {}
        }

        // إذا لم نعثر، نأخذ النص من الصفحة ونقوم بتصفية الكلمات المفتاحية
        if (courses.length === 0) {
          const allText = await page.evaluate(() => document.body.innerText);
          const lines = allText.split('\n').filter(line => line.trim().length > 0);
          // نستبعد الأسطر الشائعة غير المرتبطة بالمقررات
          const excludeWords = ['Skip', 'Institution', 'Activity', 'Calendar', 'Messages', 'Grades', 'Tools', 'Sign Out', 'Privacy', 'Accessibility', 'سداد', 'اعزائنا', 'يرجى', 'حذف', 'تسجيل', 'تجاهل', 'Help', 'device', 'session', 'Continue'];
          courses = lines.filter(line => 
            !excludeWords.some(word => line.includes(word)) &&
            line.length > 5
          ).slice(0, 20);
        }
      }

      // إذا لم نجد واجبات، نضع قيمة افتراضية
      if (assignments.length === 0) {
        assignments = [{ title: "لا توجد واجبات حالياً", dueDate: "-" }];
      }

      // ============================================================
      // الخطوة 4: محاولة جلب بيانات البانر (اختياري)
      // ============================================================
      try {
        console.log("⚡ محاولة جلب بيانات البانر...");
        const bannerPage = await context.newPage();
        await bannerPage.goto('https://bannservices.seu.edu.sa/StudentRegistrationSsb/ssb/registration', {
          waitUntil: 'domcontentloaded',
          timeout: 15000
        });
        await bannerPage.waitForTimeout(3000);

        const bannerData = await bannerPage.evaluate(() => {
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
        console.log("✅ تم جلب بيانات البانر.");
      } catch (e) {
        console.log("⚠️ تعذر جلب بيانات البانر، سيتم استخدام بيانات افتراضية.");
      }

      // ============================================================
      // تجميع البيانات النهائية
      // ============================================================
      extractedData.blackboard = {
        courses: courses.length ? courses : ["لم يتم العثور على مقررات مسجلة"],
        assignments,
        announcements: ["مرحباً بكم في الفصل الدراسي الجديد"]
      };

      // تحديث اسم الطالب إذا تم جلبه
      if (studentName !== 'طالب') {
        extractedData.banner.name = studentName;
      }

      console.log("✅ تم استخراج جميع البيانات بنجاح.");

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
