// Vérifie que l'appli est installable et que le hors-ligne ne casse pas.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => readFileSync(join(root, f), "utf8");

test("chaque fichier mis en cache par sw.js existe", () => {
  const m = read("sw.js").match(/SHELL\s*=\s*\[([^\]]*)\]/);
  assert.ok(m, "liste SHELL introuvable dans sw.js");
  const files = [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]).filter((f) => f !== "./");
  for (const f of files) assert.ok(existsSync(join(root, f)), "fichier manquant : " + f);
});

test("chaque fichier local chargé par index.html existe et est mis en cache", () => {
  const html = read("index.html");
  const shell = read("sw.js");
  const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((x) => x[1]).filter((u) => !/^https?:|^#/.test(u));
  for (const f of refs) {
    assert.ok(existsSync(join(root, f)), "fichier manquant : " + f);
    assert.ok(shell.includes('"' + f + '"'), f + " absent de SHELL dans sw.js (pas dispo hors ligne)");
  }
});

test("le manifeste est valide et ses icônes existent", () => {
  const man = JSON.parse(read("manifest.webmanifest"));
  assert.ok(man.name && man.start_url, "name ou start_url manquant");
  for (const ic of man.icons) assert.ok(existsSync(join(root, ic.src)), "icône manquante : " + ic.src);
});

test("aucune clé API Anthropic ni secret Google dans le code", () => {
  for (const f of ["app.js", "index.html", "sw.js"]) {
    const s = read(f);
    assert.ok(!/sk-ant-[A-Za-z0-9_-]{10,}/.test(s), "clé Anthropic trouvée dans " + f);
    assert.ok(!/GOCSPX-[A-Za-z0-9_-]{10,}/.test(s), "secret client Google trouvé dans " + f);
  }
});
