// ai-dvokat: знак «не прочитан» у вложения чата (пакет 23.11, Д-6; правка по выкладке пакета 1): юрист видит понятную
// причину словами, сырую ошибку разбора (у Docling — английский текст с хэшем) — нет.
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import ru from './locales/ru-RU.json';
import { isUnread, unreadReason } from './fileUnread';
import FileUnread from '../components/custom/FileUnread.svelte';

const RAW =
	'Error calling Docling: conversion status failure - 9f2c1e7a4b: PdfiumError: Failed to load document (PDFium: Data format error).';

describe('причина «не прочитан» — словами для юриста', () => {
	it('подсказка и сообщение — без сырой ошибки и без подстановки ошибки', () => {
		for (const t of [unreadReason(), ru.file_unread.toast]) {
			expect(t).not.toContain('{error}');
			expect(t.replace('{name}', '')).not.toMatch(/[A-Za-z]{3,}/); // ни английских слов, ни хэша
			expect(t).toMatch(/пересохраните/i);
		}
		expect(unreadReason()).toBe(ru.file_unread.reason);
		expect(unreadReason()).toContain('файл повреждён или не читается');
		// Ф-10: сообщение — теми же словами, что подсказка: не утверждает «повреждён», оговорка про сбой распознавания
		const caveat = 'повреждён или не читается (или сервис распознавания был недоступен)';
		expect(unreadReason()).toContain(caveat);
		expect(ru.file_unread.toast).toContain(caveat);
		expect(ru.file_unread.toast).toMatch(/сообщите администратору/);
	});
	it('знак есть, пока у вложения ошибка разбора; текста ошибки в разметке нет', () => {
		expect(isUnread(RAW)).toBe(true);
		expect(isUnread('')).toBe(false);
		expect(isUnread(undefined)).toBe(false);
		const body = render(FileUnread, { props: { error: RAW } }).body;
		expect(body).toContain('data-testid="file-item-error"');
		expect(body).toContain(ru.file_unread.mark);
		expect(body).not.toContain('Docling');
		expect(body).not.toContain('9f2c1e7a4b');
		expect(render(FileUnread, { props: { error: '' } }).body).not.toContain('file-item-error');
	});
});
