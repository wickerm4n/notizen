(function markdownModule(global) {
  "use strict";

  const App = global.NotizenApp || (global.NotizenApp = {});
  const ALLOWED_LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function sanitizeUrl(url) {
    const rawUrl = String(url || "").trim().replace(/[\u0000-\u001f\u007f]/g, "");
    if (!rawUrl) {
      return "#";
    }

    if (rawUrl.startsWith("#") || rawUrl.startsWith("./") || rawUrl.startsWith("../") || /^\/(?!\/)/.test(rawUrl)) {
      return rawUrl;
    }

    try {
      const parsed = new URL(rawUrl, global.location.href);
      return ALLOWED_LINK_PROTOCOLS.has(parsed.protocol) ? rawUrl : "#";
    } catch (error) {
      return "#";
    }
  }

  function renderInline(value) {
    let html = escapeHtml(value);

    html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
    html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/__([^_]+)__/g, "<strong>$1</strong>");
    html = html.replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
    html = html.replace(/_([^_\n]+)_/g, "<em>$1</em>");
    html = html.replace(/\[([^\]]+)]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, (match, label, url) => {
      const safeUrl = escapeHtml(sanitizeUrl(url));
      return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">${label}</a>`;
    });

    return html;
  }

  function renderMarkdown(markdown) {
    const lines = String(markdown || "").replace(/\r\n?/g, "\n").split("\n");
    const html = [];
    let listType = null;
    let paragraph = [];
    let inCode = false;
    let codeLines = [];

    function closeParagraph() {
      if (!paragraph.length) {
        return;
      }
      html.push(`<p>${renderInline(paragraph.join(" "))}</p>`);
      paragraph = [];
    }

    function closeList() {
      if (!listType) {
        return;
      }
      html.push(listType === "ol" ? "</ol>" : "</ul>");
      listType = null;
    }

    function openList(type) {
      closeParagraph();
      if (listType === type) {
        return;
      }
      closeList();
      if (type === "task") {
        html.push('<ul class="task-list">');
      } else {
        html.push(type === "ol" ? "<ol>" : "<ul>");
      }
      listType = type;
    }

    function closeCodeBlock() {
      html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
      codeLines = [];
      inCode = false;
    }

    lines.forEach((line) => {
      const codeFence = line.match(/^\s*```/);
      if (inCode) {
        if (codeFence) {
          closeCodeBlock();
        } else {
          codeLines.push(line);
        }
        return;
      }

      if (codeFence) {
        closeParagraph();
        closeList();
        inCode = true;
        codeLines = [];
        return;
      }

      if (/^\s*$/.test(line)) {
        closeParagraph();
        closeList();
        return;
      }

      const heading = line.match(/^(#{1,6})\s+(.+)$/);
      if (heading) {
        closeParagraph();
        closeList();
        const level = heading[1].length;
        html.push(`<h${level}>${renderInline(heading[2].trim())}</h${level}>`);
        return;
      }

      if (/^\s*---+\s*$/.test(line)) {
        closeParagraph();
        closeList();
        html.push("<hr>");
        return;
      }

      const quote = line.match(/^>\s?(.*)$/);
      if (quote) {
        closeParagraph();
        closeList();
        html.push(`<blockquote>${renderInline(quote[1])}</blockquote>`);
        return;
      }

      const taskItem = line.match(/^\s*[-*+]\s+\[([ xX])]\s+(.+)$/);
      if (taskItem) {
        openList("task");
        const checked = taskItem[1].toLowerCase() === "x" ? " checked" : "";
        html.push(`<li><label><input type="checkbox" disabled${checked}>${renderInline(taskItem[2])}</label></li>`);
        return;
      }

      const unordered = line.match(/^\s*[-*+]\s+(.+)$/);
      if (unordered) {
        openList("ul");
        html.push(`<li>${renderInline(unordered[1])}</li>`);
        return;
      }

      const ordered = line.match(/^\s*\d+\.\s+(.+)$/);
      if (ordered) {
        openList("ol");
        html.push(`<li>${renderInline(ordered[1])}</li>`);
        return;
      }

      closeList();
      paragraph.push(line.trim());
    });

    if (inCode) {
      closeCodeBlock();
    }
    closeParagraph();
    closeList();

    if (!html.length) {
      return '<p class="muted">Noch keine Vorschau.</p>';
    }
    return html.join("\n");
  }

  App.Markdown = {
    renderMarkdown,
    renderInline,
    escapeHtml
  };
})(window);
