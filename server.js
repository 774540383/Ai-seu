import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDB, saveStudentData, getStudentData } from './database.js';
import { SEUAutomation } from './automation.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

initDB().then(() => console.log("💾 قاعدة البيانات جاهزة."));

app.post('/api/sync', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: "جميع الحقول مطلوبة" });
  }

  try {
    const automation = new SEUAutomation(username, password);
    const freshData = await automation.executeSync();
    await saveStudentData(username, freshData);
    res.json({ success: true, message: "✅ تمت المزامنة وحفظ البيانات بنجاح!" });
  } catch (err) {
    res.status(500).json({ error: "فشلت المزامنة: " + err.message });
  }
});

app.post('/api/ask', async (req, res) => {
  const { username, question } = req.body;
  const data = await getStudentData(username);
  if (!data) {
    return res.json({ reply: "لم أجد أي بيانات لك، يرجى المزامنة أولاً." });
  }

  const q = question.toLowerCase();
  let reply = "عذراً، لم أفهم سؤالك. اسأل عن المعدل، الواجبات، المقررات، أو الإعلانات.";

  if (q.includes('معدل') || q.includes('gpa')) {
    reply = `معدلك الأكاديمي الحالي: ${data.gpa}`;
  } else if (q.includes('واجب') || q.includes('المهمات')) {
    const list = data.assignments || [];
    reply = `لديك ${list.length} واجبات: ` + list.map(a => `\n- ${a.title} (${a.dueDate})`).join('');
  } else if (q.includes('مادة') || q.includes('المقررات') || q.includes('جدول')) {
    reply = `المقررات المسجلة: ${data.courses.join('، ')}`;
  } else if (q.includes('إعلان') || q.includes('جديد')) {
    reply = `آخر الإعلانات: ${data.announcements.join('، ')}`;
  }

  res.json({ reply });
});

app.listen(PORT, () => {
  console.log(`🚀 الخادم يعمل على http://localhost:${PORT}`);
});
