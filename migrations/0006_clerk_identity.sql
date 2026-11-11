-- Grants are bound to an independently verified Clerk issuer/user, not a
-- mutable email address. Existing email-only grants intentionally fail closed.
-- No account import, promotion, or automatic email-based linking occurs.
ALTER TABLE invitations ADD COLUMN accepted_identity_issuer TEXT;
ALTER TABLE invitations ADD COLUMN accepted_identity_subject TEXT;
CREATE INDEX invitations_identity_grants ON invitations(accepted_identity_issuer,accepted_identity_subject,revoked_at,grant_expires_at);
CREATE TRIGGER invitation_identity_immutable BEFORE UPDATE OF accepted_identity_issuer,accepted_identity_subject ON invitations
WHEN OLD.accepted_identity_issuer IS NOT NULL AND (NEW.accepted_identity_issuer IS NOT OLD.accepted_identity_issuer OR NEW.accepted_identity_subject IS NOT OLD.accepted_identity_subject) BEGIN
 SELECT RAISE(ABORT,'Accepted grant identity is immutable');
END;
