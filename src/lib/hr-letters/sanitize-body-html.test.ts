import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeLetterBody } from "./sanitize-body-html";

test("keeps the editor's own formatting", () => {
  const html =
    '<div><b>Bold</b> <u>under</u> <i>ital</i><br></div>' +
    '<div style="text-align: center; font-family: Georgia;">Centered</div>' +
    "<ul><li>one</li></ul><ol><li>two</li></ol>";
  const out = sanitizeLetterBody(html);
  assert.match(out, /<b>Bold<\/b>/);
  assert.match(out, /<u>under<\/u>/);
  assert.match(out, /<ul><li>one<\/li><\/ul>/);
  assert.match(out, /text-align:\s*center/);
  assert.match(out, /font-family:\s*Georgia/);
});

test("drops script tags and their contents", () => {
  const out = sanitizeLetterBody('<div>ok</div><script>alert("x")</script>');
  assert.equal(out.includes("script"), false);
  assert.equal(out.includes("alert"), false);
  assert.match(out, /ok/);
});

test("drops event-handler attributes and unknown tags", () => {
  const out = sanitizeLetterBody('<div onclick="steal()">hi</div><iframe src="//evil"></iframe><custom-el>x</custom-el>');
  assert.equal(out.includes("onclick"), false);
  assert.equal(out.includes("<iframe"), false);
  assert.equal(out.includes("custom-el"), false);
  assert.match(out, /hi/);
});

test("blocks img payloads and javascript: links", () => {
  const out = sanitizeLetterBody('<img src=x onerror="alert(1)"><a href="javascript:alert(1)">click</a>');
  assert.equal(out.includes("<img"), false);
  assert.equal(out.includes("onerror"), false);
  assert.equal(/javascript:/i.test(out), false);
  assert.match(out, /click/);
});

test("hardens allowed links", () => {
  const out = sanitizeLetterBody('<a href="https://example.com">site</a>');
  assert.match(out, /href="https:\/\/example\.com"/);
  assert.match(out, /rel="noopener noreferrer nofollow"/);
});

test("strips style properties outside the allowlist", () => {
  const out = sanitizeLetterBody('<div style="position: fixed; top: 0; color: red;">x</div>');
  assert.equal(out.includes("position"), false);
  assert.equal(out.includes("top:"), false);
  assert.match(out, /color:\s*red/);
});

test("empty input stays empty", () => {
  assert.equal(sanitizeLetterBody(""), "");
  assert.equal(sanitizeLetterBody("   \n "), "");
});
