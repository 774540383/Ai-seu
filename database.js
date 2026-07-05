import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://user:pass@localhost:5432/seu_local_db'
});

export const initDB = async () => {
  const query = `
    CREATE TABLE IF NOT EXISTS student_data (
      id SERIAL PRIMARY KEY,
      username VARCHAR(50) UNIQUE NOT NULL,
      full_name VARCHAR(100),
      gpa VARCHAR(10),
      academic_status VARCHAR(50),
      courses JSONB,
      assignments JSONB,
      announcements JSONB,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;
  await pool.query(query);
};

export const saveStudentData = async (username, data) => {
  const query = `
    INSERT INTO student_data (username, full_name, gpa, academic_status, courses, assignments, announcements, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
    ON CONFLICT (username) 
    DO UPDATE SET 
      full_name = EXCLUDED.full_name,
      gpa = EXCLUDED.gpa,
      academic_status = EXCLUDED.academic_status,
      courses = EXCLUDED.courses,
      assignments = EXCLUDED.assignments,
      announcements = EXCLUDED.announcements,
      updated_at = NOW();
  `;
  const values = [
    username,
    data.banner.name || 'طالب',
    data.banner.gpa || 'N/A',
    data.banner.academicStatus || 'N/A',
    JSON.stringify(data.blackboard.courses || []),
    JSON.stringify(data.blackboard.assignments || []),
    JSON.stringify(data.blackboard.announcements || [])
  ];
  await pool.query(query, values);
};

export const getStudentData = async (username) => {
  const res = await pool.query("SELECT * FROM student_data WHERE username = $1", [username]);
  return res.rows[0];
};
