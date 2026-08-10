import assert from "node:assert/strict";
import {
  shouldHandleComposerPointerDown,
  shouldSubmitComposerKeyDown,
  transitionComposerOverlays,
} from "../src/composer-interactions.js";

assert.equal(
  shouldSubmitComposerKeyDown({ key: "Enter", shiftKey: false }),
  true,
  "plain Enter submits the composer",
);
assert.equal(
  shouldSubmitComposerKeyDown({ key: "Enter", shiftKey: true }),
  false,
  "Shift+Enter inserts a line break",
);
assert.equal(
  shouldSubmitComposerKeyDown({
    key: "Enter",
    isComposing: true,
    nativeEvent: { isComposing: true },
  }),
  false,
  "Enter must not submit while an IME composition is active",
);
assert.equal(
  shouldSubmitComposerKeyDown({
    key: "Enter",
    nativeEvent: { isComposing: true },
  }),
  false,
  "the native IME state alone must also block submission",
);
assert.equal(
  shouldSubmitComposerKeyDown({
    key: "Enter",
    keyCode: 229,
    nativeEvent: { keyCode: 229 },
  }),
  false,
  "legacy Android IME Enter events must not submit",
);

assert.equal(
  shouldHandleComposerPointerDown({ pointerType: "touch", isPrimary: true, button: 0 }),
  true,
  "Android touch must act before keyboard focus can collapse the viewport",
);
assert.equal(
  shouldHandleComposerPointerDown({ pointerType: "pen", isPrimary: true, button: 0 }),
  true,
  "a primary pen tap follows the same direct composer action path",
);
assert.equal(
  shouldHandleComposerPointerDown({ pointerType: "mouse", isPrimary: true, button: 0 }),
  false,
  "mouse clicks must keep the normal click activation path",
);
assert.equal(
  shouldHandleComposerPointerDown({ pointerType: "touch", isPrimary: false, button: 0 }),
  false,
  "secondary touches must not dispatch composer actions",
);

assert.deepEqual(
  transitionComposerOverlays(
    { statusExpanded: true, composerMenuOpen: false },
    "open-composer-menu",
  ),
  { statusExpanded: false, composerMenuOpen: true },
);
assert.deepEqual(
  transitionComposerOverlays(
    { statusExpanded: false, composerMenuOpen: true },
    "open-status",
  ),
  { statusExpanded: true, composerMenuOpen: false },
);
assert.deepEqual(
  transitionComposerOverlays(
    { statusExpanded: true, composerMenuOpen: true },
    "focus-input",
  ),
  { statusExpanded: false, composerMenuOpen: false },
);

console.log("composer interaction tests passed");
