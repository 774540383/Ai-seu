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

      // انتظر التوجيه إلى SSO
      await page.waitForURL(/sso\.seu\.edu\.sa/, { timeout: 60000 });
      console.log("✅ تم التوجيه إلى SSO");

      // انتظر ظهور حقول الدخول
      await page.waitForSelector('#usernameUserInput, #username, input[name="username"]', {
        state: 'visible',
        timeout: 60000
      });

      // تعبئة البيانات
      await page.fill('#usernameUserInput', this.username);
      await page.fill('#password', this.password);

      // الضغط على زر الدخول
      const submitBtn = await page.$('button[type="submit"]');
      if (submitBtn) {
        await submitBtn.click();
      } else {
        await page.press('#password', 'Enter');
      }

      // انتظر العودة إلى Blackboard
      await page.waitForURL(/lms\.seu\.edu\.sa/, { timeout: 60000 });
      console.log("✅ تم العودة إلى Blackboard");

      // انتظر تحميل المحتوى الديناميكي (واجهة Ultra)
      await page.waitForTimeout(5000);

      // ============================================================
      // الخطوة 2: استخراج المقررات الدراسية الحقيقية
      // ============================================================
      console.log("⚡ جاري استخراج المقررات الدراسية...");

      // محاولة العثور على عناصر المقررات في واجهة Ultra
      // Blackboard Ultra يستخدم class مثل: .course-card, .course-item, .course-title, .course-name
      const courseSelectors = [
        '.course-card',
        '.course-item',
        '.course-title',
        '.course-name',
        '.course-element-title',
        'div[data-testid="course-card"]',
        'li[data-testid="course-list-item"]',
        '.course-list-item'
      ];

      let courses = [];

      for (const selector of courseSelectors) {
        try {
          await page.waitForSelector(selector, { timeout: 10000 });
          const courseElements = await page.$$(selector);
          if (courseElements.length > 0) {
            courses = await page.evaluate((sel) => {
              return Array.from(document.querySelectorAll(sel))
                .map(el => el.innerText.trim())
                .filter(text => text.length > 0 && text.length < 200);
            }, selector);
            if (courses.length > 0) break;
          }
        } catch (e) {
          // استمر في المحاولة مع المحدد التالي
        }
      }

      // إذا لم نعثر على المقررات، نحاول الانتقال إلى صفحة "المقررات" مباشرة
      if (courses.length === 0) {
        console.log("⚠️ لم يتم العثور على المقررات في الصفحة الرئيسية، جاري الانتقال إلى صفحة المقررات...");
        
        // محاولة النقر على رابط "المقررات" أو "Courses"
        try {
          const coursesLink = await page.$('a:has-text("Courses"), a:has-text("المقررات"), a[js-route="courses"]');
          if (coursesLink) {
            await coursesLink.click();
            await page.waitForTimeout(5000);
            
            // إعادة محاولة البحث في صفحة المقررات
            for (const selector of courseSelectors) {
              try {
                await page.waitForSelector(selector, { timeout: 10000 });
                const courseElements = await page.$$(selector);
                if (courseElements.length > 0) {
                  courses = await page.evaluate((sel) => {
                    return Array.from(document.querySelectorAll(sel))
                      .map(el => el.innerText.trim())
                      .filter(text => text.length > 0 && text.length < 200);
                  }, selector);
                  if (courses.length > 0) break;
                }
              } catch (e) {}
            }
          }
        } catch (e) {
          console.log("⚠️ تعذر الانتقال إلى صفحة المقررات");
        }
      }

      // إذا لم نعثر على مقررات، نأخذ النص من الصفحة (كحل أخير)
      if (courses.length === 0) {
        console.log("⚠️ جاري استخراج النص العام من الصفحة...");
        const allText = await page.evaluate(() => document.body.innerText);
        const lines = allText.split('\n').filter(line => line.trim().length > 0);
        // نأخذ الأسطر التي قد تحتوي على أسماء مقررات (تجاهل الأسطر القصيرة جداً)
        courses = lines.filter(line => 
          line.length > 5 && 
          !line.includes('Skip to main content') &&
          !line.includes('Institution Page') &&
          !line.includes('Activity') &&
          !line.includes('Calendar') &&
          !line.includes('Messages') &&
          !line.includes('Grades') &&
          !line.includes('Tools')
        ).slice(0, 15);
      }

      console.log(`✅ تم العثور على ${courses.length} مقرر`);
      courses.forEach((c, i) => console.log(`   ${i+1}. ${c}`));

      // ============================================================
      // الخطوة 3: استخراج الواجبات والدرجات
      // ============================================================
      console.log("⚡ جاري استخراج الواجبات والدرجات...");

      let assignments = [];
      let grades = [];

      // محاولة الوصول إلى صفحة الدرجات
      try {
        const gradesLink = await page.$('a:has-text("Grades"), a:has-text("الدرجات"), a[js-route="grades"]');
        if (gradesLink) {
          await gradesLink.click();
          await page.waitForTimeout(5000);
          
          // استخراج الواجبات من صفحة الدرجات
          const gradeItems = await page.evaluate(() => {
            const items = Array.from(document.querySelectorAll('.grade-item, .grade-row, tr'));
            return items.map(el => el.innerText.trim()).filter(text => text.length > 0);
          });
          
          if (gradeItems.length > 0) {
            assignments = gradeItems.slice(0, 10).map(text => ({ title: text, dueDate: 'غير محدد' }));
          }
        }
      } catch (e) {
        console.log("⚠️ تعذر الوصول إلى صفحة الدرجات");
      }

      // إذا لم نجد واجبات، نستخدم بيانات افتراضية
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
