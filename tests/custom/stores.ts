import { writable } from 'svelte/store';
export const config = writable<any>(undefined);
export const WEBUI_NAME = writable('Open WebUI');
export const models = writable<{id:string}[]>([]);
