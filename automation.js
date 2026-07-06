import { chromium } from 'playwright';

export class SEUAutomation {
    constructor(username, password) {
        this.username = username;
        this.password = password;
    }

    async executeSync() {
        // 1. تشغيل متصفح حقيقي (بدون واجهة) مع إعدادات تمنع اكتشافه كبوت
        const browser = await chromium.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-blink-features=AutomationControlled'
            ]
        });

        // 2. إنشاء سياق متصفح يحاكي مستخدمًا حقيقيًا
        const context = await browser.newContext({
            viewport: { width: 1280, height: 720 },
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        });

        const page = await context.newPage();
        
        // هيكل لتخزين البيانات المستخرجة من الـ APIs
        let extractedData = {
            banner: { name: null, gpa: null, academicStatus: null },
            blackboard: { courses: [], assignments: [], announcements: [] }
        };

        // متغيرات لتخزين الـ API Responses
        let blackboardCoursesResponse = null;
        let blackboardGradesResponse = null;
        let blackboardUserResponse = null;

        try {
            // ============================================================
            // الخطوة 1: مراقبة طلبات الـ API ( interception )
            // ============================================================
            console.log("⚡ جاري تجهيز مراقبة طلبات الـ API...");
            await page.route('**/learn/api/v3/courses**', async route => {
                const response = await route.fetch();
                const body = await response.json();
                blackboardCoursesResponse = body;
                console.log(`✅ تم اعتراض طلب المقررات: ${body.results?.length || 0} مقرر`);
                await route.continue();
            });

            await page.route('**/learn/api/v1/users/me/grades**', async route => {
                const response = await route.fetch();
                const body = await response.json();
                blackboardGradesResponse = body;
                console.log(`✅ تم اعتراض طلب الدرجات: ${body.results?.length || 0} درجة`);
                await route.continue();
            });

            await page.route('**/learn/api/v1/users/me**', async route => {
                const response = await route.fetch();
                const body = await response.json();
                blackboardUserResponse = body;
                console.log(`✅ تم اعتراض طلب الملف الشخصي: ${body.userName || ''}`);
                await route.continue();
            });

            // ============================================================
            // الخطوة 2: تسجيل الدخول عبر Blackboard (التوجيه التلقائي إلى SSO)
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
            // الخطوة 3: التنقل داخل Blackboard لتحفيز طلبات الـ API
            // ============================================================
            // الانتظار حتى يتم تحميل الصفحة الرئيسية
            await page.waitForTimeout(5000);

            // محاولة النقر على رابط "المقررات" لتحفيز طلب API جلب المقررات
            console.log("⚡ جاري التنقل إلى صفحة المقررات لتحفيز جلب البيانات...");
            try {
                const coursesLink = await page.$('a[js-route="courses"], a:has-text("Courses"), a:has-text("المقررات")');
                if (coursesLink) {
                    await coursesLink.click();
                    console.log("✅ تم النقر على رابط المقررات.");
                    await page.waitForTimeout(5000);
                } else {
                    console.log("⚠️ لم يتم العثور على رابط المقررات، قد تكون البيانات محملة بالفعل.");
                }
            } catch (e) {
                console.log("⚠️ تعذر النقر على رابط المقررات، سننتظر تحميل البيانات تلقائياً.");
            }

            // الانتظار قليلاً للتأكد من وصول جميع طلبات API
            await page.waitForTimeout(5000);

            // ============================================================
            // الخطوة 4: استخراج البيانات من Responses التي تم اعتراضها
            // ============================================================
            console.log("⚡ جاري استخراج البيانات من الـ API...");

            // 4.1 استخراج بيانات Blackboard
            if (blackboardCoursesResponse && blackboardCoursesResponse.results) {
                extractedData.blackboard.courses = blackboardCoursesResponse.results.map(c => c.name || c.courseId).filter(Boolean);
                console.log(`✅ تم استخراج ${extractedData.blackboard.courses.length} مقرر من الـ API.`);
            } else {
                console.log("❌ فشل في استخراج المقررات من الـ API.");
                throw new Error("تعذر جلب قائمة المقررات من Blackboard عبر الـ API.");
            }

            if (blackboardGradesResponse && blackboardGradesResponse.results) {
                extractedData.blackboard.assignments = blackboardGradesResponse.results.map(g => ({
                    title: g.name || g.grade || 'عنصر دراسي',
                    dueDate: g.dueDate || 'غير محدد'
                }));
                console.log(`✅ تم استخراج ${extractedData.blackboard.assignments.length} واجب/درجة من الـ API.`);
            } else {
                console.log("⚠️ لم يتم العثور على درجات عبر الـ API، سيتم استخدام قائمة فارغة.");
                extractedData.blackboard.assignments = [];
            }

            if (blackboardUserResponse) {
                extractedData.banner.name = blackboardUserResponse.displayName || blackboardUserResponse.userName || 'طالب';
                console.log(`✅ تم استخراج اسم الطالب: ${extractedData.banner.name}`);
            }

            // ============================================================
            // الخطوة 5: محاولة جلب بيانات البانر (بشكل منفصل)
            // ============================================================
            console.log("⚡ محاولة جلب بيانات البانر...");
            try {
                // إنشاء صفحة جديدة في نفس السياق (للاستفادة من جلسة SSO)
                const bannerPage = await context.newPage();
                await bannerPage.goto('https://bannservices.seu.edu.sa/StudentRegistrationSsb/ssb/registration', {
                    waitUntil: 'domcontentloaded',
                    timeout: 30000
                });
                await bannerPage.waitForTimeout(5000);

                const bannerData = await bannerPage.evaluate(() => {
                    const gpaElem = document.querySelector('.gpa-display, .gpa-value, .grade-point-average');
                    const gpa = gpaElem ? gpaElem.innerText.trim() : null;
                    const nameElem = document.querySelector('.user-name, .student-name');
                    return {
                        gpa: gpa,
                        academicStatus: 'مستمر',
                        name: nameElem?.innerText?.trim() || null
                    };
                });

                if (bannerData.gpa) {
                    extractedData.banner.gpa = bannerData.gpa;
                    console.log(`✅ تم جلب المعدل من البانر: ${bannerData.gpa}`);
                } else {
                    console.log("⚠️ لم يتم العثور على المعدل في البانر.");
                }

                if (bannerData.name) {
                    extractedData.banner.name = bannerData.name;
                }

                await bannerPage.close();
            } catch (e) {
                console.log("⚠️ تعذر جلب بيانات البانر. هذا قد يكون بسبب عدم توفر الصفحة أو الحاجة إلى صلاحيات إضافية.");
                // لا نرمي خطأ هنا لأن البانر ليس الهدف الأساسي
            }

            // ============================================================
            // الخطوة 6: التحقق من صحة البيانات ورفع الأخطاء إن لزم
            // ============================================================
            if (extractedData.blackboard.courses.length === 0) {
                throw new Error("❌ فشل في جلب المقررات من Blackboard. تأكد من صحة بيانات الدخول وأن لديك مقررات مسجلة.");
            }

            console.log("✅ تم استخراج جميع البيانات بنجاح.");
            return extractedData;

        } catch (err) {
            console.error("❌ فشل أثناء الأتمتة:", err.message);
            // إغلاق المتصفح فور حدوث الخطأ
            await browser.close();
            // إعادة إرسال الخطأ إلى الـ Server ليظهر للمستخدم
            throw new Error(`فشلت المزامنة: ${err.message}`);
        } finally {
            // التأكد من إغلاق المتصفح في جميع الأحوال
            await browser.close();
        }
    }
}
