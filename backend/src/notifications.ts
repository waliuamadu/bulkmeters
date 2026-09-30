import { db, uuid } from './db.js';
export async function refreshNotifications() {
  await db.query(
    `INSERT INTO notifications(id,meter_id,kind,detail) SELECT gen_random_uuid(),m.id,'reporting', CASE WHEN max(t.received_at)<now()-m.offline_minutes*interval '1 minute' THEN 'Offline' ELSE 'Delayed' END FROM meters m JOIN meter_transmissions t ON t.meter_id=m.id WHERE m.status='Active' GROUP BY m.id HAVING max(t.received_at)<now()-m.expected_minutes*interval '1 minute' ON CONFLICT(meter_id,kind) DO UPDATE SET detail=EXCLUDED.detail,created_at=CASE WHEN notifications.detail<>EXCLUDED.detail THEN now() ELSE notifications.created_at END`,
  );
  await db.query(
    `DELETE FROM notifications n USING meters m WHERE n.meter_id=m.id AND n.kind='reporting' AND EXISTS(SELECT 1 FROM meter_transmissions t WHERE t.meter_id=m.id AND t.received_at>=now()-m.expected_minutes*interval '1 minute')`,
  );
}
