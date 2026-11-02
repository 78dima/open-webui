import { mount } from 'svelte';
import Hello from '../../src/lib/components/custom/Hello.svelte';
import { config } from './stores';
import '../../src/custom.css';
(window as any).setConfig = (value: unknown) => config.set(value);
mount(Hello, { target: document.querySelector('#app')! });

import BrandHarness from './BrandHarness.svelte';
if (location.search === '?brand') mount(BrandHarness, { target: document.querySelector('#app')! });
