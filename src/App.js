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
  const [loading, setLoading] = useState(null);
  const [feedUrl, setFeedUrl] = useState("");
  const [shouldFetch, setShouldFetch] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);

  var popup = null;

  useEffect(() => {
    document.title = "GTFS Viewer"

    if (!map) {
      const initializedMap = new maplibre.Map({
        container: 'map',
        style: 'https://tiles.openfreemap.org/styles/liberty',
        center: [0, 0],
        zoom: 2,
      });
      setMap(initializedMap);

      initializedMap.on('load', () => {
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
            'circle-color': '#6b7280',
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

        // route popup
        initializedMap.on('mouseenter', 'routes-layer', (e) => {
          const totalOccurrences = e.features.reduce((acc, f) => { return acc + f.properties.occurrences }, 0)
          const feature = e.features[0];
          const coordinates = e.lngLat;
          const { color, occurrences } = feature.properties;
          console.log(e.features.length)
          if (popup) {
            popup.remove();
          }

          const newPopup = new maplibre.Popup({
            closeButton: false,
            closeOnClick: false,
          })
            .setLngLat(coordinates)
            .setHTML(
              `
              <div>
                <strong>Route Color:</strong> ${color || 'N/A'}<br />
                <strong>Occurrences:</strong> ${totalOccurrences || 'N/A'}
              </div>
            `)
            .addTo(initializedMap);

          popup = newPopup;
          initializedMap.getCanvas().style.cursor = 'pointer';
        });
        initializedMap.on('mouseleave', 'routes-layer', () => {
          if (popup) {
            popup.remove();
            popup = null;
          }
          initializedMap.getCanvas().style.cursor = '';
        });

        // Check for URL parameter on initial load
        const urlParams = new URLSearchParams(window.location.search);
        const urlFeed = urlParams.get('url');
        if (urlFeed) {
          setFeedUrl(urlFeed);
          setShouldFetch(true);
        }
      });
    }
  }, [map, popup]);

  useEffect(() => {
    if (map && shouldFetch) {
      fetchGtfsFeedFromUrl(feedUrl);
      setShouldFetch(false);
    }
  }, [map, shouldFetch]);

  async function fetchGtfsFeedFromUrl(url) {
    try {
      setLoading("Fetching GTFS feed...");
      const response = await fetch(url);
      if (!response.ok) {
        setErrorMessage("Failed to download - try downloading the zip manual");
        setLoading(null);
      }
      const blob = await response.blob();
      console.log(blob);

      handleZipFile(blob);
    } catch (error) {
      setErrorMessage("Failed to download - try downloading the zip manual");
      setLoading(null);
    }
  }

  function handleUrlSubmit() {
    setErrorMessage(null);
    if (feedUrl) {
      setShouldFetch(true);
    } else {
      setErrorMessage("Enter a feed URL");
    }
  }

  function handleFileUpload(event) {
    setErrorMessage(null);
    const file = event.target.files[0];
    if (file) {
      handleZipFile(file);
    }
  }

  function handleZipFile(file) {
    if (file) {
      setLoading("Extracting...");
      const worker = new Worker('/gtfsExtractWorker.js');
      worker.onmessage = (e) => {
        const { stops, routes, trips, stopTimes, shapes, error } = e.data;
        if (error) {
          setErrorMessage(error);
          setLoading(null);
        } else {
          const stopFeatures = stops.map((stop) => ({
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

          setRoutes(routes);

          // center map on data
          const coordinates = stopFeatures.map((feature) => feature.geometry.coordinates);
          const bounds = coordinates.reduce((bounds, coord) => bounds.extend(coord), new maplibre.LngLatBounds(coordinates[0], coordinates[0]));
          map.fitBounds(bounds, { padding: 20 });

          drawUniqueTrips(routes, trips, stopTimes, shapes, stopFeatures);
        }
      };
      worker.postMessage({ file });
    }
  };

  function drawUniqueTrips(routes, trips, stopTimes, shapes, stops) {
    const worker = new Worker('/gtfsLineWorker.js');
    setLoading("Processing trips...");

    worker.onmessage = (e) => {
      const { geojson, error } = e.data;
      if (error) {
        alert(error);
      } else {
        map.getSource('routes').setData(geojson);
      }
      setLoading(null);
    };
    worker.postMessage({ routes, trips, stopTimes, shapes, stops });
  }

  return (
    <div className="h-screen flex flex-col">
      <div className="flex m-3">
        <h1 className="text-4xl content-center flex-1 truncate">
          GTFS Viewer
        </h1>
        <input
          type="file"
          accept=".zip"
          onChange={handleFileUpload}
          className="p-2 border rounded-md flex-1 content-center"
        />
        <div className="flex-1 flex">

          <input
            type="text"
            placeholder="Enter GTFS feed URL"
            value={feedUrl}
            onChange={(e) => setFeedUrl(e.target.value)}
            className="p-2 border rounded-md flex-1 content-center ml-2"
          />
          <button onClick={handleUrlSubmit} className="ml-2 p-2 bg-blue-500 text-white rounded-md truncate disabled:bg-slate-100 disabled:text-slate-500 disabled:border-slate-200" disabled={!feedUrl}>
            Load from URL
          </button>
        </div>

        <div className="flex-1">
          {loading && (
            <div className="flex content-center m-3 space-x-2 justify-items-center">
              <svg className="w-6 h-6 text-gray-300 animate-spin" viewBox="0 0 64 64" fill="none"
                xmlns="http://www.w3.org/2000/svg" width="24" height="24">
                <path
                  d="M32 3C35.8083 3 39.5794 3.75011 43.0978 5.20749C46.6163 6.66488 49.8132 8.80101 52.5061 11.4939C55.199 14.1868 57.3351 17.3837 58.7925 20.9022C60.2499 24.4206 61 28.1917 61 32C61 35.8083 60.2499 39.5794 58.7925 43.0978C57.3351 46.6163 55.199 49.8132 52.5061 52.5061C49.8132 55.199 46.6163 57.3351 43.0978 58.7925C39.5794 60.2499 35.8083 61 32 61C28.1917 61 24.4206 60.2499 20.9022 58.7925C17.3837 57.3351 14.1868 55.199 11.4939 52.5061C8.801 49.8132 6.66487 46.6163 5.20749 43.0978C3.7501 39.5794 3 35.8083 3 32C3 28.1917 3.75011 24.4206 5.2075 20.9022C6.66489 17.3837 8.80101 14.1868 11.4939 11.4939C14.1868 8.80099 17.3838 6.66487 20.9022 5.20749C24.4206 3.7501 28.1917 3 32 3L32 3Z"
                  stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round"></path>
                <path
                  d="M32 3C36.5778 3 41.0906 4.08374 45.1692 6.16256C49.2477 8.24138 52.7762 11.2562 55.466 14.9605C58.1558 18.6647 59.9304 22.9531 60.6448 27.4748C61.3591 31.9965 60.9928 36.6232 59.5759 40.9762"
                  stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" className="text-gray-900">
                </path>
              </svg>
              <div>{loading}</div>
            </div>
          )}
          {!loading && errorMessage && (
            <div className="flex content-center m-3 space-x-2 justify-items-center text-red-500">
              {errorMessage}
            </div>
          )}
        </div>
      </div>
      <div id="map" className="flex-1" />
    </div>
  );
};

export default App;
