import { test, expect } from '@playwright/test';
const actions = [
 ['Консультация', 'jurist-rf', 'правовом вопросе'],
 ['Разбор договора', 'legal_workflows.contract_review', 'Сторона:'],
 ['Сравнение редакций', 'legal_workflows.compare_versions', 'две прикреплённые'],
 ['Правовое заключение', 'legal_workflows.legal_opinion', 'Вопрос:'],
 ['Документ по шаблону', 'legal_workflows.draft_document', 'Тип:'],
 ['Чистовик по правкам', 'legal_workflows.clean_copy', 'Чужие:']
];
test('six actions select available models and populate drafts without a request', async ({ page }) => {
 await page.goto('/?start');
 await page.waitForFunction(() => typeof (window as any).setModels === 'function');
 await expect(page.getByTestId('custom-start')).toHaveCount(0);
 await page.evaluate(() => (window as any).setConfig({custom_ui:{start:'true'}}));
 await expect(page.getByTestId('custom-start')).toHaveCount(0);
 await page.evaluate(() => (window as any).setConfig({custom_ui:{start:true}}));
 for (const [name] of actions) await expect(page.getByRole('button', {name,exact:true})).toBeDisabled();
 await page.evaluate(ids => (window as any).setModels(ids.map(id => ({id}))), actions.map(a => a[1]));
 const requests: string[] = [];
 page.on('request', req => { if (req.method() === 'POST') requests.push(req.url()); });
 for (const [name, model, field] of actions) {
  await page.getByRole('button', {name,exact:true}).click();
  await expect(page.getByTestId('selected-model')).toHaveText(model);
  await expect(page.getByRole('textbox', {name:'Черновик'})).toHaveValue(new RegExp(field));
 }
 expect(requests).toEqual([]);
 await page.evaluate(() => (window as any).setConfig({custom_ui:{start:false}}));
 await expect(page.getByTestId('custom-start')).toHaveCount(0);
});
