mapboxgl.accessToken = 'pk.eyJ1IjoidGltYW8iLCJhIjoiY203ZTBrbGZyMDhxYzJrb2t4ZnQycmZ0NSJ9.JtSDY8XmJxmTcPoiAsoSEw';

// Initialize the map
const map = new mapboxgl.Map({
    container: 'map', 
    style: 'mapbox://styles/mapbox/streets-v12', 
    center: [-71.09415, 42.36027], 
    zoom: 12, 
    minZoom: 5, 
    maxZoom: 18 
});

const trafficUrl = "https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv";
const jsonurl = "https://dsc106.com/labs/lab07/data/bluebikes-stations.json";

let departuresByMinute = Array.from({ length: 1440 }, () => []);
let arrivalsByMinute = Array.from({ length: 1440 }, () => []);

// Function to convert a date object to minutes since midnight
function minutesSinceMidnight(date) {
    return date.getHours() * 60 + date.getMinutes();
}

// Load station data first
d3.json(jsonurl).then(jsonData => {
    console.log('Loaded JSON Data:', jsonData);
    let stations = jsonData.data.stations;
    console.log('Stations Array:', stations);

    // Load traffic data
    d3.csv(trafficUrl).then(trips => {
        console.log('Loaded Traffic Data:', trips.slice(0, 5)); // Preview first 5 rows

        // Compute arrivals and departures
        trips.forEach(trip => {
            let startedMinutes = minutesSinceMidnight(new Date(trip.started_at));
            let endedMinutes = minutesSinceMidnight(new Date(trip.ended_at));

            departuresByMinute[startedMinutes].push(trip);
            arrivalsByMinute[endedMinutes].push(trip);
        });

        // Update station data with traffic counts
        let departures = d3.rollup(trips, v => v.length, d => d.start_station_id);
        let arrivals = d3.rollup(trips, v => v.length, d => d.end_station_id);

        stations = stations.map(station => {
            let id = station.short_name;
            station.arrivals = arrivals.get(id) ?? 0;
            station.departures = departures.get(id) ?? 0;
            station.totalTraffic = station.arrivals + station.departures;
            return station;
        });

        console.log('Updated Stations with Traffic Data:', stations);

        // Define radius scale AFTER traffic data is available
        const radiusScale = d3
            .scaleSqrt()
            .domain([0, d3.max(stations, d => d.totalTraffic)])
            .range([0, 25]);

        map.on('load', () => {
            // Add bike lanes
            map.addSource('boston_route', {
                type: 'geojson',
                data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson?...'
            });

            map.addSource('cambridge_route', {
                type: 'geojson',
                data: 'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson'
            });

            map.addLayer({
                id: 'bike-lanes',
                type: 'line',
                source: 'boston_route',
                paint: {
                    'line-color': '#32D400',
                    'line-width': 3,
                    'line-opacity': 0.5
                }
            });

            map.addLayer({
                id: 'cambridge-bike-lanes',
                type: 'line',
                source: 'cambridge_route',
                paint: {
                    'line-color': '#32D400',
                    'line-width': 3,
                    'line-opacity': 0.5
                }
            });

            // Add circles to represent stations
            const svg = d3.select('#map').select('svg');

            function getCoords(station) {
                const point = new mapboxgl.LngLat(+station.lon, +station.lat);
                const { x, y } = map.project(point);
                return { cx: x, cy: y };
            }

            const circles = svg.selectAll('circle')
                .data(stations)
                .enter()
                .append('circle')
                .attr('r', d => radiusScale(d.totalTraffic))  // Scale radius by traffic volume
                .attr('fill', 'steelblue')
                .attr('stroke', 'white')
                .attr('stroke-width', 1)
                .attr('opacity', 0.8)
                .each(function(d) {
                    // Add <title> for browser tooltips
                    d3.select(this)
                      .append('title')
                      .text(`${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`);
                    console.log(`Tooltip added to station ${d.short_name}: ${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`);
                });
            
            function updatePositions() {
                circles
                    .attr('cx', d => getCoords(d).cx)
                    .attr('cy', d => getCoords(d).cy);
            }

            updatePositions();

            map.on('move', updatePositions);
            map.on('zoom', updatePositions);
            map.on('resize', updatePositions);
            map.on('moveend', updatePositions);
        });

        // Function to handle time filter logic
        let filteredArrivals = new Map();
        let filteredDepartures = new Map();
        let filteredStations = [];

        function filterByMinute(tripsByMinute, minute) {
            // Normalize both to the [0, 1439] range
            let minMinute = (minute - 60 + 1440) % 1440;
            let maxMinute = (minute + 60) % 1440;

            if (minMinute > maxMinute) {
                let beforeMidnight = tripsByMinute.slice(minMinute);
                let afterMidnight = tripsByMinute.slice(0, maxMinute);
                return beforeMidnight.concat(afterMidnight).flat();
            } else {
                return tripsByMinute.slice(minMinute, maxMinute).flat();
            }
        }

        function filterTripsbyTime() {
            // Clear previous filtered data
            filteredArrivals.clear();
            filteredDepartures.clear();

            let tripsInTimeRange = filterByMinute(departuresByMinute, timeFilter);

            // Filter the stations based on filtered trips
            tripsInTimeRange.forEach(trip => {
                const startStationId = trip.start_station_id;
                const endStationId = trip.end_station_id;

                filteredArrivals.set(endStationId, (filteredArrivals.get(endStationId) ?? 0) + 1);
                filteredDepartures.set(startStationId, (filteredDepartures.get(startStationId) ?? 0) + 1);
            });

            // Update stations with filtered data
            filteredStations = stations.map(station => {
                station = { ...station };  // Clone the station object
                station.arrivals = filteredArrivals.get(station.short_name) ?? 0;
                station.departures = filteredDepartures.get(station.short_name) ?? 0;
                station.totalTraffic = station.arrivals + station.departures;
                return station;
            });
        }

        // Update timeFilter and apply the filter logic
        let timeFilter = -1;
        const timeSlider = document.getElementById('time-slider');
        const selectedTime = document.getElementById('selected-time');
        const anyTimeLabel = document.getElementById('any-time');

        function formatTime(minutes) {
            const date = new Date(0, 0, 0, 0, minutes);  // Set hours & minutes
            return date.toLocaleString('en-US', { timeStyle: 'short' }); // Format as HH:MM AM/PM
        }

        function updateTimeDisplay() {
            timeFilter = Number(timeSlider.value);  // Get slider value
            
            if (timeFilter === -1) {
                selectedTime.textContent = '';  // Clear time display
                anyTimeLabel.style.display = 'block';  // Show "(any time)"
                
                // Reset filteredStations to the original stations without time filtering
                filteredStations = stations.map(station => {
                    station = { ...station };  // Clone the station object
                    station.arrivals = arrivals.get(station.short_name) ?? 0;
                    station.departures = departures.get(station.short_name) ?? 0;
                    station.totalTraffic = station.arrivals + station.departures;
                    return station;
                });
        
            } else {
                selectedTime.textContent = formatTime(timeFilter);  // Display formatted time
                anyTimeLabel.style.display = 'none';  // Hide "(any time)"
        
                // Apply filtering
                filterTripsbyTime();
            }
        
            // Update circles based on filtered or unfiltered data
            d3.select('#map').select('svg').selectAll('circle')
                .data(filteredStations)
                .attr('r', d => radiusScale(d.totalTraffic))  // Update radius based on filtered or unfiltered data
                .each(function(d) {
                    d3.select(this)
                      .select('title')
                      .text(`${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`);
                });
        }
        

        timeSlider.addEventListener('input', updateTimeDisplay);
        updateTimeDisplay();
    }).catch(error => {
        console.error('Error loading CSV:', error);
    });

}).catch(error => {
    console.error('Error loading JSON:', error);
});
