import { mount } from 'svelte';
import Hello from '../../src/lib/components/custom/Hello.svelte';
import { config, models, resultMessage } from './stores';
import '../../src/custom.css';
(window as any).setConfig = (value: unknown) => config.set(value);
mount(Hello, { target: document.querySelector('#app')! });

import BrandHarness from './BrandHarness.svelte';
if (location.search === '?brand') mount(BrandHarness, { target: document.querySelector('#app')! });

import StartHarness from './StartHarness.svelte';
(window as any).setModels = (value: { id: string }[]) => models.set(value);
if (location.search === '?start') mount(StartHarness, { target: document.querySelector('#app')! });

import ResultHarness from './ResultHarness.svelte';
(window as any).setMessage = (value: unknown) => resultMessage.set(value);
if (location.search === '?result')
	mount(ResultHarness, { target: document.querySelector('#app')! });

import VisibilityHarness from './VisibilityHarness.svelte';
import { user } from './stores';
(window as any).setUser = (value: unknown) => user.set(value);
if (location.search === '?visibility')
	mount(VisibilityHarness, { target: document.querySelector('#app')! });

import ToolStatusHarness from './ToolStatusHarness.svelte';
if (location.search === '?tool-status')
	mount(ToolStatusHarness, { target: document.querySelector('#app')! });

import CaseHarness from './CaseHarness.svelte';
import CasePageHarness from './CasePageHarness.svelte';
if (location.search.startsWith('?casepage='))
	mount(CasePageHarness, { target: document.querySelector('#app')! });
else if (location.search.startsWith('?case') && !location.search.startsWith('?cases-link'))
	mount(CaseHarness, { target: document.querySelector('#app')! });

import CasesLink from '../../src/lib/components/custom/CasesLink.svelte';
// `?cases-link` — развёрнутая панель, `?cases-link=rail` — свёрнутая (значок); состояние панели — в окне стенда
import { chatId, mobile, showSidebar } from './stores';
import { get } from 'svelte/store';
(window as any).sidebar = {
	mobile: (on: boolean) => mobile.set(on),
	state: () => ({ shown: get(showSidebar), chat: get(chatId) })
};
if (location.search === '?cases-link')
	mount(CasesLink, { target: document.querySelector('#app')! });
if (location.search === '?cases-link=rail')
	mount(CasesLink, { target: document.querySelector('#app')!, props: { variant: 'rail' } });
