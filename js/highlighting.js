(function highlightingModule(global) {
  "use strict";

  const App = global.NotizenApp || (global.NotizenApp = {});
  const HIGHLIGHT_MS = 9000;
  let clearTimer = 0;
  let activeTextarea = null;

  function byId(id) {
    return document.getElementById(id);
  }

  function clearPreviewMarks() {
    document.querySelectorAll("mark.reminder-preview-highlight").forEach((mark) => {
      const parent = mark.parentNode;
      if (!parent) {
        return;
      }
      while (mark.firstChild) {
        parent.insertBefore(mark.firstChild, mark);
      }
      mark.remove();
      parent.normalize();
    });
  }

  function clearHighlight() {
    global.clearTimeout(clearTimer);
    clearTimer = 0;
    clearPreviewMarks();
    if (activeTextarea && document.activeElement === activeTextarea) {
      activeTextarea.setSelectionRange(activeTextarea.selectionEnd, activeTextarea.selectionEnd);
    }
    activeTextarea = null;
  }

  function scrollTextareaToRange(textarea, content, start) {
    const before = content.slice(0, start);
    const lineIndex = before.split("\n").length - 1;
    const style = global.getComputedStyle(textarea);
    const lineHeight = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.75 || 24;
    textarea.scrollTop = Math.max(0, lineIndex * lineHeight - textarea.clientHeight * 0.35);
  }

  function highlightTextarea(range) {
    const textarea = byId("noteEditor");
    if (!textarea || typeof textarea.setSelectionRange !== "function") {
      return false;
    }
    const pane = textarea.closest(".editor-pane");
    if (pane && global.getComputedStyle(pane).display === "none") {
      return false;
    }

    const content = textarea.value || "";
    const start = Math.max(0, Math.min(range.start, content.length));
    const end = Math.max(start, Math.min(range.end, content.length));
    if (end <= start) {
      return false;
    }

    textarea.focus({ preventScroll: true });
    textarea.setSelectionRange(start, end);
    scrollTextareaToRange(textarea, content, start);
    activeTextarea = textarea;
    return true;
  }

  function plainSnippet(value) {
    return String(value || "")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/^>\s?/gm, "")
      .replace(/^[-*+]\s+\[[ xX]\]\s+/gm, "")
      .replace(/^[-*+]\s+/gm, "")
      .replace(/^\d+\.\s+/gm, "")
      .replace(/[*_~>#]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function wrapTextNode(node, start, end) {
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, end);
    const mark = document.createElement("mark");
    mark.className = "reminder-preview-highlight";
    range.surroundContents(mark);
    return mark;
  }

  function highlightPreviewText(snippet) {
    const preview = byId("markdownPreview");
    const text = String(snippet || "").trim();
    if (!preview || !text) {
      return false;
    }

    const candidates = [text, plainSnippet(text)].filter(Boolean);
    const walker = document.createTreeWalker(preview, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        return node.nodeValue && node.nodeValue.trim()
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT;
      }
    });

    const nodes = [];
    let node = walker.nextNode();
    while (node) {
      nodes.push(node);
      node = walker.nextNode();
    }

    for (const candidate of candidates) {
      for (const textNode of nodes) {
        const index = textNode.nodeValue.indexOf(candidate);
        if (index >= 0) {
          const mark = wrapTextNode(textNode, index, index + candidate.length);
          mark.scrollIntoView({ block: "center", behavior: "smooth" });
          return true;
        }
      }
    }

    return false;
  }

  function highlight(note, reminder) {
    clearHighlight();
    if (!note || !reminder || !reminder.anchor || !App.Reminders) {
      return { found: false, reason: "no-anchor" };
    }

    if (App.Editor && typeof App.Editor.syncPreview === "function") {
      App.Editor.syncPreview();
    }

    const resolved = App.Reminders.resolveAnchor(note.content || "", reminder.anchor);
    if (!resolved.found) {
      return resolved;
    }

    const editorHighlighted = highlightTextarea(resolved);
    const previewHighlighted = highlightPreviewText(resolved.text || reminder.anchor.text || "");
    clearTimer = global.setTimeout(clearHighlight, HIGHLIGHT_MS);

    return {
      ...resolved,
      editorHighlighted,
      previewHighlighted
    };
  }

  App.Highlighting = {
    highlight,
    clearHighlight
  };
})(window);
