-- Idempotent: makes INSERT without an explicit ID possible on both old and new DB volumes.
-- Keeps ALL existing employees, salaries, departments and employee IDs unchanged.
BEGIN;
CREATE SEQUENCE IF NOT EXISTS employees_id_seq;
ALTER SEQUENCE employees_id_seq OWNED BY employees.id;
SELECT setval(
  'employees_id_seq',
  GREATEST((SELECT COALESCE(MAX(id), 0) FROM employees), (SELECT last_value FROM employees_id_seq)),
  true
);
ALTER TABLE employees ALTER COLUMN id SET DEFAULT nextval('employees_id_seq');
COMMIT;
