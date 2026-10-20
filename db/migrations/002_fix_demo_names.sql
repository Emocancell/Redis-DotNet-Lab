-- Yalnızca sentetik demo kişileri; gerçek kişilerin cinsiyeti isminden çıkarılamaz.
-- İlk çalıştırmadan önceki adlar için geri dönüş tablosu oluşturur.
BEGIN;
CREATE TABLE IF NOT EXISTS hrlab_names_before_v2 AS
SELECT id, full_name, gender FROM employees;
WITH generated AS (
  SELECT id,
    CASE WHEN id%10=0 THEN (ARRAY['Deniz','Ekin','Özgür','Umut','Doğa','Toprak'])[((id/10)%6)+1] WHEN id%2=0 THEN (ARRAY['Ece','Elif','Selin','Melis','Derya','Ceren','Zeynep','Aylin','Aslı','İrem','Buse','Cansu'])[((id/2)%12)+1] ELSE (ARRAY['Mert','Arda','Ozan','Eren','Can','Kerem','Emre','Burak','Onur','Kaan','Mehmet','Ali'])[((id/2)%12)+1] END AS first_name,
    (ARRAY['Yılmaz','Demir','Kaya','Çelik','Şahin','Yıldız','Aydın','Öztürk','Arslan','Koç','Kurt','Aksoy'])[((id*11)%12)+1] AS last_name
  FROM employees
)
UPDATE employees e
SET full_name = g.first_name || ' ' || g.last_name || ' ' || e.id,
    updated_at = now()
FROM generated g
WHERE g.id = e.id AND e.full_name IS DISTINCT FROM g.first_name || ' ' || g.last_name || ' ' || e.id;
COMMIT;
