import { writable } from 'svelte/store';
export const config = writable<any>(undefined);
export const WEBUI_NAME = writable('Open WebUI');
export const models = writable<{id:string}[]>([]);
export const resultMessage = writable<any>({content:'Сохранённый разбор договора',model:{id:'legal_workflows.contract_review'},done:true,sources:[]});
export const user = writable<any>(null);
