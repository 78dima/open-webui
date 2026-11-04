import { readable } from 'svelte/store';
export const page = readable({ url: new URL(location.href), params: {} });
export const navigating = readable(null);
export const updated = readable(false);
