-- Seed: initial admin user (password: Admin1234!)
-- Hash generated with BCrypt workFactor=12. CHANGE before production.
INSERT INTO "Users" ("Id", "Username", "PasswordHash", "FullName", "Role", "IsActive", "CreatedAt")
VALUES (
  gen_random_uuid(),
  'admin',
  '$2a$12$PlaceholderHashChangeThisBeforeFirstRun000000000000000000',
  'מנהל מערכת',
  'Admin',
  true,
  NOW()
)
ON CONFLICT ("Username") DO NOTHING;

-- Note: replace the PasswordHash above with a real BCrypt hash before use.
-- In development you can create the first user via the API or by running AuthService.HashPassword.
