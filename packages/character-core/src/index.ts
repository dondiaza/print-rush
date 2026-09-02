/**
 * CHARACTER CORE.
 *
 * The Character Studio's domain: what a character is, what a valid appearance is, when a change
 * deserves a version, and what a race is allowed to see. No database, no HTTP, no canvas — so every
 * rule in here is testable on its own, and the authoritative race server can share it with the web
 * app instead of reimplementing it.
 */
export * from "./types.js";
export * from "./presets.js";
export * from "./validate.js";
export * from "./version.js";
export * from "./runtime.js";
