import React, { useState, useEffect } from 'react';
import maplibre from 'maplibre-gl';
import JSZip from 'jszip';
import Papa from 'papaparse';
import 'maplibre-gl/dist/maplibre-gl.css';
import 'tailwindcss/tailwind.css';

const App = () => {
  const [map, setMap] = useState(null);
  const [stops, setStops] = useState([]);
  const [routes, setRoutes] = useState([]);
  var popup = null;

  useEffect(() => {
    if (!map) {
      const initializedMap = new maplibre.Map({
        container: 'map',
        style: 'https://tiles.openfreemap.org/styles/liberty',
        center: [0,0],
        zoom: 2,
      });
      setMap(initializedMap);

      initializedMap.on('load', () => {
        initializedMap.addSource('stops', {
          type: 'geojson',
          data: {
            type: 'FeatureCollection',
            features: [],
          },
        });

        initializedMap.addLayer({
          id: 'stops-layer',
          type: 'circle',
          source: 'stops',
          paint: {
            'circle-radius': 5,
            'circle-color': '#007cbf',
          },
        });

        initializedMap.addSource('routes', {
          type: 'geojson',
          data: {
            type: 'FeatureCollection',
            features: [],
          },
        });

        initializedMap.addLayer({
          id: 'routes-layer',
          type: 'line',
          source: 'routes',
          paint: {
            'line-width': 3,
            'line-color': ['get', 'color'], 
          },
        });

        // stop popup
        initializedMap.on('mouseenter', 'stops-layer', (e) => {
          const feature = e.features[0];
          const coordinates = feature.geometry.coordinates.slice();
          const { stop_name, stop_id, stop_desc, stop_lat, stop_lon } = feature.properties;

          if (popup) {
            popup.remove();
          }

          const newPopup = new maplibre.Popup({
            closeButton: false,
            closeOnClick: false,
          })
            .setLngLat(coordinates)
            .setHTML(`
              <div>
                <strong>${stop_name}</strong><br />
                <em>ID:</em> ${stop_id}<br />
                <em>Description:</em> ${stop_desc || 'N/A'}<br />
                <em>Lat:</em> ${stop_lat}<br />
                <em>Lon:</em> ${stop_lon}
              </div>
            `)
            .addTo(initializedMap);

          popup = newPopup;
          initializedMap.getCanvas().style.cursor = 'pointer';
        });

        initializedMap.on('mouseleave', 'stops-layer', () => {
          if (popup) {
            popup.remove();
            popup = null;
          }
          initializedMap.getCanvas().style.cursor = '';
        });
      });
    }
  }, [map, popup]);

  const handleFileUpload = async (event) => {
    const file = event.target.files[0];
    if (file) {
      const zip = await JSZip.loadAsync(file);
      const stopsFile = zip.file('stops.txt');
      const shapesFile = zip.file('shapes.txt');
      const routesFile = zip.file('routes.txt');
      const stopTimesFile = zip.file('stop_times.txt');
      const tripsFile = zip.file('trips.txt');

      if (stopsFile && routesFile && stopTimesFile && tripsFile) {
        const stopsData = await stopsFile.async('text');
        const parsedStops = Papa.parse(stopsData, { header: true, skipEmptyLines: true }).data;
        const stopFeatures = parsedStops.map((stop) => ({
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [parseFloat(stop.stop_lon), parseFloat(stop.stop_lat)],
          },
          properties: stop,
        }));

        setStops(stopFeatures);
        map.getSource('stops').setData({
          type: 'FeatureCollection',
          features: stopFeatures,
        });

        const routesData = await routesFile.async('text');
        const parsedRoutes = Papa.parse(routesData, { header: true, skipEmptyLines: true }).data;
        setRoutes(parsedRoutes);

        const tripsData = await tripsFile.async('text');
        const parsedTrips = Papa.parse(tripsData, { header: true, skipEmptyLines: true }).data;

        const stopTimesData = await stopTimesFile.async('text');
        const parsedStopTimes = Papa.parse(stopTimesData, { header: true, skipEmptyLines: true }).data;

        let shapesData = [];
        if (shapesFile) {
          const shapesText = await shapesFile.async('text');
          shapesData = Papa.parse(shapesText, { header: true, skipEmptyLines: true }).data;
        }

        // center map on data
        const coordinates = stopFeatures.map((feature) => feature.geometry.coordinates);
        const bounds = coordinates.reduce((bounds, coord) => bounds.extend(coord), new maplibre.LngLatBounds(coordinates[0], coordinates[0]));
        map.fitBounds(bounds, { padding: 20 });

        drawUniqueTrips(parsedRoutes, parsedTrips, parsedStopTimes, shapesData, stopFeatures);
      } else {
        alert("The GTFS file does not contain the necessary files.");
      }
    }
  };

  const drawUniqueTrips = (routes, trips, stopTimes, shapes, stops) => {
    const routeColors = routes.reduce((acc, route) => {
      acc[route.route_id] = `#${route.route_color || '000000'}`;
      return acc;
    }, {});

    const tripInfo = trips.reduce((acc, trip) => {
      acc[trip.trip_id] = { route_id: trip.route_id, shape_id: trip.shape_id };
      return acc;
    }, {});

    const tripsByRoute = stopTimes.reduce((acc, stopTime) => {
      const { trip_id, stop_id } = stopTime;
      const tripData = tripInfo[trip_id];
      if (!tripData) return acc;

      const { route_id, shape_id } = tripData;
      if (!acc[trip_id]) acc[trip_id] = { route_id, shape_id, stops: [] };
      acc[trip_id].stops.push(stops.find(stop => stop.properties.stop_id === stop_id));
      return acc;
    }, {});

    const uniqueSequences = {};
    for (const [tripId, tripData] of Object.entries(tripsByRoute)) {
      const stopSequence = tripData.stops.map(stop => stop.properties.stop_id).join('-');
      const key = `${tripData.route_id}-${stopSequence}`;

      if (!uniqueSequences[key]) {
        uniqueSequences[key] = {
          route_id: tripData.route_id,
          coordinates: tripData.stops.map(stop => stop.geometry.coordinates),
          shape_id: tripData.shape_id,
        };
      }
    }

    const features = Object.values(uniqueSequences).map(({ route_id, coordinates, shape_id }) => {
      const routeColor = routeColors[route_id] || '#000000';
      const shapeCoordinates = shapes.length && shape_id
        ? shapes
          .filter(shape => shape.shape_id === shape_id)
          .sort((a, b) => a.shape_pt_sequence - b.shape_pt_sequence)
          .map(shape => [parseFloat(shape.shape_pt_lon), parseFloat(shape.shape_pt_lat)])
        : coordinates;

      return {
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: shapeCoordinates,
        },
        properties: {
          color: routeColor,
        },
      };
    });

    map.getSource('routes').setData({
      type: 'FeatureCollection',
      features,
    });
  };

  return (
    <div className="h-screen flex flex-col">
      <div className="flex m-3">
        <h1 className="text-4xl content-center flex-1">
          GTFS Viewer
        </h1>
        <input
          type="file"
          accept=".zip"
          onChange={handleFileUpload}
          className="p-2 border rounded-md justify-self-center flex-1"
        />
        <div className="flex-1"></div>
      </div>
      <div id="map" className="flex-1" />
    </div>
  );
};

export default App;
