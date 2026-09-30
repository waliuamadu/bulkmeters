'use client';
import type { FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
type Row = Record<string, any>;
function Field({
  name,
  label,
  type = 'text',
  required = true,
  children,
}: {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <label className="field">
      {label}
      {children ? (
        <select name={name} required={required} defaultValue="">
          <option value="">Select…</option>
          {children}
        </select>
      ) : (
        <Input name={name} type={type} required={required} />
      )}
    </label>
  );
}
export function RecordForms({
  modal,
  submit,
  busy,
  config,
  lookups,
  selected,
}: {
  modal: string;
  submit: (
    e: FormEvent<HTMLFormElement>,
    path: string,
    transform?: (d: Row) => Row,
  ) => Promise<void>;
  busy: boolean;
  config: Row;
  lookups: Row;
  selected?: Row;
}) {
  const save = (
    <Button type="submit" disabled={busy}>
      Save & continue
    </Button>
  );
  if (modal === 'login')
    return (
      <form className="formgrid" onSubmit={(e) => submit(e, '/auth/login')}>
        <Field name="email" label="Email" type="email" />
        <Field name="password" label="Password" type="password" />
        <Button type="submit" disabled={busy}>
          Sign in
        </Button>
      </form>
    );
  if (modal === 'region')
    return (
      <form className="formgrid" onSubmit={(e) => submit(e, '/regions')}>
        <Field name="name" label="Region name" />
        {save}
      </form>
    );
  if (modal === 'facility')
    return (
      <form className="formgrid" onSubmit={(e) => submit(e, '/facilities')}>
        <Field name="name" label="Facility name" />
        <Field name="region_id" label="Region">
          {lookups.regions.map((r: Row) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </Field>
        {save}
      </form>
    );
  if (modal === 'point')
    return (
      <form
        className="formgrid"
        onSubmit={(e) =>
          submit(e, '/installation-points', (d) => ({
            ...d,
            latitude: d.latitude ? Number(d.latitude) : null,
            longitude: d.longitude ? Number(d.longitude) : null,
          }))
        }
      >
        <Field name="name" label="Installation point" />
        <Field name="facility_id" label="Facility">
          {lookups.facilities.map((r: Row) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </Field>
        <Field name="classification" label="Operational classification">
          {[
            'Raw Water Intake',
            'Treatment Inlet',
            'Treatment Outlet',
            'Transmission',
            'Booster Station',
            'Reservoir Inlet',
            'Reservoir Outlet',
            'Regional Boundary',
            'District Boundary',
            'Distribution',
            'Other',
          ].map((c) => (
            <option key={c}>{c}</option>
          ))}
        </Field>
        <Field name="station" label="Station" required={false} />
        <Field name="pipeline" label="Pipeline" required={false} />
        <Field name="latitude" label="Latitude" required={false} />
        <Field name="longitude" label="Longitude" required={false} />
        {save}
      </form>
    );
  if (modal === 'parser')
    return (
      <form
        className="formgrid"
        onSubmit={(e) =>
          submit(e, '/parsers', (d) => ({
            ...d,
            enabled: d.enabled === 'on',
            mappings: JSON.parse(d.mappings),
          }))
        }
      >
        <Field name="name" label="Parser name" />
        <Field name="namespace" label="Vendor identity namespace" />
        <Field name="format" label="Source format">
          {['json', 'csv', 'xlsx', 'xml', 'txt', 'html'].map((f) => (
            <option key={f}>{f}</option>
          ))}
        </Field>
        <Field
          name="record_path"
          label="Nested record path (optional)"
          required={false}
        />
        <label className="field full">
          Field mappings (JSON array)
          <textarea
            name="mappings"
            required
            rows={5}
            placeholder={'[{"source":"<actual field>","target":"device_id"}]'}
          />
        </label>
        <p className="muted full">
          Available targets: {config.targets.join(', ')}. Identity fields must
          be text; reading timestamps require an explicit UTC offset.
        </p>
        <label>
          <input type="checkbox" name="enabled" /> Enable after validation
        </label>
        {save}
      </form>
    );
  if (modal === 'source')
    return (
      <form
        className="formgrid"
        onSubmit={(e) =>
          submit(e, '/sources', (d) =>
            Object.fromEntries(
              Object.entries({ ...d, enabled: d.enabled === 'on' }).filter(
                ([, v]) => typeof v !== 'string' || v !== '',
              ),
            ),
          )
        }
      >
        <Field name="name" label="Source name" />
        <Field name="parser_id" label="Parser">
          {config.parsers.map((p: Row) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Field>
        <Field
          name="sender"
          label="Exact sender email"
          type="email"
          required={false}
        />
        <Field name="domain" label="Exact sender domain" required={false} />
        {[
          ['subject_contains', 'Subject contains'],
          ['label', 'Gmail label ID'],
          ['keyword', 'Message keyword'],
          ['filename_contains', 'Attachment filename contains'],
          ['attachment_type', 'Attachment MIME type'],
          ['vendor_identifier', 'Vendor content marker'],
        ].map(([name, label]) => (
          <Field key={name} name={name} label={label} required={false} />
        ))}
        <label>
          <input type="checkbox" name="enabled" /> Enable source
        </label>
        {save}
      </form>
    );
  if (modal === 'user')
    return (
      <form
        className="formgrid"
        onSubmit={(e) =>
          submit(e, '/users', (d) => ({
            ...d,
            region_id: d.region_id || null,
            facility_id: d.facility_id || null,
          }))
        }
      >
        <Field name="email" label="Email" type="email" />
        <Field
          name="password"
          label="Password (14+ characters)"
          type="password"
        />
        <Field name="role" label="Role">
          {[
            'Super Administrator',
            'ICT Administrator',
            'Production Administrator',
            'Operations Manager',
            'Regional Manager',
            'Plant Operator',
            'Analyst',
            'Executive Viewer',
          ].map((r) => (
            <option key={r}>{r}</option>
          ))}
        </Field>
        <Field name="region_id" label="Assigned region" required={false}>
          {lookups.regions.map((r: Row) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </Field>
        <Field name="facility_id" label="Assigned facility" required={false}>
          {lookups.facilities.map((r: Row) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </Field>
        {save}
      </form>
    );
  if (modal === 'identity' && selected)
    return (
      <>
        <form
          className="formgrid"
          onSubmit={(e) =>
            submit(e, `/unidentified-meters/${selected.id}/match`)
          }
        >
          <Field name="meter_id" label="Match existing physical meter">
            {lookups.meters.map((m: Row) => (
              <option key={m.id} value={m.id}>
                {m.id} · {m.serial_number || 'No serial'}
              </option>
            ))}
          </Field>
          <Button type="submit" disabled={busy}>
            Confirm match
          </Button>
        </form>
        <h3>Register new physical meter</h3>
        <form
          className="formgrid"
          onSubmit={(e) =>
            submit(e, `/unidentified-meters/${selected.id}/register`, (d) => ({
              ...d,
              installed_at: d.installed_at + ':00Z',
            }))
          }
        >
          <Field
            name="serial_number"
            label="Verified serial number (if known)"
            required={false}
          />
          <Field name="manufacturer" label="Manufacturer" required={false} />
          <Field name="model" label="Model" required={false} />
          <Field name="meter_type" label="Meter type" required={false} />
          <Field name="point_id" label="Installation point">
            {lookups.points.map((p: Row) => (
              <option key={p.id} value={p.id}>
                {p.name} · {p.facility}
              </option>
            ))}
          </Field>
          <Field
            name="installed_at"
            label="Installed at (UTC)"
            type="datetime-local"
          />
          <Button type="submit" disabled={busy || !lookups.points.length}>
            Validate & register
          </Button>
        </form>
        <p className="muted">
          Create the installation point first if it is not listed. Retry source
          messages after validation to backfill historical readings.
        </p>
      </>
    );
  if (modal === 'schedule')
    return (
      <form
        className="formgrid"
        onSubmit={(e) =>
          submit(e, '/settings', (d) => ({
            poll_minutes: Number(d.poll_minutes),
            discovery_days: Number(d.discovery_days),
            enabled: d.enabled === 'on',
          }))
        }
      >
        <label className="field">
          Polling interval (minutes)
          <Input
            type="number"
            min={1}
            max={1440}
            name="poll_minutes"
            defaultValue={config.settings?.poll_minutes || 5}
            required
          />
        </label>
        <label className="field">
          Discovery period (days)
          <Input
            type="number"
            min={1}
            max={3650}
            name="discovery_days"
            defaultValue={config.settings?.discovery_days || 30}
            required
          />
        </label>
        <label>
          <input
            name="enabled"
            type="checkbox"
            defaultChecked={config.settings?.enabled}
          />{' '}
          Enable automatic ingestion
        </label>
        {save}
      </form>
    );
  if (modal === 'parser-edit' && selected)
    return (
      <form
        className="formgrid"
        onSubmit={(e) =>
          submit(e, '/parsers/' + selected.id, (d) => ({
            enabled: d.enabled === 'on',
            mappings: JSON.parse(d.mappings),
          }))
        }
      >
        <p className="full">
          {selected.name} · {selected.format} · {selected.namespace}
        </p>
        <label className="field full">
          Mappings
          <textarea
            rows={10}
            name="mappings"
            defaultValue={JSON.stringify(
              selected.mappings.map((m: Row) => ({
                source: m.source,
                target: m.target,
              })),
              null,
              2,
            )}
          />
        </label>
        <label>
          <input
            name="enabled"
            type="checkbox"
            defaultChecked={selected.enabled}
          />{' '}
          Enable parser
        </label>
        {save}
      </form>
    );
  if (modal === 'source-edit' && selected)
    return (
      <form
        className="formgrid"
        onSubmit={(e) =>
          submit(e, '/sources/' + selected.id, (d) => ({
            enabled: d.enabled === 'on',
          }))
        }
      >
        <p className="full">
          {selected.name} · {selected.sender || selected.domain}
        </p>
        <label>
          <input
            name="enabled"
            type="checkbox"
            defaultChecked={selected.enabled}
          />{' '}
          Enable trusted source
        </label>
        {save}
      </form>
    );
  if (modal === 'register')
    return (
      <form
        className="formgrid"
        onSubmit={(e) =>
          submit(e, '/meters', (d) => ({
            ...d,
            point_id: d.point_id || null,
            installed_at: d.installed_at ? d.installed_at + ':00Z' : null,
          }))
        }
      >
        <Field
          name="serial_number"
          label="Verified serial (if known)"
          required={false}
        />
        <Field name="manufacturer" label="Manufacturer" required={false} />
        <Field name="model" label="Model" required={false} />
        <Field name="meter_type" label="Meter type" required={false} />
        <Field
          name="point_id"
          label="Installation (leave blank for spare asset)"
          required={false}
        >
          {lookups.points.map((p: Row) => (
            <option value={p.id} key={p.id}>
              {p.name}
            </option>
          ))}
        </Field>
        <Field
          name="installed_at"
          label="Installed at (UTC)"
          type="datetime-local"
          required={false}
        />
        {save}
      </form>
    );
  if (modal === 'replace' && selected)
    return (
      <form
        className="formgrid"
        onSubmit={(e) =>
          submit(e, '/meters/' + selected.id + '/replace', (d) => ({
            ...d,
            at: d.at + ':00Z',
          }))
        }
      >
        <p className="full">
          This closes the current installation period. Existing readings keep
          their original meter and installation. Register the replacement as a
          spare asset first.
        </p>
        <Field name="replacement_id" label="Replacement meter">
          {lookups.meters
            .filter((m: Row) => m.id !== selected.id && !m.point_id)
            .map((m: Row) => (
              <option value={m.id} key={m.id}>
                {m.id} · {m.serial_number}
              </option>
            ))}
        </Field>
        <Field name="at" label="Replacement time (UTC)" type="datetime-local" />
        {save}
      </form>
    );
  if (modal === 'identifier' && selected)
    return (
      <form
        className="formgrid"
        onSubmit={(e) => submit(e, '/meters/' + selected.id + '/identifiers')}
      >
        <Field name="namespace" label="Vendor namespace" />
        <Field name="kind" label="Identifier type">
          {[
            'meter_serial_number',
            'device_id',
            'meter_id',
            'logger_id',
            'communication_id',
            'imei',
            'gateway_id',
            'sensor_id',
            'station_id',
            'vendor_identifier',
          ].map((k) => (
            <option key={k}>{k}</option>
          ))}
        </Field>
        <Field name="value" label="Verified identifier" />
        {save}
      </form>
    );
  if (modal === 'meter-edit' && selected)
    return (
      <form
        className="formgrid"
        onSubmit={(e) =>
          submit(e, '/meters/' + selected.id, (d) => ({
            ...d,
            serial_number: d.serial_number || null,
            manufacturer: d.manufacturer || null,
            model: d.model || null,
            expected_minutes: Number(d.expected_minutes),
            offline_minutes: Number(d.offline_minutes),
            max_volume_jump: d.max_volume_jump
              ? Number(d.max_volume_jump)
              : null,
          }))
        }
      >
        {[
          'serial_number',
          'manufacturer',
          'model',
          'expected_minutes',
          'offline_minutes',
          'max_volume_jump',
        ].map((k) => (
          <label className="field" key={k}>
            {k.replaceAll('_', ' ')}
            <Input name={k} defaultValue={selected[k] ?? ''} />
          </label>
        ))}
        <label className="field">
          Administrative status
          <select name="status" defaultValue={selected.status}>
            {[
              'Active',
              'Inactive',
              'Offline',
              'Faulty',
              'Removed',
              'Replaced',
              'Under Maintenance',
            ].map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </label>
        {save}
      </form>
    );
  return null;
}
