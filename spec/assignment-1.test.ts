import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import {
  formatThickness,
  getPreset,
  INITIAL_THICKNESS_MM,
  minLengthForFolds,
  PAPER_PRESETS,
  physicalFoldLimit,
  thicknessAfterFolds,
} from "../fold";

// The published spec's one hard-testable line: "the visitor does something
// that changes what they see". The core action is a fold; one press must
// increase the fold count by exactly one and exactly double the thickness.

describe("fold mechanic: one press doubles the thickness", () => {
  it("starts at zero folds with the initial 0.1mm sheet", () => {
    expect(thicknessAfterFolds(0)).toBe(INITIAL_THICKNESS_MM);
  });

  it("exactly doubles on every single fold", () => {
    for (let n = 0; n < 20; n++) {
      expect(thicknessAfterFolds(n + 1)).toBe(thicknessAfterFolds(n) * 2);
    }
  });

  it("formats sub-centimetre thickness in millimetres", () => {
    expect(formatThickness(0.1)).toBe("0.100 mm");
  });

  it("switches display units as the thickness grows", () => {
    expect(formatThickness(thicknessAfterFolds(7))).toBe("1.28 cm");
    expect(formatThickness(thicknessAfterFolds(20))).toBe("104.86 m");
  });
});

describe("paper presets: four meaningful choices, no free-text size", () => {
  it("offers exactly four presets", () => {
    expect(PAPER_PRESETS.length).toBe(4);
  });

  it("looks up a preset by id, falling back to the first for an unknown id", () => {
    expect(getPreset("a4").id).toBe("a4");
    expect(getPreset("does-not-exist").id).toBe(PAPER_PRESETS[0].id);
  });
});

describe("physical-limit fork: sourced from Gallivan's folding equation", () => {
  it("needs zero length for zero folds", () => {
    expect(minLengthForFolds(0.1, 0)).toBe(0);
  });

  it("needs a strictly longer strip for each additional fold", () => {
    for (let n = 0; n < 10; n++) {
      expect(minLengthForFolds(0.1, n + 1)).toBeGreaterThan(minLengthForFolds(0.1, n));
    }
  });

  it("gives every preset a finite, positive fold limit within its own sheet length", () => {
    for (const preset of PAPER_PRESETS) {
      const limit = physicalFoldLimit(preset);
      expect(limit).toBeGreaterThan(0);
      expect(minLengthForFolds(preset.thicknessMm, limit)).toBeLessThanOrEqual(
        preset.sheetLengthMm,
      );
      expect(minLengthForFolds(preset.thicknessMm, limit + 1)).toBeGreaterThan(
        preset.sheetLengthMm,
      );
    }
  });
});

describe("fold mechanic: the built page exposes one clear action", () => {
  const doc = new JSDOM(readFileSync(resolve("dist/index.html"), "utf8")).window.document;

  it("has exactly one fold button, a real <button> so it stays keyboard-operable", () => {
    const buttons = doc.querySelectorAll("#fold-button");
    expect(buttons.length).toBe(1);
    const [button] = buttons;
    expect(button.tagName).toBe("BUTTON");
    expect(button.getAttribute("tabindex")).not.toBe("-1");
    expect(button.hasAttribute("disabled")).toBe(false);
  });

  it("shows a fold count and thickness reading that starts at zero folds", () => {
    expect(doc.querySelector("#fold-count")?.textContent?.trim()).toBe("0");
    expect(doc.querySelector("#thickness")?.textContent?.trim()).toBe("0.100 mm");
  });
});

describe("opening step: a preset picker, not a numeric input", () => {
  const doc = new JSDOM(readFileSync(resolve("dist/index.html"), "utf8")).window.document;

  it("has a dialog with exactly four real, enabled preset buttons", () => {
    const dialog = doc.querySelector("#paper-picker");
    expect(dialog?.tagName).toBe("DIALOG");

    const presetButtons = doc.querySelectorAll("#paper-picker button[data-preset]");
    expect(presetButtons.length).toBe(4);
    presetButtons.forEach((button) => {
      expect(button.tagName).toBe("BUTTON");
      expect(button.hasAttribute("disabled")).toBe(false);
    });
  });

  it("offers no free-text or numeric size input", () => {
    expect(doc.querySelectorAll("#paper-picker input").length).toBe(0);
  });
});

describe("physical-limit fork: stop-and-stay-real vs. keep-going-anyway", () => {
  const doc = new JSDOM(readFileSync(resolve("dist/index.html"), "utf8")).window.document;

  it("is present in the markup but hidden until the limit is reached", () => {
    const prompt = doc.querySelector("#limit-prompt");
    expect(prompt?.hasAttribute("hidden")).toBe(true);
  });

  it("offers exactly two real, enabled choices", () => {
    const stopButton = doc.querySelector("#stop-real");
    const keepGoingButton = doc.querySelector("#keep-going");
    expect(stopButton?.tagName).toBe("BUTTON");
    expect(keepGoingButton?.tagName).toBe("BUTTON");
    expect(stopButton?.hasAttribute("disabled")).toBe(false);
    expect(keepGoingButton?.hasAttribute("disabled")).toBe(false);
  });
});

describe("no dead end: stopping at the limit still offers a way back", () => {
  const doc = new JSDOM(readFileSync(resolve("dist/index.html"), "utf8")).window.document;

  it("has a stopped-panel, hidden by default, with two real enabled restart choices", () => {
    const panel = doc.querySelector("#stopped-panel");
    expect(panel?.hasAttribute("hidden")).toBe(true);

    const foldFresh = doc.querySelector("#fold-fresh");
    const chooseDifferent = doc.querySelector("#choose-different");
    expect(foldFresh?.tagName).toBe("BUTTON");
    expect(chooseDifferent?.tagName).toBe("BUTTON");
    expect(foldFresh?.hasAttribute("disabled")).toBe(false);
    expect(chooseDifferent?.hasAttribute("disabled")).toBe(false);
  });

  it("offers an always-available change-sheet control outside the stop fork", () => {
    const changeSheet = doc.querySelector("#change-sheet");
    expect(changeSheet?.tagName).toBe("BUTTON");
    expect(changeSheet?.hasAttribute("disabled")).toBe(false);
  });
});

describe("one continuous world, not a row of separate widgets", () => {
  const doc = new JSDOM(readFileSync(resolve("dist/index.html"), "utf8")).window.document;

  it("renders the paper inside one shared world SVG, alongside the comparison scene", () => {
    const world = doc.querySelector("#world-svg");
    expect(world?.tagName).toBe("svg");

    const camera = world?.querySelector("#camera");
    expect(camera).toBeTruthy();
    expect(camera?.querySelector("#paper-flat")).toBeTruthy();
    expect(camera?.querySelector("#paper-stack")).toBeTruthy();

    const sceneStage = doc.querySelector(".world > .scene-stage");
    expect(sceneStage).toBeTruthy();
  });

  it("shows exactly thirteen fixed comparison scenes, crossfaded and never independently repositioned", () => {
    const sceneImages = doc.querySelectorAll(".scene-stage .scene-img");
    expect(sceneImages.length).toBe(13);
    sceneImages.forEach((img) => {
      expect(img.getAttribute("data-scene")).toMatch(/^scene([1-9]|1[0-3])$/);
      expect(img.getAttribute("src")).toMatch(/\.(png|avif|webp|jpg)$/);
    });
  });

  it("has an annotation bubble ready to point at the active comparison object", () => {
    const bubble = doc.querySelector("#comparison-bubble");
    expect(bubble?.tagName).toBe("P");
    expect(bubble?.classList.contains("speech-bubble")).toBe(true);
  });
});
