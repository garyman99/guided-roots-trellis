/**
 * Per-course Environment image wiring (plan L5, P2). A course declares a baked
 * image (request.environmentImage); materialize stamps it onto every generated
 * lab's manifest (stampLabImage); the docker runtime resolves it
 * (generatedLabImage) so the lab runs on the course's real toolchain instead of
 * the shared base image. The docker RUN itself is proven only against a built
 * image (ADR-0003 D26); these are the resolution + stamping units around it.
 */
process.env.NODE_ENV = "test";

import { test } from "node:test";
import assert from "node:assert/strict";
import { stampLabImage } from "../src/generatedLab.ts";
import { generatedLabImage } from "../src/sessions.ts";

test("generatedLabImage: the lab's own image wins, else env, else the shared base", () => {
  // A course lab that declares its baked Environment runs on it.
  assert.equal(generatedLabImage({ image: "trellis-lab-node-selenium" }, {} as NodeJS.ProcessEnv), "trellis-lab-node-selenium");
  // No per-lab image → the deployment override, if set.
  assert.equal(generatedLabImage({}, { TRELLIS_GENERATED_LAB_IMAGE: "custom-base" } as NodeJS.ProcessEnv), "custom-base");
  // Neither → the shared default.
  assert.equal(generatedLabImage(undefined, {} as NodeJS.ProcessEnv), "trellis-lab-base");
  // The lab's image beats the env default.
  assert.equal(
    generatedLabImage({ image: "trellis-lab-node-selenium" }, { TRELLIS_GENERATED_LAB_IMAGE: "custom-base" } as NodeJS.ProcessEnv),
    "trellis-lab-node-selenium",
  );
});

test("stampLabImage: injects image into lab.json, no-op without one", () => {
  const files = { "lab.json": JSON.stringify({ id: "s1", title: "S1" }), "template/x": "y" };
  const stamped = stampLabImage(files, "trellis-lab-node-selenium");
  assert.equal(JSON.parse(stamped["lab.json"]).image, "trellis-lab-node-selenium");
  assert.equal(stamped["template/x"], "y", "other files untouched");
  // No image → returns the files unchanged (no manifest churn).
  const same = stampLabImage(files, undefined);
  assert.equal(same, files);
  assert.ok(!("image" in JSON.parse(same["lab.json"])));
});
