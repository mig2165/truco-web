export function getApiBaseUrl(): string {
    return import.meta.env.VITE_API_URL
        || (window.location.port === '5000' ? 'http://localhost:3001' : window.location.origin);
}
