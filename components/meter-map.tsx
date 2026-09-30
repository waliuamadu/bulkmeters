'use client';
import { useEffect, useRef } from 'react';
import 'leaflet/dist/leaflet.css';
type Meter = {
  id: string;
  latitude: string | number | null;
  longitude: string | number | null;
  facility?: string;
  reporting_status?: string;
  flow_rate?: string;
  cumulative_volume?: string;
};
export function MeterMap({
  meters,
  onSelect,
}: {
  meters: Meter[];
  onSelect: (m: Meter) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let map: import('leaflet').Map | undefined,
      closed = false;
    void import('leaflet').then((L) => {
      if (closed || !host.current) return;
      map = L.map(host.current).setView([7.95, -1.1], 7);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 18,
      }).addTo(map);
      const bounds: import('leaflet').LatLngTuple[] = [];
      for (const meter of meters) {
        if (meter.latitude === null || meter.longitude === null) continue;
        const point: import('leaflet').LatLngTuple = [
          Number(meter.latitude),
          Number(meter.longitude),
        ];
        if (!Number.isFinite(point[0]) || !Number.isFinite(point[1])) continue;
        bounds.push(point);
        const color =
          (
            {
              Online: '#168878',
              Delayed: '#d7a537',
              Offline: '#c15562',
            } as Record<string, string>
          )[meter.reporting_status || ''] || '#8798a5';
        const marker = L.circleMarker(point, {
          radius: 8,
          color: '#fff',
          weight: 2,
          fillColor: color,
          fillOpacity: 1,
        }).addTo(map);
        const content = document.createElement('div');
        const title = document.createElement('strong');
        title.textContent = meter.id;
        content.appendChild(title);
        const text = document.createElement('p');
        text.textContent = `${meter.facility || 'Unassigned'} · ${meter.reporting_status || 'Never Reported'} · Flow ${meter.flow_rate ?? '—'} · Volume ${meter.cumulative_volume ?? '—'}`;
        content.appendChild(text);
        const button = document.createElement('button');
        button.textContent = 'View meter profile';
        button.addEventListener('click', () => onSelect(meter));
        content.appendChild(button);
        marker.bindPopup(content);
      }
      if (bounds.length)
        map.fitBounds(bounds, { padding: [30, 30], maxZoom: 13 });
    });
    return () => {
      closed = true;
      map?.remove();
    };
  }, [meters, onSelect]);
  return (
    <div
      ref={host}
      aria-label="Production meter map"
      style={{ height: 440, width: '100%', zIndex: 0 }}
    />
  );
}
