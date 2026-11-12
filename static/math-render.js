// Presentation only: consume text already authorized and inserted by each view.
(() => {
  "use strict";
  const ignored = ".katex, .katex-display, .katex-error, .math-literal, script, style, textarea, pre, code, option";
  const delimiters = [
    { left: "$$", right: "$$", display: true },
    { left: "$", right: "$", display: false },
    { left: "\\(", right: "\\)", display: false },
    { left: "\\[", right: "\\]", display: true },
  ];

  function textNodes(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: node => node.parentElement?.closest(ignored)
        ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    return nodes;
  }

  window.renderQuestionMath = root => {
    if (!root || root.matches?.(ignored) || typeof window.renderMathInElement !== "function") return;
    // Auto-render recognizes escaped closing delimiters, but not escaped opening
    // dollars. Mask escaped delimiters as text; restore them before TeX parsing
    // inside equations, and afterwards in ordinary text. No HTML is interpreted.
    const nodes = textNodes(root);
    let prefix = "\uE000DXMATH";
    while (nodes.some(node => node.data.includes(prefix))) prefix += "_";
    const escapes = [];
    const restore = text => text.replace(new RegExp(prefix + "(\\d+)\uE001", "g"), (_, index) => escapes[Number(index)]);
    for (const node of nodes) {
      node.data = node.data.replace(/\\+[$()[\]]/g, match => {
        const slashes = match.length - 1;
        const escaped = match.endsWith("$") ? slashes % 2 === 1 : slashes % 2 === 0;
        return escaped ? prefix + (escapes.push(match) - 1) + "\uE001" : match;
      });
    }
    try {
      window.renderMathInElement(root, {
        delimiters,
        trust: false,
        throwOnError: false,
        ignoredClasses: ["katex", "katex-display", "katex-error", "math-literal"],
        preProcess: restore,
      });
      root.classList.add("dx-math");
    } catch (error) {
      // A presentation failure must never interrupt controls or state updates.
      console.warn("Question math could not be rendered", error);
    } finally {
      if (escapes.length) {
        for (const node of textNodes(root)) node.data = restore(node.data);
      }
    }
  };
})();
