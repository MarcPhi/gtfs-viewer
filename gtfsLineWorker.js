
if ('function' === typeof importScripts) {
    self.onmessage = async function (e) {
        const { routes, trips, stopTimes, shapes, stops } = e.data;

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
                    occurrences: 1,
                };
            }
            else {
                uniqueSequences[key].occurrences += 1;
            }
        }

        const features = Object.values(uniqueSequences).map(({ route_id, coordinates, shape_id, occurrences }) => {
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
                    occurrences: occurrences
                },
            };
        });

        const geojson = {
            type: 'FeatureCollection',
            features,
        };

        self.postMessage({
            geojson: geojson
        });

    };
}

