// Basic API wrappers to call backend
// Assuming backend runs on same origin or set proper baseURL.

const BASE_URL = process.env.REACT_APP_API_BASE_URL || '';

export async function getRandomLocation() {
    const resp = await fetch(`${BASE_URL}/random-location`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({})
    });
    return resp.json();
}

export async function likeLocation(location_id) {
    const resp = await fetch(`${BASE_URL}/like`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ location_id })
    });
    return resp.json();
}

export async function getLeaderboard(page = 1, page_size = 10) {
    const resp = await fetch(`${BASE_URL}/leaderboard`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ page, page_size })
    });
    return resp.json();
}

export async function getMapLikes() {
    const resp = await fetch(`${BASE_URL}/map-likes`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({})
    });
    return resp.json();
}

export async function getLocationDescription(location_id) {
    const resp = await fetch(`${BASE_URL}/location-description`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ location_id })
    });
    return resp.json();
}
