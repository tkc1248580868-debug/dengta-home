import assert from "node:assert/strict";
import {
  isPrivateMediaUrl,
  privateMediaRequestPath,
} from "../src/private-media.js";

const apiBaseUrl = "https://backend.example.test";

assert.equal(
  privateMediaRequestPath(
    "/api/v2/attachments/12/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    apiBaseUrl,
  ),
  "/api/v2/attachments/12/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
assert.equal(
  privateMediaRequestPath(
    "/attachments/12/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    apiBaseUrl,
  ),
  "/attachments/12/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
assert.equal(
  privateMediaRequestPath(
    "https://backend.example.test/api/v2/moments/id/images/0",
    apiBaseUrl,
  ),
  "/api/v2/moments/id/images/0",
);
assert.equal(
  privateMediaRequestPath(
    "/api/v2/creative/artworks/ca6cda36-8337-4982-969c-5139c20ffe3c/image",
    apiBaseUrl,
  ),
  "/api/v2/creative/artworks/ca6cda36-8337-4982-969c-5139c20ffe3c/image",
);
assert.equal(
  privateMediaRequestPath(
    "https://backend.example.test/api/v2/creative/artworks/ca6cda36-8337-4982-969c-5139c20ffe3c/image",
    apiBaseUrl,
  ),
  "/api/v2/creative/artworks/ca6cda36-8337-4982-969c-5139c20ffe3c/image",
);
assert.equal(
  privateMediaRequestPath(
    "https://attacker.example/api/v2/moments/id/images/0",
    apiBaseUrl,
  ),
  "",
);
assert.equal(
  privateMediaRequestPath("https://backend.example.test/health", apiBaseUrl),
  "",
);
assert.equal(
  isPrivateMediaUrl(
    "https://backend.example.test/api/v2/attachments/1/id",
    apiBaseUrl,
  ),
  true,
);
assert.equal(isPrivateMediaUrl("blob:test", apiBaseUrl), false);

console.log("private authenticated media URL tests passed");
