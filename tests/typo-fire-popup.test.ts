import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const main = readFileSync(resolve(process.cwd(), "src/main.tsx"), "utf8");
const popup = readFileSync(
  resolve(process.cwd(), "src/typo-fire-popup/TypoFirePopup.tsx"),
  "utf8",
);
const css = readFileSync(
  resolve(process.cwd(), "src/typo-fire-popup/TypoFirePopup.css"),
  "utf8",
);

describe("Typo Fire global popup", () => {
  it("has a dedicated route outside settings", () => {
    expect(main).toContain("#/typo-fire-popup");
    expect(main).toContain("TypoFirePopup");
  });

  it("renders white suggestions received from the backend", () => {
    expect(popup).toContain("typo_fire_current_suggestions");
    expect(popup).toContain("typo-fire://suggestions");
    expect(popup).toContain("suggestions.map");
    expect(popup).toContain("typo_fire_apply_suggestion");
    expect(popup).toContain("deleteChars: suggestion.deleteChars");
    expect(popup).toContain("suggestion.favorite");
    expect(css).toContain("background: rgba(255, 255, 255, 0.96)");
    expect(css).toContain("color: rgba(18, 20, 24, 0.92)");
  });

  it("supports keyboard selection for ambiguous suggestions", () => {
    expect(popup).toContain("selectedIndex");
    expect(popup).toContain("onKeyDown");
    expect(popup).toContain("ArrowDown");
    expect(popup).toContain("ArrowUp");
    expect(popup).toContain("Enter");
    expect(popup).toContain("aria-selected");
    expect(css).toContain(".typo-fire-popup-item.selected");
  });

  it("keeps the global suggestion popup above the typing point", () => {
    const rust = readFileSync(resolve(process.cwd(), "src-tauri/src/typo_fire.rs"), "utf8");
    expect(rust).toContain("typo_fire_current_suggestions");
    expect(rust).toContain("typo_fire_apply_suggestion");
    expect(rust).toContain(".focusable(false)");
    expect(rust).toContain("set_focusable(false)");
    expect(rust).toContain("caret_position()");
    expect(rust).toContain("GetGUIThreadInfo");
    expect(rust).toContain("WH_MOUSE_LL");
    expect(rust).toContain("hide_popup_after_outside_click");
    expect(rust).toContain("hide_popup_after_delay");
    expect(rust).toContain("y - height as i32 - 12");
  });
});
