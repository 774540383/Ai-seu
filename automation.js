import { chromium } from 'playwright';

export class SEUAutomation {
    constructor(username, password) {
        this.username = username;
        this.password = password;
    }

    async executeSync() {
        // 1. تشغيل المتصفح
        const browser = await chromium.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        });

        const context = await browser.newContext({
            viewport: { width: 1280, height: 720 },
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        });

        const page = await context.newPage();

        // هيكل تخزين البيانات
        let extractedData = {
            banner: { name: null, gpa: null, academicStatus: null, studentId: null, college: null, major: null },
            blackboard: { courses: [], assignments: [], announcements: [] }
        };

        // متغيرات لالتقاط الـ API Responses
        let bbCourses = null;
        let bbGrades = null;
        let bbProfile = null;

        try {
            // ============================================================
            // الخطوة 1: اعتراض طلبات Blackboard REST API
            // ============================================================
            console.log("⚡ جاري تجهيز مراقبة طلبات Blackboard API...");

            // 1.1 اعتراض /learn/api/v1/users/me/memberships (المقررات المسجلة)
            await page.route('**/learn/api/v1/users/me/memberships**', async route => {
                const response = await route.fetch();
                const body = await response.json();
                bbCourses = body;
                console.log(`✅ تم اعتراض المقررات: ${body.results?.length || 0} مقرر`);
                await route.continue();
            });

            // 1.2 اعتراض /learn/api/v1/users/me/grades (الدرجات والواجبات)
            await page.route('**/learn/api/v1/users/me/grades**', async route => {
                const response = await route.fetch();
                const body = await response.json();
                bbGrades = body;
                console.log(`✅ تم اعتراض الدرجات: ${body.results?.length || 0} درجة`);
                await route.continue();
            });

            // 1.3 اعتراض /learn/api/v1/users/me (الملف الشخصي)
            await page.route('**/learn/api/v1/users/me**', async route => {
                const response = await route.fetch();
                const body = await response.json();
                bbProfile = body;
                console.log(`✅ تم اعتراض الملف الشخصي: ${body.userName || ''}`);
                await route.continue();
            });

            // ============================================================
            // الخطوة 2: تسجيل الدخول عبر Blackboard (التوجيه إلى SSO)
            // ============================================================
            console.log("⚡ جاري فتح Blackboard والانتظار للتوجيه إلى SSO...");
            await page.goto('https://lms.seu.edu.sa', { waitUntil: 'domcontentloaded', timeout: 60000 });
            await page.waitForURL(/sso\.seu\.edu\.sa/, { timeout: 60000 });
            console.log("✅ تم التوجيه إلى SSO.");

            // انتظار ظهور حقول الدخول
            await page.waitForSelector('#usernameUserInput, #username, input[name="username"]', { state: 'visible', timeout: 60000 });
            console.log("✅ تم العثور على حقول الدخول.");

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

            // انتظار العودة إلى Blackboard
            await page.waitForURL(/lms\.seu\.edu\.sa/, { timeout: 60000 });
            console.log("✅ تم العودة إلى Blackboard.");

            // ============================================================
            // الخطوة 3: تحفيز طلبات Blackboard API بالتنقل في الصفحة
            // ============================================================
            console.log("⚡ جاري التنقل لتحفيز جلب البيانات...");
            
            // انتظار تحميل الصفحة الرئيسية
            await page.waitForTimeout(3000);

            // محاولة النقر على "Courses" لتحفيز طلب المقررات
            try {
                const coursesLink = await page.$('a[js-route="courses"], a:has-text("Courses"), a:has-text("المقررات")');
                if (coursesLink) {
                    await coursesLink.click();
                    console.log("✅ تم النقر على رابط المقررات.");
                    await page.waitForTimeout(5000);
                }
            } catch (e) {
                console.log("⚠️ تعذر النقر على رابط المقررات، قد تكون البيانات محملة بالفعل.");
            }

            // محاولة النقر على "Grades" لتحفيز طلب الدرجات
            try {
                const gradesLink = await page.$('a[js-route="grades"], a:has-text("Grades"), a:has-text("الدرجات")');
                if (gradesLink) {
                    await gradesLink.click();
                    console.log("✅ تم النقر على رابط الدرجات.");
                    await page.waitForTimeout(5000);
                }
            } catch (e) {
                console.log("⚠️ تعذر النقر على رابط الدرجات.");
            }

            // العودة إلى الصفحة الرئيسية
            await page.goto('https://lms.seu.edu.sa', { waitUntil: 'domcontentloaded', timeout: 30000 });
            await page.waitForTimeout(3000);

            // ============================================================
            // الخطوة 4: استخراج بيانات Blackboard من Responses المعترضة
            // ============================================================
            console.log("⚡ جاري استخراج بيانات Blackboard...");

            // 4.1 استخراج المقررات من memberships
            if (bbCourses && bbCourses.results) {
                const courseIds = bbCourses.results
                    .filter(m => m.role === 'Student' && m.isAvailable !== false)
                    .map(m => m.courseId);

                // جلب أسماء المقررات عبر /learn/api/v1/courses (إن أمكن)
                // ولكننا سنعتمد على الـ memberships فقط
                extractedData.blackboard.courses = courseIds.filter(Boolean);
                console.log(`✅ تم استخراج ${extractedData.blackboard.courses.length} مقرر من الـ API.`);
            } else {
                console.log("❌ لم يتم العثور على بيانات المقررات.");
                throw new Error("تعذر جلب قائمة المقررات من Blackboard. تأكد من صحة بيانات الدخول.");
            }

            // 4.2 استخراج الدرجات والواجبات
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

            // 4.3 استخراج الملف الشخصي
            if (bbProfile) {
                extractedData.banner.name = bbProfile.displayName || bbProfile.userName || 'طالب';
                console.log(`✅ اسم الطالب: ${extractedData.banner.name}`);
            }

            // ============================================================
            // الخطوة 5: جلب بيانات البانر (HTML Scraping)
            // ============================================================
            console.log("⚡ جاري محاولة جلب بيانات البانر عبر HTML Scraping...");

            try {
                // إنشاء صفحة جديدة في نفس السياق (للاستفادة من جلسة SSO)
                const bannerPage = await context.newPage();

                // 5.1 جلب الملف الشخصي من Banner SSB
                await bannerPage.goto('https://bannservices.seu.edu.sa/StudentSelfService/ssb/studentProfile', {
                    waitUntil: 'domcontentloaded',
                    timeout: 30000
                });
                await bannerPage.waitForTimeout(5000);

                const bannerProfile = await bannerPage.evaluate(() => {
                    // استخراج البيانات من HTML باستخدام تعابير Regex أو DOM
                    const bodyText = document.body.innerText;

                    // محاولة استخراج GPA
                    const gpaMatch = bodyText.match(/GPA:\s*([\d.]+)/i) || bodyText.match(/معدل:\s*([\d.]+)/i);
                    const gpa = gpaMatch ? gpaMatch[1] : null;

                    // محاولة استخراج الاسم
                    const nameMatch = bodyText.match(/Name:\s*([^\n]+)/i) || bodyText.match(/الاسم:\s*([^\n]+)/i);
                    const name = nameMatch ? nameMatch[1].trim() : null;

                    // محاولة استخراج الكلية والتخصص
                    const collegeMatch = bodyText.match(/College:\s*([^\n]+)/i) || bodyText.match(/الكلية:\s*([^\n]+)/i);
                    const majorMatch = bodyText.match(/Major:\s*([^\n]+)/i) || bodyText.match(/التخصص:\s*([^\n]+)/i);

                    return {
                        gpa,
                        name,
                        college: collegeMatch ? collegeMatch[1].trim() : null,
                        major: majorMatch ? majorMatch[1].trim() : null
                    };
                });

                if (bannerProfile.gpa) {
                    extractedData.banner.gpa = bannerProfile.gpa;
                    console.log(`✅ تم جلب المعدل من البانر: ${bannerProfile.gpa}`);
                }

                if (bannerProfile.name) {
                    extractedData.banner.name = bannerProfile.name;
                }

                if (bannerProfile.college) {
                    extractedData.banner.college = bannerProfile.college;
                }

                if (bannerProfile.major) {
                    extractedData.banner.major = bannerProfile.major;
                }

                await bannerPage.close();

            } catch (e) {
                console.log("⚠️ تعذر جلب بيانات البانر عبر HTML Scraping:", e.message);
                // نترك البيانات الافتراضية
            }

            // ============================================================
            // الخطوة 6: التحقق النهائي من صحة البيانات
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
            await browser.close();
        }
    }
}
