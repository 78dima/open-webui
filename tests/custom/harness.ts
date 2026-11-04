import { mount } from 'svelte';
import Hello from '../../src/lib/components/custom/Hello.svelte';
import { config, models, resultMessage } from './stores';
import '../../src/custom.css';
(window as any).setConfig = (value: unknown) => config.set(value);
mount(Hello, { target: document.querySelector('#app')! });

import BrandHarness from './BrandHarness.svelte';
if (location.search === '?brand') mount(BrandHarness, { target: document.querySelector('#app')! });

import StartHarness from './StartHarness.svelte';
(window as any).setModels = (value: {id: string}[]) => models.set(value);
if (location.search === '?start') mount(StartHarness, { target: document.querySelector('#app')! });

import ResultHarness from './ResultHarness.svelte';
(window as any).setMessage = (value: unknown) => resultMessage.set(value);
if (location.search === '?result') mount(ResultHarness, { target: document.querySelector('#app')! });

import { user } from './stores';
(window as any).setUser = (value: unknown) => user.set(value);

import RendererHarness from './RendererHarness.svelte';
if (location.search === '?renderer') mount(RendererHarness, { target: document.querySelector('#app')! });

import ResponseHarness from './ResponseHarness.svelte';
if (location.search === '?response') mount(ResponseHarness, { target: document.querySelector('#app')! });
