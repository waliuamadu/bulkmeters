-- Lock both asset and location to prevent overlapping historic installations.
CREATE FUNCTION check_installation_period() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM meters WHERE id=NEW.meter_id FOR UPDATE;
  PERFORM 1 FROM installation_points WHERE id=NEW.point_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM meter_installations i WHERE i.id<>NEW.id
    AND (i.meter_id=NEW.meter_id OR i.point_id=NEW.point_id)
    AND tstzrange(i.installed_at,i.removed_at,'[)') && tstzrange(NEW.installed_at,NEW.removed_at,'[)')) THEN
    RAISE EXCEPTION 'Installation period overlaps another meter or location' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER no_installation_overlap BEFORE INSERT OR UPDATE ON meter_installations FOR EACH ROW EXECUTE FUNCTION check_installation_period();
ALTER TABLE meters ADD COLUMN max_volume_jump numeric CHECK(max_volume_jump>0);
ALTER TABLE email_sources ADD COLUMN require_authentication boolean NOT NULL DEFAULT true;
CREATE UNIQUE INDEX notification_event ON notifications(meter_id,kind);
CREATE TABLE reading_corrections(id uuid PRIMARY KEY,reading_id uuid NOT NULL REFERENCES meter_readings,user_id uuid NOT NULL REFERENCES users,reason text NOT NULL,previous_value jsonb NOT NULL,new_value jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
INSERT INTO system_settings(name,value) VALUES ('ingestion','{"poll_minutes":5,"discovery_days":30,"enabled":false}'::jsonb);
