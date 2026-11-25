/**
 * Proef van fase V1: de opschoner van de bestaande teksteditor (`app/public/js/rich-text-clean.js`, die de server ook
 * in zijn tests gebruikt) is in de frontend te importeren, zodat de teksteditor in Vue (V1.5) dezelfde regels houdt.
 */
import { describe, expect, it } from 'vitest';
import richTextClean from '../../../public/js/rich-text-clean.js';

describe('opschoner van de teksteditor in de frontend', () => {
  it('schoont HTML op met dezelfde regels als in het CRM', () => {
    const parsed = new DOMParser().parseFromString('<p>Hallo <b>wereld</b><script>alert(1)</script></p><div onclick="x()">Los</div>', 'text/html');
    expect(richTextClean.cleanNodes(parsed.body.childNodes)).toBe('<p>Hallo <strong>wereld</strong></p><p>Los</p>');
  });

  it('weigert een javascript-link', () => {
    expect(richTextClean.isSafeUrl('javascript:alert(1)')).toBe(false);
    expect(richTextClean.isSafeUrl('https://www.avantareizen.nl/')).toBe(true);
  });
});
