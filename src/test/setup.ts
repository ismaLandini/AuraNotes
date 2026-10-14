import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import { Blob as NodeBlob } from 'node:buffer';

// fake-indexeddb clones values with Node's structuredClone, which only preserves Node Blobs.
globalThis.Blob = NodeBlob as unknown as typeof Blob;

// jsdom lacks a few browser APIs used by the app.
class RO {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver ??= RO;
if (!window.matchMedia) {
  window.matchMedia = ((q: string) => ({
    matches: false,
    media: q,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}
if (!URL.createObjectURL) URL.createObjectURL = () => 'blob:mock';
if (!globalThis.structuredClone) globalThis.structuredClone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
