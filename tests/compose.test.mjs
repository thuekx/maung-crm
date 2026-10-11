// Aturan arsitektur jalur satu domain (docs/RENCANA-INTEGRASI-WO.md) dijaga otomatis pada docker-compose.yml.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const raw = readFileSync(fileURLToPath(new URL("../docker-compose.yml", import.meta.url)), "utf8");
const c = parse(raw);
const svc = c.services;
const nets = (s) => (Array.isArray(s.networks) ? s.networks : Object.keys(s.networks ?? { default: 1 }));

test("tidak ada port host pada service mana pun (Caddy WO yang membuka 80/443)", () => {
  for (const [name, s] of Object.entries(svc)) assert.equal(s.ports, undefined, `${name} tidak boleh punya ports:`);
});

test("jaringan maung_edge eksternal; hanya crm-web & crm-api yang bergabung", () => {
  assert.deepEqual(c.networks.edge, { name: "maung_edge", external: true });
  const onEdge = Object.keys(svc).filter((n) => nets(svc[n]).includes("edge")).sort();
  assert.deepEqual(onEdge, ["crm-api", "crm-web"]);
  for (const n of ["postgres", "garage"]) assert.ok(!nets(svc[n]).includes("edge"), `${n} harus privat`);
});

test("tidak menempel ke jaringan WO dan tidak ada proxy/Caddy milik CRM", () => {
  assert.ok(!/maung-wo-inv/.test(raw), "tidak boleh merujuk jaringan/proyek WO");
  assert.ok(!Object.keys(svc).some((n) => /caddy|proxy/i.test(n)) && !/image:\s*caddy/.test(raw));
});

test("IMAGE_TAG wajib (tanpa latest bawaan) pada kedua image CRM", () => {
  for (const n of ["crm-api", "crm-web"]) {
    assert.match(svc[n].image, /\$\{IMAGE_TAG:\?[^}]+\}$/, `${n}: IMAGE_TAG harus wajib`);
    assert.ok(!/:latest\b|IMAGE_TAG:-/.test(svc[n].image), `${n}: tidak boleh latest/default`);
  }
});

test("healthcheck API di /crm/api/health port 4000; API_BASE /crm/api", () => {
  const hc = svc["crm-api"].healthcheck.test.join(" ");
  assert.match(hc, /127\.0\.0\.1:4000\/crm\/api\/health/);
  assert.equal(svc["crm-api"].environment.API_BASE, "/crm/api");
  assert.equal(String(svc["crm-api"].environment.PORT), "4000");
});

test("crm-web menunggu crm-api sehat; postgres/garage tidak dipublikasikan", () => {
  assert.equal(svc["crm-web"].depends_on["crm-api"].condition, "service_healthy");
  assert.equal(svc["crm-api"].depends_on.postgres.condition, "service_healthy");
});
