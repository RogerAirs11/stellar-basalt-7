import { expect, it } from "vitest";
import { formatDirectoryLanguages } from "../../src/frontend-kit/domain/directoryDisplay";

it("formats stored language codes in the reader's locale", () => {
  expect(formatDirectoryLanguages('["en","fa"]', "en")).toBe("English · Persian");
  expect(formatDirectoryLanguages('["en","fa"]', "fa")).toBe("انگلیسی · فارسی");
});
it("preserves legacy free text and unfamiliar labels without inventing languages", () => {
  expect(formatDirectoryLanguages("English and فارسی", "en")).toBe("English and فارسی");
  expect(formatDirectoryLanguages('["en",', "en")).toBe('["en",');
  expect(formatDirectoryLanguages('["en",23]', "en")).toBe('["en",23]');
});
it("handles empty and already-decoded lists consistently", () => {
  expect(formatDirectoryLanguages(null, "en")).toBe("—");
  expect(formatDirectoryLanguages("[]", "fa")).toBe("—");
  expect(formatDirectoryLanguages([" en ", "", "en", "fa"], "en")).toBe("English · Persian");
});
