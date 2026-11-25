/**
 * Tests van de bouwstenen deel 2: teksteditor (met de hulpfuncties), fotokiezer en uploadveld.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import RichTextEditor from './rich-text-editor.vue';
import PhotoPicker from './photo-picker.vue';
import UploadField from './upload-field.vue';
import { currentBlock, editingSupported, isSafeLink, linkHtml, nodesFromHtml, pastedHtml } from './rich-text-tools';
import { ApiError } from '../api/client';

/** Opdrachten die de nagebootste `execCommand` kreeg. */
let commands: Array<[string, string | undefined]> = [];

/**
 * Bootst `execCommand` na (jsdom kent het niet): onthoudt de opdracht en voegt bij `insertHTML` de HTML achteraan het
 * bewerkvak toe, zodat de editor iets heeft om op te schonen.
 * @param command Opdracht.
 * @param _showUi Niet gebruikt.
 * @param value Waarde.
 * @returns Altijd true.
 */
function fakeExecCommand(command: string, _showUi?: boolean, value?: string): boolean {
  commands.push([command, value]);
  const box = document.querySelector('.rich-editor__content');
  if (command === 'insertHTML' && box && value) box.append(...new DOMParser().parseFromString(value, 'text/html').body.childNodes);
  return true;
}

beforeEach(() => {
  commands = [];
  Object.defineProperty(document, 'execCommand', { value: fakeExecCommand, configurable: true, writable: true });
  Object.defineProperty(document, 'queryCommandState', { value: (command: string) => command === 'bold', configurable: true, writable: true });
});

/**
 * De HTML van de inhoud van een element, zonder `innerHTML` (verboden door de lintregel).
 * @param element Het element.
 * @returns De HTML.
 */
function markupOf(element: Element): string {
  const serializer = new XMLSerializer();
  return Array.from(element.childNodes, (node) => serializer.serializeToString(node).replace(/ xmlns="[^"]*"/g, '').replace(/<br \/>/g, '<br>')).join('');
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('hulpfuncties van de teksteditor', () => {
  it('schoont opgeslagen en geplakte HTML op', () => {
    const nodes = nodesFromHtml('<p onclick="x()">Hallo <b>wereld</b></p><script>alert(1)</script>');
    const box = document.createElement('div');
    box.append(...nodes);
    expect(markupOf(box)).toBe('<p>Hallo <strong>wereld</strong></p>');
    expect(pastedHtml('<div><i>schuin</i></div>', 'niet gebruikt')).toBe('<p><em>schuin</em></p>');
    expect(pastedHtml('', 'Regel een\n\nRegel twee')).toContain('<p>Regel een</p>');
    expect(nodesFromHtml('')).toEqual([]);
  });

  it('links: alleen veilige adressen, adres netjes geëscapet', () => {
    expect(isSafeLink('/contact/')).toBe(true);
    expect(isSafeLink('javascript:alert(1)')).toBe(false);
    expect(linkHtml('/zoek/?a=1&b="2"')).toBe('<a href="/zoek/?a=1&amp;b=&quot;2&quot;">/zoek/?a=1&amp;b="2"</a>');
  });

  it('vindt het blok van de cursor binnen het bewerkvak', () => {
    const box = document.createElement('div');
    box.append(...nodesFromHtml('<h2>Kop</h2><p>Tekst</p>'));
    document.body.appendChild(box);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    expect(currentBlock(box)).toBe('');
    const range = document.createRange();
    range.setStart(box.querySelector('h2')!.firstChild!, 1);
    selection.addRange(range);
    expect(currentBlock(box)).toBe('h2');
    range.setStart(box, 0);
    expect(currentBlock(box)).toBe('');
    expect(editingSupported()).toBe(true);
  });
});

describe('rich-text-editor', () => {
  it('vult het bewerkvak opgeschoond, met label, hulp en fout gekoppeld', () => {
    const wrapper = mount(RichTextEditor, { props: { label: 'Omschrijving', help: 'Hulp', error: 'Te kort', required: true, modelValue: '<p>Hoi<img src=x onerror="alert(1)"></p>' }, attachTo: document.body });
    const box = wrapper.find('.rich-editor__content');
    expect(box.attributes('role')).toBe('textbox');
    expect(box.attributes('aria-invalid')).toBe('true');
    expect(box.attributes('aria-required')).toBe('true');
    expect(document.getElementById(box.attributes('aria-labelledby')!)!.textContent).toBe('Omschrijving');
    expect(box.attributes('aria-describedby')!.split(' ')).toHaveLength(2);
    expect(markupOf(box.element)).not.toContain('onerror');
    expect(wrapper.findAll('[role="toolbar"] button')).toHaveLength(11);
  });

  it('knoppen voeren de opdracht uit en tonen hun stand', async () => {
    const wrapper = mount(RichTextEditor, { props: { label: 'Tekst', modelValue: '<h2>Kop</h2>' }, attachTo: document.body });
    const buttons = wrapper.findAll('[role="toolbar"] button');
    await buttons[3]!.trigger('click');
    expect(commands).toContainEqual(['bold', undefined]);
    expect(buttons[3]!.attributes('aria-pressed')).toBe('true');
    await buttons[1]!.trigger('click');
    expect(commands).toContainEqual(['formatBlock', '<h2>']);
    // In een kop zet de knop Kop het blok terug naar een alinea.
    const range = document.createRange();
    range.setStart(wrapper.find('h2').element.firstChild!, 0);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    await buttons[1]!.trigger('click');
    expect(commands).toContainEqual(['formatBlock', '<p>']);
    expect(buttons[1]!.attributes('aria-pressed')).toBe('true');
    expect(buttons[8]!.attributes('aria-pressed')).toBeUndefined();
  });

  it('invoer, plakken en slepen: het model volgt opgeschoond', async () => {
    const wrapper = mount(RichTextEditor, { props: { label: 'Tekst', modelValue: '' }, attachTo: document.body });
    const box = wrapper.find('.rich-editor__content');
    await box.trigger('focus');
    expect(markupOf(box.element)).toBe('<p><br></p>');
    box.element.replaceChildren(...nodesFromHtml('<p>Getypt</p>'));
    await box.trigger('input');
    expect(wrapper.emitted('update:modelValue')!.at(-1)).toEqual(['<p>Getypt</p>']);
    const paste = new Event('paste', { cancelable: true }) as ClipboardEvent;
    Object.defineProperty(paste, 'clipboardData', { value: { getData: (type: string) => (type === 'text/html' ? '<span style="color:red">Rood</span>' : '') } });
    box.element.dispatchEvent(paste);
    expect(paste.defaultPrevented).toBe(true);
    expect(commands.find(([command]) => command === 'insertHTML')![1]).not.toContain('style');
    box.element.dispatchEvent(new Event('paste'));
    const drop = new Event('drop', { cancelable: true }) as DragEvent;
    Object.defineProperty(drop, 'dataTransfer', { value: { files: [new File(['x'], 'a.png')] } });
    box.element.dispatchEvent(drop);
    expect(drop.defaultPrevented).toBe(true);
    box.element.replaceChildren();
    await box.trigger('input');
    expect(markupOf(box.element)).toBe('<p><br></p>');
  });

  it('een nieuwe waarde van buiten vult het bewerkvak opnieuw', async () => {
    const wrapper = mount(RichTextEditor, { props: { label: 'Tekst', modelValue: '<p>Een</p>' } });
    await wrapper.setProps({ modelValue: '<p>Twee</p>' });
    expect(wrapper.find('.rich-editor__content').text()).toBe('Twee');
  });

  it('link: veld onder de knoppen, onveilig adres geweigerd, Escape sluit', async () => {
    const wrapper = mount(RichTextEditor, { props: { label: 'Tekst', modelValue: '<p>Tekst</p>' }, attachTo: document.body });
    const box = wrapper.find('.rich-editor__content');
    await box.trigger('keydown', { key: 'k', ctrlKey: true });
    await flushPromises();
    const address = wrapper.find('.rich-editor__link input');
    expect(document.activeElement).toBe(address.element);
    await address.setValue('javascript:alert(1)');
    await address.trigger('keydown', { key: 'Enter' });
    expect(wrapper.find('.rich-editor__link [role="alert"]').text()).toContain('Dit adres kan niet');
    expect(address.attributes('aria-invalid')).toBe('true');
    await address.trigger('keydown', { key: 'Escape' });
    expect(wrapper.find('.rich-editor__link').exists()).toBe(false);

    // Zonder selectie: het adres wordt de tekst van de link.
    await wrapper.findAll('[role="toolbar"] button')[8]!.trigger('click');
    await flushPromises();
    await wrapper.find('.rich-editor__link input').setValue('/contact/');
    await wrapper.findAll('.rich-editor__link button')[0]!.trigger('click');
    expect(commands).toContainEqual(['insertHTML', '<a href="/contact/">/contact/</a>']);
    expect(wrapper.emitted('update:modelValue')!.at(-1)![0]).toContain('<a href="/contact/">');

    // Met een selectie: van de selectie wordt een link gemaakt.
    const range = document.createRange();
    range.selectNodeContents(box.find('p').element);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    await wrapper.findAll('[role="toolbar"] button')[8]!.trigger('click');
    await flushPromises();
    await wrapper.find('.rich-editor__link input').setValue('https://www.avantareizen.nl/');
    await wrapper.findAll('.rich-editor__link button')[0]!.trigger('click');
    expect(commands).toContainEqual(['createLink', 'https://www.avantareizen.nl/']);

    // Leeg adres of Annuleren sluit zonder link.
    await wrapper.findAll('[role="toolbar"] button')[8]!.trigger('click');
    await wrapper.find('.rich-editor__link input').setValue('  ');
    await wrapper.findAll('.rich-editor__link button')[0]!.trigger('click');
    expect(wrapper.find('.rich-editor__link').exists()).toBe(false);
    await wrapper.findAll('[role="toolbar"] button')[8]!.trigger('click');
    await wrapper.findAll('.rich-editor__link button')[1]!.trigger('click');
    expect(wrapper.find('.rich-editor__link').exists()).toBe(false);
  });

  it('HTML-code: wisselen, wijzigen en terug opgeschoond; label zet de focus', async () => {
    const wrapper = mount(RichTextEditor, { props: { label: 'Tekst', modelValue: '<p>Een</p>', 'onUpdate:modelValue': (value: string) => wrapper.setProps({ modelValue: value }) }, attachTo: document.body });
    await wrapper.find('.field__label span').trigger('click');
    expect(document.activeElement).toBe(wrapper.find('.rich-editor__content').element);
    const source = wrapper.find('.rich-editor__source');
    await source.trigger('click');
    await flushPromises();
    expect(source.attributes('aria-pressed')).toBe('true');
    expect(wrapper.findAll('[role="toolbar"] button')[0]!.attributes('disabled')).toBeDefined();
    const area = wrapper.find('textarea');
    await area.setValue('<p>Twee</p><script>x</script>');
    await wrapper.find('.field__label span').trigger('click');
    expect(document.activeElement).toBe(area.element);
    await source.trigger('click');
    await flushPromises();
    expect(wrapper.find('textarea').exists()).toBe(false);
    expect(markupOf(wrapper.find('.rich-editor__content').element)).toBe('<p>Twee</p>');
    expect(wrapper.props('modelValue')).toBe('<p>Twee</p>');
  });

  it('teller met waarschuwing bij een te lange tekst', async () => {
    const wrapper = mount(RichTextEditor, { props: { label: 'Tekst', modelValue: '<p>Kort</p>', maxlength: 20 } });
    expect(wrapper.find('.rich-editor__count').text()).toBe('11 van 20 tekens (met opmaak)');
    expect(wrapper.find('.rich-editor__warning').text()).toBe('');
    await wrapper.setProps({ modelValue: '<p>Veel te lange tekst</p>' });
    expect(wrapper.find('.rich-editor__count').classes()).toContain('is-over');
    expect(wrapper.find('.rich-editor__warning').text()).toContain('te lang');
  });

  it('zonder execCommand alleen het tekstvak met de HTML', () => {
    Object.defineProperty(document, 'execCommand', { value: undefined, configurable: true, writable: true });
    const wrapper = mount(RichTextEditor, { props: { label: 'Tekst', modelValue: '<p>Een</p>' } });
    expect(wrapper.find('[role="toolbar"]').exists()).toBe(false);
    expect(wrapper.find('textarea').element.value).toBe('<p>Een</p>');
  });
});

describe('photo-picker', () => {
  const photos = [
    { id: 1, url: '/media/a-400.webp', title: 'Fjord', alt: 'Een fjord', meta: 'Noorwegen' },
    { id: 2, url: '/media/b-400.webp', title: 'Berg', alt: 'Een berg', width: 800, height: 600 },
    { id: 3, url: 'https://elders.example/c.jpg', title: 'Extern', alt: '' },
    { id: 4, url: '//elders.example/d.jpg', title: 'Extern 2', alt: '' },
  ];

  it('laadt foto\'s, laat adressen buiten de site weg en kiest één foto', async () => {
    const load = vi.fn(async () => ({ photos, hasMore: true }));
    const wrapper = mount(PhotoPicker, { props: { label: 'Foto', load, modelValue: 2, allowNone: true } });
    await flushPromises();
    expect(load).toHaveBeenCalledWith({ text: '', page: 1 });
    expect(wrapper.find('legend').text()).toBe('Foto');
    const inputs = wrapper.findAll('input[type="radio"]');
    expect(inputs).toHaveLength(2);
    expect((inputs[1]!.element as HTMLInputElement).checked).toBe(true);
    expect(wrapper.find('img').attributes('width')).toBe('400');
    expect(wrapper.find('.media-grid__meta').text()).toBe('Noorwegen');
    await inputs[0]!.setValue(true);
    expect(wrapper.emitted('update:modelValue')!.at(-1)).toEqual([1]);
    await wrapper.find('.crm-actions button').trigger('click');
    expect(wrapper.emitted('update:modelValue')!.at(-1)).toEqual([null]);
  });

  it('meerdere foto\'s met vinkjes', async () => {
    const wrapper = mount(PhotoPicker, { props: { label: 'Foto\'s', load: async () => ({ photos, hasMore: false }), multiple: true, modelValue: [2], allowNone: true } });
    await flushPromises();
    const inputs = wrapper.findAll('input[type="checkbox"]');
    await inputs[0]!.setValue(true);
    expect(wrapper.emitted('update:modelValue')!.at(-1)).toEqual([[2, 1]]);
    await wrapper.setProps({ modelValue: [2, 1] });
    await inputs[1]!.setValue(false);
    expect(wrapper.emitted('update:modelValue')!.at(-1)).toEqual([[1]]);
    await wrapper.find('.crm-actions button').trigger('click');
    expect(wrapper.emitted('update:modelValue')!.at(-1)).toEqual([[]]);
    await wrapper.setProps({ modelValue: null });
    await inputs[0]!.setValue(true);
    expect(wrapper.emitted('update:modelValue')!.at(-1)).toEqual([[1]]);
  });

  it('zoeken begint op pagina 1, bladeren haalt de volgende pagina, een oud antwoord telt niet', async () => {
    const answers: Array<(page: { photos: typeof photos; hasMore: boolean }) => void> = [];
    const load = vi.fn(() => new Promise<{ photos: typeof photos; hasMore: boolean }>((resolve) => { answers.push(resolve); }));
    const wrapper = mount(PhotoPicker, { props: { label: 'Foto', load } });
    await wrapper.vm.$nextTick();
    expect(wrapper.find('[role="status"]').text()).toContain('laden');
    answers[0]!({ photos, hasMore: true });
    await flushPromises();
    await wrapper.find('.crm-pager button').trigger('click');
    expect(load).toHaveBeenLastCalledWith({ text: '', page: 2 });
    await wrapper.find('input[type="search"]').setValue('  fjord  ');
    await wrapper.find('input[type="search"]').trigger('keydown', { key: 'Enter' });
    expect(load).toHaveBeenLastCalledWith({ text: 'fjord', page: 1 });
    answers[2]!({ photos: [photos[0]!], hasMore: false });
    answers[1]!({ photos, hasMore: true });
    await flushPromises();
    expect(wrapper.findAll('input[type="radio"]')).toHaveLength(1);
    await wrapper.find('.crm-search button').trigger('click');
    answers[3]!({ photos: [], hasMore: false });
    await flushPromises();
    expect(wrapper.text()).toContain('Geen foto\'s gevonden');
    expect(wrapper.find('.crm-actions').exists()).toBe(false);
  });

  it('fout bij het laden: melding van de server of een algemene', async () => {
    const wrapper = mount(PhotoPicker, { props: { label: 'Foto', load: async () => { throw new ApiError(403, 'geen-toegang', 'Geen toegang.'); } } });
    await flushPromises();
    expect(wrapper.find('[role="alert"]').text()).toBe('Geen toegang.');
    expect(wrapper.text()).not.toContain('Geen foto\'s gevonden');
    const other = mount(PhotoPicker, { props: { label: 'Foto', load: async () => { throw new Error('stuk'); } } });
    await flushPromises();
    expect(other.find('[role="alert"]').text()).toContain('konden niet worden geladen');
  });

  it('een oude fout die later binnenkomt telt niet', async () => {
    const answers: Array<{ resolve: (page: { photos: typeof photos; hasMore: boolean }) => void; reject: (error: Error) => void }> = [];
    const load = () => new Promise<{ photos: typeof photos; hasMore: boolean }>((resolve, reject) => { answers.push({ resolve, reject }); });
    const wrapper = mount(PhotoPicker, { props: { label: 'Foto', load } });
    await wrapper.find('.crm-search button').trigger('click');
    answers[1]!.resolve({ photos, hasMore: false });
    answers[0]!.reject(new Error('te laat'));
    await flushPromises();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(wrapper.findAll('input[type="radio"]')).toHaveLength(2);
  });
});

describe('upload-field', () => {
  /**
   * Zet bestanden in het bestandsveld en stuurt `change`.
   * @param input Het veld.
   * @param files De bestanden.
   */
  async function choose(input: HTMLInputElement, files: File[]): Promise<void> {
    Object.defineProperty(input, 'files', { value: files, configurable: true });
    input.dispatchEvent(new Event('change'));
    await flushPromises();
  }

  const jpeg = (name: string, size = 10) => new File([new Uint8Array(size)], name, { type: 'image/jpeg' });

  it('label, hulp en fout gekoppeld; zonder bestand een melding', async () => {
    const upload = vi.fn(async () => ({}));
    const wrapper = mount(UploadField, { props: { label: 'Foto', help: 'JPEG', upload } });
    const input = wrapper.find('input[type="file"]');
    expect(wrapper.find('label').attributes('for')).toBe(input.attributes('id'));
    expect(input.attributes('name')).toBe('bestand');
    await wrapper.find('button').trigger('click');
    expect(wrapper.find('[role="alert"]').text()).toBe('Kies eerst een bestand.');
    expect(input.attributes('aria-describedby')!.split(' ')).toHaveLength(2);
    expect(input.attributes('aria-invalid')).toBe('true');
    expect(upload).not.toHaveBeenCalled();
    await wrapper.setProps({ multiple: true });
    await wrapper.find('button').trigger('click');
    expect(wrapper.find('[role="alert"]').text()).toBe('Kies eerst een of meer bestanden.');
  });

  it('controleert soort, grootte en aantal vóór het uploaden', async () => {
    const upload = vi.fn(async () => ({}));
    const wrapper = mount(UploadField, { props: { label: 'Foto', accept: 'image/jpeg, image/png', maxBytes: 2 * 1024 * 1024, upload } });
    const input = wrapper.find('input').element as HTMLInputElement;
    await choose(input, [new File(['x'], 'tekst.txt', { type: 'text/plain' })]);
    expect(wrapper.find('[role="alert"]').text()).toBe('tekst.txt is geen toegestaan soort bestand.');
    await choose(input, [jpeg('groot.jpg', 3 * 1024 * 1024 + 300 * 1024)]);
    expect(wrapper.find('[role="alert"]').text()).toBe('groot.jpg is te groot (3,3 MB); hoogstens 2 MB.');
    await choose(input, [jpeg('a.jpg'), jpeg('b.jpg')]);
    expect(wrapper.find('[role="alert"]').text()).toBe('Kies hoogstens 1 bestanden tegelijk.');
    await wrapper.find('button').trigger('click');
    expect(upload).not.toHaveBeenCalled();
    await wrapper.setProps({ multiple: true, maxFiles: 2, accept: 'image/*' });
    await choose(input, [jpeg('a.jpg', 2048), jpeg('b.jpg', 10)]);
    expect(wrapper.find('[role="alert"]').text()).toBe('');
    expect(wrapper.findAll('.crm-upload__files li').map((item) => item.text())).toEqual(['a.jpg (2 kB)', 'b.jpg (1 kB)']);
    await wrapper.setProps({ accept: '' });
    await choose(input, [new File(['x'], 'iets.bin')]);
    expect(wrapper.find('[role="alert"]').text()).toBe('');
  });

  it('uploadt als FormData, toont bezig en meldt het resultaat', async () => {
    let finish: (value: unknown) => void = () => {};
    const upload = vi.fn((_form: FormData) => new Promise((resolve) => { finish = resolve; }));
    const wrapper = mount(UploadField, { props: { label: 'Foto', name: 'foto', multiple: true, upload } });
    const input = wrapper.find('input').element as HTMLInputElement;
    await choose(input, [jpeg('a.jpg'), jpeg('b.jpg')]);
    await wrapper.find('button').trigger('click');
    expect(wrapper.find('button').text()).toBe('Bezig met uploaden…');
    expect(wrapper.find('button').attributes('disabled')).toBeDefined();
    const form = upload.mock.calls[0]![0];
    expect(form.getAll('foto').map((file) => (file as File).name)).toEqual(['a.jpg', 'b.jpg']);
    finish({ aantal: 2 });
    await flushPromises();
    expect(wrapper.emitted('uploaded')).toEqual([[{ aantal: 2 }]]);
    expect(wrapper.find('button').text()).toBe('Uploaden');
    expect(wrapper.find('.crm-upload__files').exists()).toBe(false);
  });

  it('fout van de server: eerst de melding per veld, anders de melding of een algemene', async () => {
    const failures = [
      new ApiError(400, 'ongeldig', 'Controleer de invoer.', { fields: { foto: 'Dit is geen foto.' } }),
      new ApiError(413, 'te-groot', 'Het verzoek is te groot.'),
      new Error('stuk'),
    ];
    const upload = vi.fn(async () => { throw failures.shift(); });
    const wrapper = mount(UploadField, { props: { label: 'Foto', upload, submitLabel: 'Foto toevoegen' } });
    const input = wrapper.find('input').element as HTMLInputElement;
    await choose(input, [jpeg('a.jpg')]);
    expect(wrapper.find('button').text()).toBe('Foto toevoegen');
    for (const expected of ['Dit is geen foto.', 'Het verzoek is te groot.', 'Het uploaden is mislukt. Probeer het opnieuw.']) {
      await wrapper.find('button').trigger('click');
      await flushPromises();
      expect(wrapper.find('[role="alert"]').text()).toBe(expected);
    }
  });
});
