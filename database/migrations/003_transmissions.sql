CREATE TABLE meter_transmissions(meter_id text REFERENCES meters,message_id text REFERENCES email_messages,received_at timestamptz NOT NULL,PRIMARY KEY(meter_id,message_id));
CREATE INDEX transmission_latest ON meter_transmissions(meter_id,received_at DESC);
CREATE UNIQUE INDEX verified_identifier_owner ON meter_identifiers(namespace,kind,normalized);
