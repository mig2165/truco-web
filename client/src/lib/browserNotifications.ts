export type BrowserNotificationPermission = 'default' | 'granted' | 'denied';

export function isBrowserNotificationSupported(): boolean {
    return typeof window !== 'undefined' && 'Notification' in window;
}

export function getBrowserNotificationPermission(): BrowserNotificationPermission {
    if (!isBrowserNotificationSupported()) {
        return 'denied';
    }
    return Notification.permission as BrowserNotificationPermission;
}

export async function requestBrowserNotificationPermission(): Promise<BrowserNotificationPermission> {
    if (!isBrowserNotificationSupported()) {
        return 'denied';
    }
    const result = await Notification.requestPermission();
    return result as BrowserNotificationPermission;
}

export function sendBrowserNotification(options: { title: string; body: string; tag: string }): Notification | null {
    if (!isBrowserNotificationSupported() || getBrowserNotificationPermission() !== 'granted') {
        return null;
    }
    return new Notification(options.title, { body: options.body, tag: options.tag });
}
