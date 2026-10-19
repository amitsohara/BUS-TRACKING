import React, { useEffect, useRef } from 'react';
import L from 'leaflet';

export interface MapStop {
  id: string;
  name: string;
  sequence: number;
  latitude: number;
  longitude: number;
  time?: string;
  status?: string; // PENDING, ARRIVED, DEPARTED
  geofenceMeters?: number;
}

export interface MapVehicleLocation {
  latitude: number;
  longitude: number;
  speedKmh?: number;
  heading?: number;
  busNumber?: string;
  recordedAt?: string;
  isStale?: boolean;
}

interface MapViewerProps {
  stops?: MapStop[];
  vehicleLocation?: MapVehicleLocation | null;
  height?: string;
  showRouteLine?: boolean;
  interactive?: boolean;
  center?: [number, number];
  zoom?: number;
  onStopClick?: (stop: MapStop) => void;
}

export const MapViewer: React.FC<MapViewerProps> = ({
  stops = [],
  vehicleLocation,
  height = '420px',
  showRouteLine = true,
  interactive = true,
  center,
  zoom = 13,
  onStopClick,
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const vehicleMarkerRef = useRef<L.Marker | null>(null);
  const stopMarkersRef = useRef<L.LayerGroup | null>(null);
  const polylineRef = useRef<L.Polyline | null>(null);

  // Initialize Map
  useEffect(() => {
    if (!mapContainerRef.current) return;

    if (!mapInstanceRef.current) {
      const defaultCenter: [number, number] = center || [28.5494, 77.2065]; // New Delhi default
      const map = L.map(mapContainerRef.current, {
        center: defaultCenter,
        zoom,
        zoomControl: interactive,
        dragging: interactive,
        scrollWheelZoom: interactive,
        attributionControl: false,
      });

      // Standard OpenStreetMap tiles (free, reliable, zero key required)
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
      }).addTo(map);

      stopMarkersRef.current = L.layerGroup().addTo(map);
      mapInstanceRef.current = map;
    }

    return () => {
      // Map cleanup on unmount
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  // Update Stops and Route Polyline
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !stopMarkersRef.current) return;

    stopMarkersRef.current.clearLayers();

    if (polylineRef.current) {
      map.removeLayer(polylineRef.current);
      polylineRef.current = null;
    }

    const latLngs: L.LatLngExpression[] = [];

    // Render sequence stops
    stops.forEach((stop) => {
      const pos: [number, number] = [stop.latitude, stop.longitude];
      latLngs.push(pos);

      // Stop status badge color
      const isDeparted = stop.status === 'DEPARTED';
      const isArrived = stop.status === 'ARRIVED';
      const bgColor = isDeparted ? '#10b981' : isArrived ? '#f59e0b' : '#3b82f6';

      const stopHtml = `
        <div style="
          background-color: ${bgColor};
          color: white;
          width: 28px;
          height: 28px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 12px;
          font-weight: 700;
          box-shadow: 0 2px 6px rgba(0,0,0,0.3);
          border: 2px solid white;
        ">
          ${stop.sequence}
        </div>
      `;

      const customIcon = L.divIcon({
        html: stopHtml,
        className: 'custom-stop-marker',
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      });

      const marker = L.marker(pos, { icon: customIcon });
      marker.bindPopup(`
        <div style="font-family: sans-serif; font-size: 13px;">
          <strong style="color: #0f172a;">Stop #${stop.sequence}: ${stop.name}</strong><br/>
          <span style="color: #64748b;">Scheduled: ${stop.time || 'N/A'}</span><br/>
          <span style="font-size: 11px; padding: 2px 6px; border-radius: 4px; background: ${bgColor}20; color: ${bgColor}; font-weight: 600;">
            ${stop.status || 'SCHEDULED'}
          </span>
        </div>
      `);

      if (onStopClick) {
        marker.on('click', () => onStopClick(stop));
      }

      // Add Geofence Circle
      if (stop.geofenceMeters && stopMarkersRef.current) {
        L.circle(pos, {
          radius: stop.geofenceMeters,
          color: '#10b981',
          fillColor: '#10b981',
          fillOpacity: 0.1,
          weight: 1,
          dashArray: '3, 4',
        }).addTo(stopMarkersRef.current);
      }

      if (stopMarkersRef.current) {
        marker.addTo(stopMarkersRef.current);
      }
    });

    // Draw route line
    if (showRouteLine && latLngs.length > 1) {
      polylineRef.current = L.polyline(latLngs, {
        color: '#2563eb',
        weight: 4,
        opacity: 0.7,
        dashArray: '6, 6',
      }).addTo(map);
    }

    // Auto-fit bounds if stops available and no vehicle location
    if (latLngs.length > 0 && !vehicleLocation) {
      map.fitBounds(L.latLngBounds(latLngs), { padding: [40, 40] });
    }
  }, [stops, showRouteLine]);

  // Update Vehicle Location Marker
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (!vehicleLocation) {
      if (vehicleMarkerRef.current) {
        map.removeLayer(vehicleMarkerRef.current);
        vehicleMarkerRef.current = null;
      }
      return;
    }

    const pos: [number, number] = [vehicleLocation.latitude, vehicleLocation.longitude];
    const heading = vehicleLocation.heading || 0;
    const isStale = vehicleLocation.isStale;
    const markerColor = isStale ? '#f59e0b' : '#16a34a';

    const busIconHtml = `
      <div style="position: relative; display: flex; flex-direction: column; align-items: center;">
        <div style="
          background-color: ${markerColor};
          color: white;
          width: 38px;
          height: 38px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 4px 12px rgba(0,0,0,0.35);
          border: 3px solid white;
          transform: rotate(${heading}deg);
          transition: transform 0.3s ease;
        ">
          <!-- Bus SVG Icon -->
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M8 6v6"></path>
            <path d="M15 6v6"></path>
            <path d="M2 12h19.6"></path>
            <path d="M18 18h3s.5-1.7.8-2.8c.1-.4.2-.8.2-1.2 0-.4-.1-.8-.2-1.2l-1.4-5C20.1 6.8 19.1 6 18 6H4C2.9 6 1.9 6.8 1.6 7.8L.2 12.8c-.1.4-.2.8-.2 1.2 0 .4.1.8.2 1.2.3 1.1.8 2.8.8 2.8h3"></path>
            <circle cx="7" cy="18" r="2"></circle>
            <path d="M9 18h5"></path>
            <circle cx="16" cy="18" r="2"></circle>
          </svg>
        </div>
        <div style="
          background: rgba(15, 23, 42, 0.85);
          color: white;
          padding: 2px 6px;
          border-radius: 4px;
          font-size: 10px;
          font-weight: 700;
          margin-top: 2px;
          white-space: nowrap;
          box-shadow: 0 1px 4px rgba(0,0,0,0.2);
        ">
          ${vehicleLocation.busNumber || 'Bus'} • ${Math.round(vehicleLocation.speedKmh || 0)} km/h
        </div>
      </div>
    `;

    const vehicleIcon = L.divIcon({
      html: busIconHtml,
      className: 'custom-bus-marker',
      iconSize: [44, 52],
      iconAnchor: [22, 26],
    });

    if (!vehicleMarkerRef.current) {
      vehicleMarkerRef.current = L.marker(pos, { icon: vehicleIcon }).addTo(map);
      map.panTo(pos);
    } else {
      vehicleMarkerRef.current.setLatLng(pos);
      vehicleMarkerRef.current.setIcon(vehicleIcon);
    }

    vehicleMarkerRef.current.bindPopup(`
      <div style="font-family: sans-serif; font-size: 13px;">
        <strong style="color: #0f172a;">${vehicleLocation.busNumber || 'School Bus'}</strong><br/>
        <span>Speed: <strong>${Math.round(vehicleLocation.speedKmh || 0)} km/h</strong></span><br/>
        <span>Status: <strong style="color: ${markerColor}">${isStale ? 'Signal Stale (>2m ago)' : 'Live Signal'}</strong></span><br/>
        <span style="font-size: 11px; color: #64748b;">Updated: ${vehicleLocation.recordedAt || 'Just now'}</span>
      </div>
    `);
  }, [vehicleLocation]);

  return (
    <div className="relative w-full rounded-xl overflow-hidden border border-slate-200 shadow-sm bg-slate-100">
      <div ref={mapContainerRef} style={{ height, width: '100%' }} />

      {vehicleLocation?.isStale && (
        <div className="absolute top-3 right-3 bg-amber-500/95 backdrop-blur text-white px-3 py-1.5 rounded-lg text-xs font-medium shadow-md flex items-center space-x-2 z-[1000]">
          <span className="w-2 h-2 rounded-full bg-white animate-pulse"></span>
          <span>GPS signal is delayed (&gt; 2 min ago)</span>
        </div>
      )}

      {vehicleLocation && !vehicleLocation.isStale && (
        <div className="absolute top-3 right-3 bg-emerald-600/90 backdrop-blur text-white px-3 py-1.5 rounded-lg text-xs font-semibold shadow-md flex items-center space-x-2 z-[1000]">
          <span className="w-2 h-2 rounded-full bg-white animate-ping"></span>
          <span>LIVE TRACKING ACTIVE</span>
        </div>
      )}
    </div>
  );
};
