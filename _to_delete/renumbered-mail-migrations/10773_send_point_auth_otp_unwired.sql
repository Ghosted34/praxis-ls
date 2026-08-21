-- §3.5 — `auth.otp` claims a sender that does not exist.
--
-- 10726 seeded nine rows with `is_wired = true`, above a comment reading "the
-- eight true rows below were read off the code, not guessed", and naming
-- src/modules/security/app_user/app_user.service.js as auth.otp's caller.
--
-- There is no emailed one-time code anywhere in the product. Two-factor sign-in
-- is TOTP through an authenticator app (`authenticator.keyuri`, 0300-era), and
-- every other "one-time" in that module is a one-time *link* — the password
-- reset, which is its own send point and is now wired. So this row offered an
-- administrator a binding for mail that is never sent.
--
-- Flipped rather than deleted. The row is still the right place to hang the
-- binding on the day an emailed code exists, and deleting it would silently
-- drop any binding a tenant has already made against it; `is_wired = false`
-- makes the console show it as not-yet-sending, which is the true statement.
UPDATE mail_send_point
   SET is_wired = false,
       description_en = 'No emailed code is sent today — two-factor sign-in uses an authenticator app. Reserved for when one exists.',
       description_fr = 'Aucun code n''est envoyé par courriel aujourd''hui — la double authentification utilise une application. Réservé pour plus tard.'
 WHERE send_point_key = 'auth.otp';
-- DOWN
--   UPDATE mail_send_point SET is_wired = true WHERE send_point_key = 'auth.otp';
