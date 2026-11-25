/**
 * Tests van de schermen van de module Beheer.
 */
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { beheerRoutes } from './routes';
import BouwstenenScreen from './bouwstenen-screen.vue';

describe('module Beheer', () => {
  it('heeft het overzicht van de bouwstenen op /bouwstenen/', () => {
    expect(beheerRoutes.map((route) => route.path)).toEqual(['/bouwstenen/']);
  });

  it('toont het overzicht van de bouwstenen met een kop', () => {
    const wrapper = mount(BouwstenenScreen);
    expect(wrapper.find('h2').text()).toBe('Bouwstenen');
  });
});
