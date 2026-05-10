const stores = [
  { name: "Goodwill Salem South", lat: 44.8915, lng: -123.0407, address: "3535 Commercial St SE, Salem, OR 97302", website: "https://meetgoodwill.org/", image: "https://source.unsplash.com/800x450/?thrift,storefront" },
  { name: "St. Vincent de Paul Thrift Store", lat: 44.9318, lng: -123.0421, address: "1860 Broadway St NE, Salem, OR 97301", website: "https://www.svdp.us/", image: "https://source.unsplash.com/800x450/?vintage,shop" },
  { name: "Salvation Army Family Store", lat: 44.9324, lng: -123.0256, address: "2855 Broadway St NE, Salem, OR 97303", website: "https://satruck.org/", image: "https://source.unsplash.com/800x450/?resale,store" },
  { name: "Engelberg Antiks & Collectibles", lat: 44.9367, lng: -123.0354, address: "1485 Market St NE, Salem, OR 97301", website: "https://engelbergantiques.com/", image: "https://source.unsplash.com/800x450/?antiques,shop" },
  { name: "SuperThrift - Union Gospel Mission", lat: 44.9491, lng: -123.0309, address: "626 Lancaster Dr NE, Salem, OR 97301", website: "https://ugmsalem.org/superthrift/", image: "https://source.unsplash.com/800x450/?thrift,clothing" }
];

const map = L.map("map").setView([44.9429, -123.0351], 12);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap" }).addTo(map);

const storeList = document.getElementById("storeList");
const cardTemplate = document.getElementById("storeCardTemplate");
const statusEl = document.getElementById("status");
const tourBtn = document.getElementById("tourBtn");
const curatedBtn = document.getElementById("curatedBtn");
const preferenceSelect = document.getElementById("preferenceSelect");

let currentOrigin = null;
let userMarker;
let routeLine;
const markers = new Map();

function haversineMiles(a, b) {
  const R = 3958.8, toRad = (x) => x * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
function googleMapsDirections(lat, lng) { return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`; }
function streetViewLink(lat, lng) { return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}`; }
function focusStore(store) { map.setView([store.lat, store.lng], 15); markers.get(store.name)?.openPopup(); }

function filteredStores() {
  const preference = preferenceSelect.value;
  if (preference === "closest") return [...stores];
  if (preference === "antiques") return stores.filter((s) => s.name.includes("Antik") || s.name.includes("Collectibles"));
  if (preference === "charity") return stores.filter((s) => s.name.includes("Goodwill") || s.name.includes("Salvation") || s.name.includes("Vincent") || s.name.includes("Mission"));
  return [...stores];
}
function clearRoute() { if (routeLine) { map.removeLayer(routeLine); routeLine = null; } }

function renderStores(origin) {
  storeList.innerHTML = "";
  markers.forEach((m) => map.removeLayer(m));
  markers.clear();
  clearRoute();

  const sorted = filteredStores().map((s) => ({ ...s, miles: origin ? haversineMiles(origin, s) : null })).sort((a, b) => (a.miles ?? 999) - (b.miles ?? 999));

  sorted.forEach((store) => {
    const marker = L.marker([store.lat, store.lng]).addTo(map);
    marker.bindPopup(`<strong>${store.name}</strong><br/>${store.address}`);
    marker.on("click", () => focusStore(store));
    markers.set(store.name, marker);

    const card = cardTemplate.content.cloneNode(true);
    card.querySelector("h3").textContent = store.name;
    card.querySelector(".address").textContent = store.address;
    card.querySelector(".distance").textContent = store.miles ? `${store.miles.toFixed(1)} miles away` : "Distance: enable location";
    card.querySelector(".store-photo").src = store.image;
    card.querySelector(".website").href = store.website;
    card.querySelector(".directions").href = googleMapsDirections(store.lat, store.lng);
    card.querySelector(".streetview").href = streetViewLink(store.lat, store.lng);
    card.querySelector(".store-card").addEventListener("click", () => focusStore(store));
    storeList.append(card);
  });
}

function renderSortedByOrigin() {
  return filteredStores().map((s) => ({ ...s, miles: currentOrigin ? haversineMiles(currentOrigin, s) : null })).sort((a, b) => (a.miles ?? 999) - (b.miles ?? 999));
}
function buildTour(curated = false) {
  if (!currentOrigin) { statusEl.textContent = "Use your location first, then build a thrift tour."; return; }
  const selected = (curated ? renderSortedByOrigin().slice(0, 3) : renderSortedByOrigin().slice(0, 4));
  const points = [[currentOrigin.lat, currentOrigin.lng], ...selected.map((s) => [s.lat, s.lng])];
  clearRoute();
  routeLine = L.polyline(points, { color: curated ? "#9333ea" : "#dc2626", weight: 4 }).addTo(map);
  map.fitBounds(routeLine.getBounds(), { padding: [40, 40] });
  statusEl.textContent = `${curated ? "Curated Thrift Tour" : "Custom Thrift Tour"}: ${selected.map((s) => s.name).join(" → ")}`;
}

document.getElementById("locateBtn").addEventListener("click", () => {
  if (!navigator.geolocation) { statusEl.textContent = "Geolocation is not supported in this browser."; return; }
  statusEl.textContent = "Finding your location...";
  navigator.geolocation.getCurrentPosition((position) => {
    currentOrigin = { lat: position.coords.latitude, lng: position.coords.longitude };
    if (userMarker) map.removeLayer(userMarker);
    userMarker = L.marker([currentOrigin.lat, currentOrigin.lng]).addTo(map).bindPopup("You are here");
    map.setView([currentOrigin.lat, currentOrigin.lng], 13);
    renderStores(currentOrigin);
    statusEl.textContent = "Stores sorted by distance from your location.";
  }, () => { statusEl.textContent = "Location access was denied. Showing all stores."; });
});

preferenceSelect.addEventListener("change", () => renderStores(currentOrigin));
tourBtn.addEventListener("click", () => buildTour(false));
curatedBtn.addEventListener("click", () => buildTour(true));
renderStores(null);
