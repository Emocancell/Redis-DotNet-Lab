-- Tamamen sentetik çalışanlar: gerçek kişisel veri içermez.
CREATE TABLE employees (
  id integer PRIMARY KEY,
  full_name text NOT NULL,
  department text NOT NULL,
  position text NOT NULL,
  gender text NOT NULL,
  age integer NOT NULL CHECK(age BETWEEN 18 AND 75),
  salary numeric(12,2) NOT NULL CHECK(salary > 0),
  start_date date NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
WITH generated AS (
  SELECT n,
    CASE WHEN n%10=0 THEN (ARRAY['Deniz','Ekin','Özgür','Umut','Doğa','Toprak'])[((n/10)%6)+1] WHEN n%2=0 THEN (ARRAY['Ece','Elif','Selin','Melis','Derya','Ceren','Zeynep','Aylin','Aslı','İrem','Buse','Cansu'])[((n/2)%12)+1] ELSE (ARRAY['Mert','Arda','Ozan','Eren','Can','Kerem','Emre','Burak','Onur','Kaan','Mehmet','Ali'])[((n/2)%12)+1] END AS first_name,
    (ARRAY['Yılmaz','Demir','Kaya','Çelik','Şahin','Yıldız','Aydın','Öztürk','Arslan','Koç','Kurt','Aksoy'])[((n*11)%12)+1] AS last_name,
    (ARRAY['Yazılım','Siber Güvenlik','Network','Veri & AI','İnsan Kaynakları','Finans','Operasyon','Satış'])[((n-1)%8)+1] AS department,
    (ARRAY['Uzman','Kıdemli Uzman','Takım Lideri','Mühendis'])[((n/8)%4)+1] AS position,
    CASE WHEN n%10=0 THEN 'Belirtmek istemiyor' WHEN n%2=0 THEN 'Kadın' ELSE 'Erkek' END AS gender,
    22+((n*17)%39) AS age,
    (n*47)%3650 AS tenure_days
  FROM generate_series(1,10000) AS n
)
INSERT INTO employees(id,full_name,department,position,gender,age,salary,start_date)
SELECT n,first_name||' '||last_name||' '||n,department,position,gender,age,
  (42000+((n*31)%30000)
   + CASE department WHEN 'Veri & AI' THEN 24000 WHEN 'Siber Güvenlik' THEN 19000 WHEN 'Yazılım' THEN 18000 WHEN 'Network' THEN 14000 WHEN 'Finans' THEN 9000 ELSE 3000 END
   + CASE position WHEN 'Takım Lideri' THEN 36000 WHEN 'Kıdemli Uzman' THEN 21000 WHEN 'Mühendis' THEN 10000 ELSE 0 END)::numeric(12,2),
  CURRENT_DATE - tenure_days
FROM generated;
CREATE INDEX idx_emp_department ON employees(department);
CREATE INDEX idx_emp_gender ON employees(gender);
CREATE INDEX idx_emp_salary ON employees(salary);
