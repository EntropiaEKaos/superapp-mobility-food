-- Sprint 10: notify subscribers only after a sandbox write transaction commits.
-- Notifications never contain personal information or record contents.
CREATE OR REPLACE FUNCTION "notify_sandbox_change"()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('superapp_sandbox_changed', 'changed');
  RETURN NULL;
END;
$$;

CREATE TRIGGER "SandboxRide_stream_change"
AFTER INSERT OR UPDATE OR DELETE ON "SandboxRide"
FOR EACH STATEMENT EXECUTE FUNCTION "notify_sandbox_change"();

CREATE TRIGGER "SandboxRideEvent_stream_change"
AFTER INSERT OR DELETE ON "SandboxRideEvent"
FOR EACH STATEMENT EXECUTE FUNCTION "notify_sandbox_change"();

CREATE TRIGGER "SandboxRideOffer_stream_change"
AFTER INSERT OR UPDATE OR DELETE ON "SandboxRideOffer"
FOR EACH STATEMENT EXECUTE FUNCTION "notify_sandbox_change"();

CREATE TRIGGER "SandboxDriver_stream_change"
AFTER INSERT OR UPDATE OR DELETE ON "SandboxDriver"
FOR EACH STATEMENT EXECUTE FUNCTION "notify_sandbox_change"();
