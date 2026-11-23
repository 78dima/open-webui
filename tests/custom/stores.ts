import { writable } from 'svelte/store';
export const config = writable<any>(undefined);
export const WEBUI_NAME = writable('Open WebUI');
export const models = writable<{id:string}[]>([]);
export const resultMessage = writable<any>({content:'Сохранённый разбор договора',model:{id:'legal_workflows.contract_review'},done:true,sources:[]});
export const user = writable<any>(null);
export const settings = writable<any>({});
// панель чата: пункт «Дела» ведёт себя как соседние пункты (на телефоне после перехода панель закрыта)
export const mobile = writable(false);
export const showSidebar = writable(true);
export const chatId = writable('chat-1');
// «Мои дела»: окно «Создать папку» обновляет то же хранилище папок, что боковая панель чата
export const folders = writable<any[]>([]);
// сцена чата (Ф-1, Н-2): StructuredOutputRenderer тянет за собой разметку ответа (код, файлы вывода, упоминания,
// эмодзи) — её хранилища на стенде пусты (Д-10 живой проверки 23.11)
export const channels = writable<any[]>([]);
export const pyodideWorker = writable<any>(null);
export const selectedTerminalId = writable<any>(null);
export const shortCodesToEmojis = writable<Record<string, string>>({});
export const showFileNavPath = writable<any>(null);
export const showTabs = writable(false);
export const skills = writable<any[]>([]);
export const terminalServers = writable<any[]>([]);
export const terminalSkills = writable<any[]>([]);
export const visibleControls = writable(false);
