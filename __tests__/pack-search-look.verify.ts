/**
 * "How it searches" says where each character's look comes from.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/pack-search-look.verify.ts
 */
import assert from "node:assert/strict"
import { lookDescription } from "../components/prompt-gallery/pack/search-text"

assert.equal(lookDescription("Tifa Lockhart"), "Tifa Lockhart's look: from their own pictures")
assert.equal(lookDescription("Yuffie Kisaragi"), "Yuffie Kisaragi's look: from their own pictures")

console.log("pack-search-look: ok")
