const fallbackStores = [
  {
    name: "Goodwill - Lancaster",
    address: "3535 Lancaster Dr NE, Salem, OR",
    website: "https://meetgoodwill.org/",
    image: "https://source.unsplash.com/800x450/?thrift,store",
    lat: 44.9729,
    lng: -123.0241,
    category: "Thrift"
  }
];

async function loadStores() {
  const response = await fetch("stores.json", { cache: "no-store" });
  if (!response.ok) throw new Error("Failed to load stores.json");
  const data = await response.json();
  if (!Array.isArray(data)) throw new Error("Invalid stores.json");
  return data;
}

const geocodeCacheKey = "salem-thrift-geocode-cache-v1";

function loadGeocodeCache() {
  try { return JSON.parse(localStorage.getItem(geocodeCacheKey) || "{}"); }
  catch { return {}; }
}
function saveGeocodeCache(cache) {
  localStorage.setItem(geocodeCacheKey, JSON.stringify(cache));
}
async function geocodeAddress(address) {
  const q = new URLSearchParams({ q: address, format: "json", limit: "1" });
  const res = await fetch(`https://nominatim.openstreetmap.org/search?${q.toString()}`, {
    headers: { Accept: "application/json" }
  });
  if (!res.ok) throw new Error("Geocode failed");
  const rows = await res.json();
  if (!rows.length) throw new Error("No geocode result");
  return { lat: Number(rows[0].lat), lng: Number(rows[0].lon) };
}
async function ensureStoreCoordinates(inputStores) {
  const cache = loadGeocodeCache();
  const out = [];
  for (const s of inputStores) {
    if (typeof s.lat === "number" && typeof s.lng === "number") { out.push(s); continue; }
    if (cache[s.address]) { out.push({ ...s, ...cache[s.address] }); continue; }
    try {
      const coords = await geocodeAddress(s.address);
      cache[s.address] = coords;
      out.push({ ...s, ...coords });
    } catch {
      out.push({ ...s, lat: 44.9429, lng: -123.0351 });
    }
  }
  saveGeocodeCache(cache);
  return out;
}

let stores = [];

const map = L.map("map").setView([44.9429, -123.0351], 12);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19, attribution: "&copy; OpenStreetMap"
}).addTo(map);

const storeList = document.getElementById("storeList");
const cardTemplate = document.getElementById("storeCardTemplate");
const statusEl = document.getElementById("status");
const preferenceSelect = document.getElementById("preferenceSelect");
const tourBtn = document.getElementById("tourBtn");
const curatedBtn = document.getElementById("curatedBtn");

let currentOrigin = null;
let userMarker;
let routeLine;
const markers = new Map();

function haversineMiles(a, b) {
  const R = 3958.8, tr = (x) => x * Math.PI / 180;
  const dLat = tr(b.lat - a.lat), dLng = tr(b.lng - a.lng);
  const x = Math.sin(dLat/2)**2 + Math.cos(tr(a.lat))*Math.cos(tr(b.lat))*Math.sin(dLng/2)**2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
function googleMapsDirections(lat, lng) { return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`; }
function streetViewLink(lat, lng) { return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}`; }
function focusStore(s) { map.setView([s.lat, s.lng], 15); markers.get(s.name)?.openPopup(); }

function filteredStores() {
  const category = preferenceSelect.value;
  if (category === "all") return [...stores];
  return stores.filter((s) => s.category === category);
}
function clearRoute() {
  if (routeLine) { map.removeLayer(routeLine); routeLine = null; }
}
function renderStores(origin) {
  storeList.innerHTML = "";
  markers.forEach((m) => map.removeLayer(m));
  markers.clear();
  clearRoute();

  const sorted = filteredStores()
    .map((s) => ({ ...s, miles: origin ? haversineMiles(origin, s) : null }))
    .sort((a, b) => (a.miles ?? 999) - (b.miles ?? 999));

  for (const store of sorted) {
    const marker = L.marker([store.lat, store.lng]).addTo(map);
    marker.bindPopup(`<strong>${store.name}</strong><br/>${store.address}`);
    marker.on("click", () => focusStore(store));
    markers.set(store.name, marker);

    const card = cardTemplate.content.cloneNode(true);
    card.querySelector("h3").textContent = store.name;
    card.querySelector(".address").textContent = `${store.category || "Thrift"} • ${store.address}`;
    card.querySelector(".distance").textContent = store.miles ? `${store.miles.toFixed(1)} miles away` : "Distance: enable location";
    card.querySelector(".store-photo").src = store.image || "https://source.unsplash.com/800x450/?thrift,store";
    card.querySelector(".website").href = store.website || "#";
    card.querySelector(".directions").href = googleMapsDirections(store.lat, store.lng);
    card.querySelector(".streetview").href = streetViewLink(store.lat, store.lng);
    card.querySelector(".store-card").addEventListener("click", () => focusStore(store));
    storeList.append(card);
  }
}

function sortedFromOrigin() {
  return filteredStores()
    .map((s) => ({ ...s, miles: currentOrigin ? haversineMiles(currentOrigin, s) : null }))
    .sort((a, b) => (a.miles ?? 999) - (b.miles ?? 999));
}
function buildTour(curated = false) {
  if (!currentOrigin) { statusEl.textContent = "Use your location first, then build a thrift tour."; return; }
  const pick = curated ? sortedFromOrigin().slice(0, 3) : sortedFromOrigin().slice(0, 4);
  const points = [[currentOrigin.lat, currentOrigin.lng], ...pick.map((s) => [s.lat, s.lng])];
  clearRoute();
  routeLine = L.polyline(points, { color: curated ? "#9333ea" : "#dc2626", weight: 4 }).addTo(map);
  map.fitBounds(routeLine.getBounds(), { padding: [40, 40] });
  statusEl.textContent = `${curated ? "Curated" : "Custom"} Thrift Tour: ${pick.map((s) => s.name).join(" → ")}`;
}

document.getElementById("locateBtn").addEventListener("click", () => {
  if (!navigator.geolocation) { statusEl.textContent = "Geolocation not supported."; return; }
  statusEl.textContent = "Finding your location...";
  navigator.geolocation.getCurrentPosition((pos) => {
    currentOrigin = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    if (userMarker) map.removeLayer(userMarker);
    userMarker = L.marker([currentOrigin.lat, currentOrigin.lng]).addTo(map).bindPopup("You are here");
    map.setView([currentOrigin.lat, currentOrigin.lng], 13);
    renderStores(currentOrigin);
    statusEl.textContent = "Stores sorted by distance.";
  }, () => statusEl.textContent = "Location denied. Showing all stores.");
});

preferenceSelect.addEventListener("change", () => renderStores(currentOrigin));
tourBtn.addEventListener("click", () => buildTour(false));
curatedBtn.addEventListener("click", () => buildTour(true));

(async function init() {
  try {
    const loaded = await loadStores();
    stores = await ensureStoreCoordinates(loaded);
  } catch {
    stores = fallbackStores;
  }
  renderStores(null);
})();
