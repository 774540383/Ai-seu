import { chromium } from 'playwright';

export class SEUAutomation {
    constructor(username, password) {
        this.username = username;
        this.password = password;
    }

    async executeSync() {
        const browser = await chromium.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        });

        const context = await browser.newContext({
            viewport: { width: 1280, height: 720 },
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        });

        const page = await context.newPage();

        // متغيرات لتخزين البيانات المستخرجة
        let extractedData = {
            banner: { name: null, gpa: null, academicStatus: null },
            blackboard: { courses: [], assignments: [], announcements: [] }
        };

        // متغيرات لالتقاط الـ API Responses
        let bbMemberships = null;
        let bbGrades = null;
        let bbProfile = null;

        try {
            // ============================================================
            // الخطوة 1: إعداد اعتراض الطلبات (باستخدام waitForResponse بدلاً من route)
            // ============================================================
            console.log("⚡ جاري تجهيز مراقبة طلبات Blackboard API...");

            // إنشاء وعود للانتظار حتى اكتمال الطلبات
            const membershipsPromise = page.waitForResponse(
                response => response.url().includes('/learn/api/v1/users/me/memberships') && response.status() === 200,
                { timeout: 30000 }
            );

            const gradesPromise = page.waitForResponse(
                response => response.url().includes('/learn/api/v1/users/me/grades') && response.status() === 200,
                { timeout: 30000 }
            );

            const profilePromise = page.waitForResponse(
                response => response.url().includes('/learn/api/v1/users/me') && !response.url().includes('memberships') && !response.url().includes('grades'),
                { timeout: 30000 }
            );

            // ============================================================
            // الخطوة 2: تسجيل الدخول عبر Blackboard (التوجيه إلى SSO)
            // ============================================================
            console.log("⚡ جاري فتح Blackboard والانتظار للتوجيه إلى SSO...");
            await page.goto('https://lms.seu.edu.sa', { waitUntil: 'domcontentloaded', timeout: 60000 });
            await page.waitForURL(/sso\.seu\.edu\.sa/, { timeout: 60000 });
            console.log("✅ تم التوجيه إلى SSO.");

            await page.waitForSelector('#usernameUserInput, #username, input[name="username"]', { state: 'visible', timeout: 60000 });
            console.log("✅ تم العثور على حقول الدخول.");

            await page.fill('#usernameUserInput', this.username);
            await page.fill('#password', this.password);

            const submitBtn = await page.$('button[type="submit"]');
            if (submitBtn) {
                await submitBtn.click();
            } else {
                await page.press('#password', 'Enter');
            }

            await page.waitForURL(/lms\.seu\.edu\.sa/, { timeout: 60000 });
            console.log("✅ تم العودة إلى Blackboard.");

            // انتظار تحميل الصفحة الرئيسية
            await page.waitForTimeout(5000);

            // ============================================================
            // الخطوة 3: التنقل لتحفيز طلبات API
            // ============================================================
            console.log("⚡ جاري التنقل لتحفيز جلب البيانات...");

            // محاولة النقر على "Courses" لتحفيز طلب المقررات
            try {
                const coursesLink = await page.$('a[js-route="courses"], a:has-text("Courses"), a:has-text("المقررات")');
                if (coursesLink) {
                    await coursesLink.click();
                    console.log("✅ تم النقر على رابط المقررات.");
                    await page.waitForTimeout(3000);
                }
            } catch (e) {
                console.log("⚠️ تعذر النقر على رابط المقررات.");
            }

            // محاولة النقر على "Grades" لتحفيز طلب الدرجات
            try {
                const gradesLink = await page.$('a[js-route="grades"], a:has-text("Grades"), a:has-text("الدرجات")');
                if (gradesLink) {
                    await gradesLink.click();
                    console.log("✅ تم النقر على رابط الدرجات.");
                    await page.waitForTimeout(3000);
                }
            } catch (e) {
                console.log("⚠️ تعذر النقر على رابط الدرجات.");
            }

            // العودة إلى الصفحة الرئيسية
            await page.goto('https://lms.seu.edu.sa', { waitUntil: 'domcontentloaded', timeout: 30000 });
            await page.waitForTimeout(3000);

            // ============================================================
            // الخطوة 4: انتظار اكتمال طلبات API
            // ============================================================
            console.log("⏳ جاري انتظار اكتمال طلبات الـ API...");

            // انتظار جميع الطلبات الثلاثة
            const [membershipsResponse, gradesResponse, profileResponse] = await Promise.all([
                membershipsPromise,
                gradesPromise,
                profilePromise
            ]);

            // استخراج البيانات من الاستجابات
            if (membershipsResponse) {
                bbMemberships = await membershipsResponse.json();
                console.log(`✅ تم جلب المقررات: ${bbMemberships.results?.length || 0} مقرر`);
            }

            if (gradesResponse) {
                bbGrades = await gradesResponse.json();
                console.log(`✅ تم جلب الدرجات: ${bbGrades.results?.length || 0} درجة`);
            }

            if (profileResponse) {
                bbProfile = await profileResponse.json();
                console.log(`✅ تم جلب الملف الشخصي: ${bbProfile.userName || ''}`);
            }

            // ============================================================
            // الخطوة 5: استخراج بيانات Blackboard
            // ============================================================
            console.log("⚡ جاري استخراج بيانات Blackboard...");

            if (bbMemberships && bbMemberships.results) {
                // استخراج أسماء المقررات من memberships
                const courseIds = bbMemberships.results
                    .filter(m => m.role === 'Student' && m.isAvailable !== false)
                    .map(m => m.courseId)
                    .filter(Boolean);

                // محاولة جلب أسماء المقررات (قد نحتاج إلى استدعاء API إضافي)
                // لكننا سنحتفظ بـ courseIds كحل مؤقت
                extractedData.blackboard.courses = courseIds;
                console.log(`✅ تم استخراج ${extractedData.blackboard.courses.length} مقرر.`);
            } else {
                console.log("❌ لم يتم العثور على بيانات المقررات.");
                throw new Error("تعذر جلب قائمة المقررات من Blackboard. تأكد من صحة بيانات الدخول.");
            }

            if (bbGrades && bbGrades.results) {
                extractedData.blackboard.assignments = bbGrades.results.map(g => ({
                    title: g.grade || g.name || 'عنصر دراسي',
                    dueDate: g.dueDate || 'غير محدد',
                    score: g.score || null,
                    possible: g.possible || null
                }));
                console.log(`✅ تم استخراج ${extractedData.blackboard.assignments.length} درجة/واجب.`);
            } else {
                console.log("⚠️ لم يتم العثور على درجات.");
                extractedData.blackboard.assignments = [];
            }

            if (bbProfile) {
                extractedData.banner.name = bbProfile.displayName || bbProfile.userName || 'طالب';
                console.log(`✅ اسم الطالب: ${extractedData.banner.name}`);
            }

            // ============================================================
            // الخطوة 6: محاولة جلب بيانات البانر (HTML Scraping)
            // ============================================================
            try {
                console.log("⚡ محاولة جلب بيانات البانر...");
                const bannerPage = await context.newPage();
                await bannerPage.goto('https://bannservices.seu.edu.sa/StudentSelfService/ssb/studentProfile', {
                    waitUntil: 'domcontentloaded',
                    timeout: 30000
                });
                await bannerPage.waitForTimeout(5000);

                const bannerData = await bannerPage.evaluate(() => {
                    const bodyText = document.body.innerText;
                    const gpaMatch = bodyText.match(/GPA:\s*([\d.]+)/i) || bodyText.match(/معدل:\s*([\d.]+)/i);
                    const gpa = gpaMatch ? gpaMatch[1] : null;
                    const nameMatch = bodyText.match(/Name:\s*([^\n]+)/i) || bodyText.match(/الاسم:\s*([^\n]+)/i);
                    const name = nameMatch ? nameMatch[1].trim() : null;
                    return { gpa, name };
                });

                if (bannerData.gpa) {
                    extractedData.banner.gpa = bannerData.gpa;
                    console.log(`✅ تم جلب المعدل من البانر: ${bannerData.gpa}`);
                }
                if (bannerData.name) {
                    extractedData.banner.name = bannerData.name;
                }
                await bannerPage.close();
            } catch (e) {
                console.log("⚠️ تعذر جلب بيانات البانر:", e.message);
            }

            // ============================================================
            // الخطوة 7: التحقق النهائي
            // ============================================================
            if (extractedData.blackboard.courses.length === 0) {
                throw new Error("❌ فشل في جلب المقررات من Blackboard. تأكد من صحة بيانات الدخول وأن لديك مقررات مسجلة.");
            }

            console.log("✅ تم استخراج جميع البيانات بنجاح.");
            return extractedData;

        } catch (err) {
            console.error("❌ فشل أثناء الأتمتة:", err.message);
            throw new Error(`فشلت المزامنة: ${err.message}`);
        } finally {
            // إلغاء جميع الطلبات المعلقة لتجنب TargetClosedError
            try {
                await page.unrouteAll({ behavior: 'ignoreErrors' });
            } catch (e) { /* تجاهل */ }
            await browser.close();
        }
    }
}
