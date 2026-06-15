-- Run this ONCE after first migration to create the initial admin user
-- Password: Admin1234!  (change immediately after first login)

INSERT INTO "Users" ("Id", "Username", "PasswordHash", "FullName", "Role", "IsActive", "CreatedAt")
VALUES (
  gen_random_uuid(),
  'admin',
  '$2a$12$vbFTdmtgPpCe6KYXfhEV4uXVl49KCs1aI3MR7Dlh53a3/lsqtxtzS',
  'מנהל מערכת',
  'Admin',
  true,
  NOW()
)
ON CONFLICT ("Username") DO NOTHING;
