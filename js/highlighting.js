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

  function highlightTextareaRanges(ranges) {
    const textarea = byId("noteEditor");
    if (!textarea || typeof textarea.setSelectionRange !== "function") {
      return false;
    }
    const pane = textarea.closest(".editor-pane");
    if (pane && global.getComputedStyle(pane).display === "none") {
      return false;
    }

    const content = textarea.value || "";
    const cleanRanges = (Array.isArray(ranges) ? ranges : [])
      .map((range) => ({
        start: Math.max(0, Math.min(Number(range.start) || 0, content.length)),
        end: Math.max(0, Math.min(Number(range.end) || 0, content.length))
      }))
      .filter((range) => range.end > range.start)
      .sort((a, b) => a.start - b.start);

    if (!cleanRanges.length) {
      return false;
    }

    const first = cleanRanges[0];
    const last = cleanRanges[cleanRanges.length - 1];
    textarea.focus({ preventScroll: true });
    textarea.setSelectionRange(first.start, Math.max(first.end, last.end));
    scrollTextareaToRange(textarea, content, first.start);
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

  function textNodeIsMarked(node) {
    return node.parentElement && node.parentElement.closest("mark.reminder-preview-highlight");
  }

  function collectPreviewTextNodes(preview) {
    const walker = document.createTreeWalker(preview, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        return node.nodeValue && node.nodeValue.trim() && !textNodeIsMarked(node)
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
    return nodes;
  }

  function highlightPreviewSnippet(snippet, shouldScroll) {
    const preview = byId("markdownPreview");
    const text = String(snippet || "").trim();
    if (!preview || !text) {
      return false;
    }

    const candidates = [text, plainSnippet(text)]
      .map((candidate) => candidate.trim())
      .filter(Boolean);

    for (const candidate of candidates) {
      const nodes = collectPreviewTextNodes(preview);
      for (const textNode of nodes) {
        const index = textNode.nodeValue.indexOf(candidate);
        if (index >= 0) {
          const mark = wrapTextNode(textNode, index, index + candidate.length);
          if (shouldScroll) {
            mark.scrollIntoView({ block: "center", behavior: "smooth" });
          }
          return true;
        }
      }
    }

    return false;
  }

  function highlightPreviewSnippets(snippets) {
    let highlighted = false;
    let scrolled = false;
    (Array.isArray(snippets) ? snippets : []).forEach((snippet) => {
      const didHighlight = highlightPreviewSnippet(snippet, !scrolled);
      highlighted = highlighted || didHighlight;
      scrolled = scrolled || didHighlight;
    });
    return highlighted;
  }

  function rangeSnippet(note, range) {
    if (range && range.text) {
      return range.text;
    }
    const content = String(note && note.content || "");
    const start = Math.max(0, Math.min(Number(range && range.start) || 0, content.length));
    const end = Math.max(start, Math.min(Number(range && range.end) || 0, content.length));
    return content.slice(start, end);
  }

  function highlight(note, reminder) {
    clearHighlight();
    if (!note || !reminder || !App.Reminders) {
      return { found: false, reason: "no-reminder" };
    }

    if (App.Editor && typeof App.Editor.syncPreview === "function") {
      App.Editor.syncPreview();
    }

    const resolved = App.Reminders.resolveReminderSelection(note, reminder);
    if (!resolved.hasSelection) {
      return { ...resolved, found: false, reason: "no-selection" };
    }
    if (!resolved.found) {
      return resolved;
    }

    const ranges = Array.isArray(resolved.ranges) ? resolved.ranges : [];
    const snippets = ranges.map((range) => rangeSnippet(note, range)).filter((snippet) => String(snippet || "").trim());
    const editorHighlighted = highlightTextareaRanges(ranges);
    const previewHighlighted = highlightPreviewSnippets(snippets);
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
