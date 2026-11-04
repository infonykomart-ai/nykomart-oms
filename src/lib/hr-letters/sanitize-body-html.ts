// 2026-11-04 (security audit) — HR letter bodies are rich-text HTML from the
// contentEditable editor (components/hr-letters/rich-text-editor.tsx) and are
// rendered with dangerouslySetInnerHTML on the issued-letter page and in the
// live preview. A paste from any web page can carry <img onerror=...>,
// <script>, javascript: links or CSS that escapes the letter layout, so the
// stored string is untrusted input, not markup we authored.
//
// Sanitising happens on the SERVER, in both directions:
//   - on write (issueHrLetter / updateIssuedHrLetter), so new rows are clean;
//   - on read (the issued-letter page), so rows stored before this fix can
//     never render active content either.
// The allowlist is the tag/attribute set the editor itself produces plus the
// small set templates.ts generates (div/br/ol/ul/li/b/strong/u), so existing
// formatting survives unchanged.
import sanitizeHtml from "sanitize-html";

/** Inline CSS the toolbar and pasted Word documents actually use. */
const ALLOWED_STYLES: sanitizeHtml.IOptions["allowedStyles"] = {
  "*": {
    "font-family": [/^[\w\s,'"-]+$/],
    "font-size": [/^\d+(\.\d+)?(px|pt|em|rem|%)$/],
    color: [/^#[0-9a-f]{3,8}$/i, /^rgba?\([\d\s.,%]+\)$/i, /^[a-z]+$/i],
    "background-color": [/^#[0-9a-f]{3,8}$/i, /^rgba?\([\d\s.,%]+\)$/i, /^[a-z]+$/i],
    "text-align": [/^(left|right|center|justify)$/],
    "text-decoration": [/^[a-z\s-]+$/],
    "font-weight": [/^(normal|bold|bolder|lighter|[1-9]00)$/],
    "font-style": [/^(normal|italic|oblique)$/],
    "margin-left": [/^\d+(\.\d+)?(px|pt|em|rem|%)$/],
    "padding-left": [/^\d+(\.\d+)?(px|pt|em|rem|%)$/],
    "line-height": [/^\d+(\.\d+)?(px|pt|em|rem|%)?$/],
    "white-space": [/^(normal|pre|pre-wrap|pre-line)$/],
  },
};

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "div",
    "p",
    "br",
    "span",
    "b",
    "strong",
    "i",
    "em",
    "u",
    "s",
    "strike",
    "del",
    "ins",
    "sub",
    "sup",
    "ul",
    "ol",
    "li",
    "blockquote",
    "h1",
    "h2",
    "h3",
    "h4",
    "font",
    "a",
    "hr",
  ],
  allowedAttributes: {
    a: ["href", "title", "target", "rel"],
    font: ["face", "color", "size"],
    "*": ["style", "align"],
  },
  allowedStyles: ALLOWED_STYLES,
  // No data:, no vbscript:, no protocol-relative "//evil.example" links.
  allowedSchemes: ["http", "https", "mailto", "tel"],
  allowProtocolRelative: false,
  disallowedTagsMode: "discard",
  // Drop the contents of these entirely (discard alone would keep the CSS or
  // script text as visible letter body), and never allow images/embeds — the
  // letter layout has no place for them and <img src> is the classic XSS
  // vector.
  nonTextTags: ["style", "script", "textarea", "option", "noscript", "iframe", "object", "embed", "svg", "math"],
  transformTags: {
    a: (tagName, attribs) => ({
      tagName,
      attribs: { ...attribs, rel: "noopener noreferrer nofollow", target: "_blank" },
    }),
  },
};

/**
 * Returns letter-body HTML that is safe to hand to dangerouslySetInnerHTML:
 * unknown tags dropped, event handlers/scripts/styles/images removed, links
 * limited to http/https/mailto/tel, inline CSS limited to the editor's own
 * properties. Empty or whitespace-only input returns "".
 */
export function sanitizeLetterBody(html: string): string {
  if (!html || !html.trim()) return "";
  return sanitizeHtml(html, OPTIONS).trim();
}
