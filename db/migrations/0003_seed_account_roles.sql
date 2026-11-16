INSERT INTO roles (id, name) VALUES
  ('student', 'Student'), ('teacher', 'Teacher'), ('admin', 'Admin')
ON CONFLICT (id) DO NOTHING;
