import "@testing-library/jest-dom/vitest";

// jsdom ships no 2d canvas: asking for a context writes "Not implemented" to the
// console and returns nothing. A null context is exactly the branch the summary
// card already handles (text fallback), so stub it once here instead of letting
// every test that mounts a finished game print the same warning.
HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement["getContext"];
