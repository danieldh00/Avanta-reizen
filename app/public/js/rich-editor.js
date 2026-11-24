/**
 * Teksteditor (WYSIWYG) voor opgemaakte tekst in het CRM: elk `textarea.cms-richtext` (tekstblokken van pagina's en
 * blog, reisomschrijving, reistypes en landen, reisleiders, FAQ) krijgt een bewerkvak waarin je de tekst ziet zoals op
 * de site. Enter begint een nieuwe alinea, Shift+Enter een nieuwe regel; knoppen voor kopjes, vet, cursief, lijsten,
 * citaat en links. Met de knop *HTML* zie en wijzig je de code zelf.
 *
 * Het tekstvak blijft het formulierveld: de editor zet de opgeschoonde HTML (`rich-text-clean.js`) er bij elke wijziging
 * en vlak voor het versturen in. Zonder JavaScript blijft het gewone tekstvak met HTML staan. De server schoont de
 * HTML bij het opslaan altijd zelf op met een allowlist; dit script is gemak, geen beveiliging. Er komt nooit
 * ongeschoonde HTML in de pagina: opgeslagen en geplakte HTML gaat eerst door een inert document (`DOMParser`) en de
 * opschoner, pas daarna in de editor.
 */
document.addEventListener('DOMContentLoaded', function setupRichEditors() {
  'use strict';
  const clean = window.AvantaRichText;
  if (!clean || typeof document.execCommand !== 'function') return;

  /** De knoppen: opdracht voor `execCommand`, waarde en of de knop een aan/uit-stand toont. */
  const TOOLS = [
    { label: 'Alinea', title: 'Gewone tekst', command: 'formatBlock', value: 'p', block: 'p' },
    { label: 'Kop', title: 'Kop (groot)', command: 'formatBlock', value: 'h2', block: 'h2' },
    { label: 'Tussenkop', title: 'Tussenkop (kleiner)', command: 'formatBlock', value: 'h3', block: 'h3' },
    { label: 'Vet', title: 'Vet (Ctrl+B)', command: 'bold', state: true },
    { label: 'Cursief', title: 'Cursief (Ctrl+I)', command: 'italic', state: true },
    { label: 'Opsomming', title: 'Lijst met bolletjes', command: 'insertUnorderedList', state: true },
    { label: 'Nummering', title: 'Genummerde lijst', command: 'insertOrderedList', state: true },
    { label: 'Citaat', title: 'Citaat', command: 'formatBlock', value: 'blockquote', block: 'blockquote' },
    { label: 'Link', title: 'Link toevoegen (Ctrl+K)', link: true },
    { label: 'Link weg', title: 'Link weghalen', command: 'unlink' },
  ];

  /**
   * Zet HTML-tekst om naar opgeschoonde knopen voor de editor, via een inert document.
   * @param {string} markup HTML.
   * @returns {Node[]} Knopen, klaar om in de editor te zetten.
   */
  function nodesFromHtml(markup) {
    const parser = new DOMParser();
    const cleaned = clean.cleanNodes(parser.parseFromString(String(markup || ''), 'text/html').body.childNodes);
    return Array.prototype.map.call(parser.parseFromString(cleaned, 'text/html').body.childNodes, (node) => document.importNode(node, true));
  }

  /**
   * Geeft het blokelement (alinea, kop, citaat) waarin de cursor staat, binnen de editor.
   * @param {HTMLElement} editor Bewerkvak.
   * @returns {string} Tagnaam in kleine letters, of ''.
   */
  function currentBlock(editor) {
    const selection = window.getSelection();
    let node = selection && selection.rangeCount ? selection.getRangeAt(0).startContainer : null;
    while (node && node !== editor) {
      if (node.nodeType === 1 && /^(P|H2|H3|H4|H5|BLOCKQUOTE|LI)$/.test(node.tagName)) return node.tagName.toLowerCase();
      node = node.parentNode;
    }
    return '';
  }

  Array.prototype.forEach.call(document.querySelectorAll('textarea.cms-richtext'), (area) => {
    const label = area.id ? document.querySelector(`label[for="${area.id}"]`) : null;
    const wrapper = document.createElement('div');
    wrapper.className = 'rich-editor';
    const bar = document.createElement('div');
    bar.className = 'rich-editor__toolbar';
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Opmaak');
    const editor = document.createElement('div');
    editor.className = 'rich-editor__content';
    editor.contentEditable = 'true';
    editor.setAttribute('role', 'textbox');
    editor.setAttribute('aria-multiline', 'true');
    if (label) editor.setAttribute('aria-label', label.textContent.trim());
    ['aria-invalid', 'aria-describedby'].forEach((name) => {
      if (area.hasAttribute(name)) editor.setAttribute(name, area.getAttribute(name));
    });
    editor.replaceChildren(...nodesFromHtml(area.value));
    let sourceMode = false;

    // Heeft het tekstvak een maximum (`maxlength`), dan toont een teller de lengte van de HTML; de browser controleert
    // `maxlength` niet bij een waarde die het script zet. De server weigert een te lange tekst altijd zelf.
    const maxLength = area.maxLength > 0 ? area.maxLength : 0;
    const counter = document.createElement('span');
    counter.className = 'field__help rich-editor__count';
    counter.setAttribute('aria-live', 'polite');

    /** Werkt de teller bij en markeert een te lange tekst. */
    const updateCounter = () => {
      if (!maxLength) return;
      const over = area.value.length > maxLength;
      counter.textContent = `${area.value.length} van ${maxLength} tekens (met opmaak)${over ? ': te lang, maak de tekst korter' : ''}`;
      counter.classList.toggle('is-over', over);
    };

    /** Zet de opgeschoonde HTML uit de editor in het tekstvak (het formulierveld). */
    const sync = () => {
      if (!sourceMode) area.value = clean.cleanNodes(editor.childNodes);
      updateCounter();
    };

    /** Een lege editor krijgt een lege alinea, zodat de eerste tekst meteen in een `<p>` komt. */
    const ensureParagraph = () => {
      if (!editor.querySelector('p, h2, h3, h4, h5, ul, ol, blockquote, table, figure, img')) {
        const paragraph = document.createElement('p');
        paragraph.appendChild(document.createElement('br'));
        editor.replaceChildren(paragraph);
      }
    };

    /** Werkt de aan/uit-stand van de knoppen bij naar de plek van de cursor. */
    const updateStates = () => {
      const block = currentBlock(editor);
      Array.prototype.forEach.call(bar.querySelectorAll('button[data-tool]'), (button) => {
        const tool = TOOLS[Number(button.dataset.tool)];
        let pressed = null;
        if (tool.state) pressed = document.queryCommandState(tool.command);
        else if (tool.block) pressed = block === tool.block;
        if (pressed !== null) button.setAttribute('aria-pressed', pressed ? 'true' : 'false');
      });
    };

    /** Vraagt een adres en maakt van de selectie een link (of voegt het adres als link in). */
    const addLink = () => {
      const address = (window.prompt('Adres van de link (bijv. /contact/, https://…, mailto:…)', '/') || '').trim();
      if (!address) return;
      if (!clean.isSafeUrl(address)) {
        window.alert('Dit adres kan niet: gebruik een adres op deze site (/…), https://…, mailto: of tel:.');
        return;
      }
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed) document.execCommand('createLink', false, address);
      else document.execCommand('insertHTML', false, `<a href="${address.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')}">${clean.escapeText(address)}</a>`);
    };

    /**
     * Voert een knop uit.
     * @param {object} tool Knop uit `TOOLS`.
     */
    const run = (tool) => {
      editor.focus();
      document.execCommand('defaultParagraphSeparator', false, 'p');
      document.execCommand('styleWithCSS', false, false);
      if (tool.link) addLink();
      else if (tool.block && currentBlock(editor) === tool.block && tool.block !== 'p') document.execCommand('formatBlock', false, 'p');
      else document.execCommand(tool.command, false, tool.value ? `<${tool.value}>` : null);
      sync();
      updateStates();
    };

    TOOLS.forEach((tool, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn--small btn--outline';
      button.textContent = tool.label;
      button.title = tool.title;
      button.dataset.tool = String(index);
      if (tool.state || tool.block) button.setAttribute('aria-pressed', 'false');
      // Bij mousedown blijft de selectie in de editor staan.
      button.addEventListener('mousedown', (event) => event.preventDefault());
      button.addEventListener('click', () => run(tool));
      bar.appendChild(button);
    });

    const sourceButton = document.createElement('button');
    sourceButton.type = 'button';
    sourceButton.className = 'btn btn--small btn--outline rich-editor__source';
    sourceButton.textContent = 'HTML';
    sourceButton.title = 'De HTML-code zien en wijzigen';
    sourceButton.setAttribute('aria-pressed', 'false');
    sourceButton.addEventListener('click', () => {
      if (!sourceMode) sync();
      sourceMode = !sourceMode;
      if (!sourceMode) editor.replaceChildren(...nodesFromHtml(area.value));
      area.hidden = !sourceMode;
      editor.hidden = sourceMode;
      sourceButton.setAttribute('aria-pressed', sourceMode ? 'true' : 'false');
      Array.prototype.forEach.call(bar.querySelectorAll('button[data-tool]'), (button) => { button.disabled = sourceMode; });
      (sourceMode ? area : editor).focus();
    });
    bar.appendChild(sourceButton);

    editor.addEventListener('focus', () => {
      document.execCommand('defaultParagraphSeparator', false, 'p');
      document.execCommand('styleWithCSS', false, false);
      ensureParagraph();
    });
    editor.addEventListener('input', () => {
      if (!editor.textContent.trim() && !editor.querySelector('img')) ensureParagraph();
      sync();
    });
    editor.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        addLink();
        sync();
      }
    });
    editor.addEventListener('keyup', updateStates);
    editor.addEventListener('mouseup', updateStates);
    // Plakken: opmaak uit een tekstverwerker of website wordt eerst opgeschoond; platte tekst wordt alinea's.
    editor.addEventListener('paste', (event) => {
      const data = event.clipboardData;
      if (!data) return;
      event.preventDefault();
      const markup = data.getData('text/html');
      const pasted = markup
        ? clean.cleanNodes(new DOMParser().parseFromString(markup, 'text/html').body.childNodes)
        : clean.textToHtml(data.getData('text/plain'));
      if (pasted) document.execCommand('insertHTML', false, pasted);
      sync();
    });
    // Bestanden slepen kan niet (foto's gaan via de fotobibliotheek).
    editor.addEventListener('drop', (event) => {
      if (event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files.length) event.preventDefault();
    });
    if (label) {
      label.addEventListener('click', (event) => {
        if (sourceMode) return;
        event.preventDefault();
        editor.focus();
      });
    }
    if (area.form) area.form.addEventListener('submit', sync, true);

    area.hidden = true;
    area.parentNode.insertBefore(wrapper, area);
    wrapper.appendChild(bar);
    wrapper.appendChild(editor);
    wrapper.appendChild(area);
    if (maxLength) {
      area.addEventListener('input', updateCounter);
      wrapper.appendChild(counter);
      updateCounter();
    }
  });
});
