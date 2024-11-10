
if ('function' === typeof importScripts) {
    importScripts('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js');
    importScripts('https://cdnjs.cloudflare.com/ajax/libs/PapaParse/5.3.0/papaparse.min.js');
    self.onmessage = async function (e) {
        const { file } = e.data;
        const zip = await JSZip.loadAsync(file);

        const stopsFile = zip.file('stops.txt');
        const shapesFile = zip.file('shapes.txt');
        const routesFile = zip.file('routes.txt');
        const stopTimesFile = zip.file('stop_times.txt');
        const tripsFile = zip.file('trips.txt');

        if (stopsFile && routesFile && stopTimesFile && tripsFile) {
            // .replace(/[\u200B-\u200D\uFEFF]/g, "") - removes zero width unicode characters
            const stopsData = await stopsFile.async('text');
            const parsedStops = Papa.parse(stopsData.replace(/[\u200B-\u200D\uFEFF]/g, ""), { header: true, skipEmptyLines: true }).data;

            const routesData = await routesFile.async('text');
            const parsedRoutes = Papa.parse(routesData.replace(/[\u200B-\u200D\uFEFF]/g, ""), { header: true, skipEmptyLines: true }).data;

            const tripsData = await tripsFile.async('text');
            const parsedTrips = Papa.parse(tripsData.replace(/[\u200B-\u200D\uFEFF]/g, ""), { header: true, skipEmptyLines: true }).data;

            const stopTimesData = await stopTimesFile.async('text');
            const parsedStopTimes = Papa.parse(stopTimesData.replace(/[\u200B-\u200D\uFEFF]/g, ""), { header: true, skipEmptyLines: true }).data;

            let shapesData = [];
            if (shapesFile) {
                const shapesText = await shapesFile.async('text');
                shapesData = Papa.parse(shapesText.replace(/[\u200B-\u200D\uFEFF]/g, ""), { header: true, skipEmptyLines: true }).data;
            }
            self.postMessage({
                stops: parsedStops,
                routes: parsedRoutes,
                trips: parsedTrips,
                stopTimes: parsedStopTimes,
                shapes: shapesData
            });
        } else {
            self.postMessage({ error: 'The GTFS file does not contain the necessary files.' });
        }
    };
}

