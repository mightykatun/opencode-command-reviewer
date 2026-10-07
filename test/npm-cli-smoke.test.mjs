import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createRequire } from "node:module"
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { gunzipSync } from "node:zlib"
import { archiveIntegrity } from "../scripts/npm-publication.mjs"
import { inspectPackageArchive, packageFiles } from "../scripts/release-artifact.mjs"
import { npmReleaseVersion } from "../scripts/release-version.mjs"
import { archiveFixture, fixturePackage, highBitNumericArchiveFixture } from "./release-fixture.mjs"

const globalRoot = execFileSync("npm", ["root", "--global"], { encoding: "utf8" }).trim()
const npmRoot = path.join(globalRoot, "npm")
assert.equal(JSON.parse(await readFile(path.join(npmRoot, "package.json"), "utf8")).version, "12.2.0", "This separate smoke test requires installed npm 12.2.0")
const npmRequire = createRequire(path.join(npmRoot, "package.json"))

test("release identities match npm 12's actual semver cleaning and bounds", () => {
  const semver = npmRequire("semver")
  for (const version of ["0.4.0", "1.0.0-rc.1", "9007199254740991.0.0", "1.0.0-beta.9007199254740993"]) {
    assert.equal(npmReleaseVersion(version), semver.clean(version))
  }
  for (const version of ["0.4.0+build", "0.5.0-beta.1+build", "v0.4.0", "=0.4.0", " 0.4.0 "]) {
    assert.notEqual(semver.clean(version), version)
    assert.throws(() => npmReleaseVersion(version))
  }
  for (const version of ["9007199254740992.0.0", `1.0.0-${"a".repeat(251)}`]) {
    assert.equal(semver.clean(version), null)
    assert.throws(() => npmReleaseVersion(version), /SemVer bounds/)
  }
})

test("npm 12's bundled publication builder demonstrates manifest tag override and version normalization without network", () => {
  // Run the unmodified npm library in a child; replace only its HTTP boundary.
  // This builds payloads in memory, never publishes and never attempts OIDC/provenance.
  const program = `
    import assert from "node:assert/strict";
    import { createRequire } from "node:module";
    const publishPath = ${JSON.stringify(path.join(npmRoot, "node_modules/libnpmpublish/lib/publish.js"))};
    const require = createRequire(publishPath);
    const fetchPath = require.resolve("npm-registry-fetch");
    const payloads = [];
    const fakeFetch = async (url, options) => {
      assert.equal(options.method, "PUT");
      payloads.push({ tags: options.body["dist-tags"], versions: Object.keys(options.body.versions) });
      return {};
    };
    fakeFetch.pickRegistry = () => "https://registry.npmjs.org/";
    require.cache[fetchPath] = { id: fetchPath, filename: fetchPath, loaded: true, exports: fakeFetch };
    const publish = require(publishPath);
    for (const manifest of ${JSON.stringify([fixturePackage(), { ...fixturePackage(), tag: "latest" }, fixturePackage("0.4.0+build")])}) {
      await publish(manifest, Buffer.from("in-memory transport fixture"), { defaultTag: "archive", access: "public", provenance: false });
    }
    console.log(JSON.stringify(payloads));
  `
  const output = execFileSync(process.execPath, ["--input-type=module", "-e", program], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  assert.deepEqual(JSON.parse(output), [
    { tags: { archive: "0.4.0" }, versions: ["0.4.0"] },
    { tags: { latest: "0.4.0" }, versions: ["0.4.0"] },
    { tags: { archive: "0.4.0" }, versions: ["0.4.0"] },
  ])
})

test("validated tar prefixes agree with npm 12's actual parser and invalid markers are rejected", () => {
  const { Header } = npmRequire("tar")
  const entries = [...inspectPackageArchive(archiveFixture()).files].map(([name, content]) => ({ name, content }))
  const valid = archiveFixture({ entries, alterHeader(header) { header.write("package", 345) } })
  assert.equal(new Header(gunzipSync(valid)).path, "package/LICENSE")
  assert.deepEqual([...inspectPackageArchive(valid).files.keys()].sort(), packageFiles)
  const disagreement = archiveFixture({ entries, alterHeader(header) { header.write("package", 345); header.fill(0, 257, 265) } })
  assert.equal(new Header(gunzipSync(disagreement)).path, "LICENSE", "npm ignores the prefix when the USTAR marker is absent")
  assert.throws(() => inspectPackageArchive(disagreement), /USTAR/)
})

test("npm 12's actual Header size disagrees with masked ASCII digits and validation rejects the checksummed archive", () => {
  const { Header } = npmRequire("tar")
  const valid = archiveFixture()
  assert.equal(new Header(gunzipSync(valid)).size, 16)
  assert.equal(inspectPackageArchive(valid).files.get("LICENSE").length, 16)
  const bytes = highBitNumericArchiveFixture("size"), header = gunzipSync(bytes).subarray(0, 512)
  assert.equal(Number.parseInt(header.subarray(124, 136).toString("ascii"), 8), 16, "former decoding silently cleared the high bit")
  const parsed = new Header(header)
  assert.equal(parsed.cksumValid, true, "this is a correctly checksummed parser disagreement")
  assert.equal(parsed.path, "package/LICENSE")
  assert.equal(parsed.size, 2, "npm's UTF-8 numeric parser stops at the corrupted digit")
  assert.throws(() => inspectPackageArchive(bytes), /Unsupported tar numeric field encoding/)
})

test("actual npm publish dry-run unpacks only validated files inside a private cache and executes no package code", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "npm-cli-dry-run-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  const home = path.join(root, "home"), cwd = path.join(root, "cwd")
  await mkdir(home)
  await mkdir(cwd)
  const cache = await mkdtemp(path.join(root, "npm-release-cache."))
  await chmod(cache, 0o700)
  const marker = path.join(root, "package-code-ran")
  const hook = `${JSON.stringify(process.execPath)} -e ${JSON.stringify(`require("node:fs").writeFileSync(${JSON.stringify(marker)}, "unexpected")`)}`
  const pkg = { ...fixturePackage(), scripts: Object.fromEntries(["prepack", "prepare", "prepublishOnly", "publish", "postpublish", "install", "postinstall"].map((name) => [name, hook])) }
  const entries = [...inspectPackageArchive(archiveFixture({ pkg })).files].map(([name, content]) => ({ name: `package/${name}`,
    content: name === "dist/tui.js" ? "throw new Error('PACKAGE_ENTRYPOINT_MUST_NOT_EXECUTE')\n" : content }))
  const bytes = archiveFixture({ entries })
  const files = inspectPackageArchive(bytes).files
  const tarball = path.join(root, "opencode-reviewer-0.4.0.tgz")
  await writeFile(tarball, bytes)
  const observer = path.join(root, "observe-extraction.cjs"), observations = path.join(root, "extractions.jsonl")
  await writeFile(observer, `
    const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
    require(${JSON.stringify(path.join(npmRoot, "node_modules/pacote"))});
    const FileFetcher = require(${JSON.stringify(path.join(npmRoot, "node_modules/pacote/lib/file.js"))});
    const extract = FileFetcher.prototype.extract;
    function walk(dir, prefix = "") {
      return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const relative = prefix + entry.name, file = path.join(dir, entry.name);
        if (entry.isDirectory()) return walk(file, relative + "/");
        if (!entry.isFile()) throw new Error("unexpected nonregular extraction member");
        return [{ file: relative, digest: crypto.createHash("sha512").update(fs.readFileSync(file)).digest("base64") }];
      });
    }
    FileFetcher.prototype.extract = async function (...args) {
      const result = await extract.apply(this, args);
      fs.appendFileSync(${JSON.stringify(observations)}, JSON.stringify({ directory: args[0], files: walk(args[0]) }) + "\\n");
      return result;
    };
  `)
  const userconfig = path.join(root, "user.npmrc"), globalconfig = path.join(root, "global.npmrc")
  await writeFile(userconfig, "")
  await writeFile(globalconfig, "")
  const env = { PATH: process.env.PATH, HOME: home, LANG: "C.UTF-8", NPM_CONFIG_CACHE: cache,
    NPM_CONFIG_USERCONFIG: userconfig, NPM_CONFIG_GLOBALCONFIG: globalconfig }
  const output = execFileSync(process.execPath, ["--require", observer, path.join(npmRoot, "bin/npm-cli.js"), "publish", tarball,
    "--dry-run", "--json", "--offline", "--ignore-scripts", "--provenance", "--access", "public", "--tag", "archive",
    "--registry", "https://registry.npmjs.org/", "--fetch-retries=0"], { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  const report = JSON.parse(output)
  const contents = Array.isArray(report) ? report[0] : report["opencode-reviewer"]
  assert.equal(contents.version, "0.4.0")
  assert.equal(contents.integrity, archiveIntegrity(bytes), "dry-run uses the original validated archive bytes")
  assert.deepEqual(contents.files.map((file) => file.path).sort(), packageFiles)
  const records = (await readFile(observations, "utf8")).trim().split("\n").map((line) => JSON.parse(line))
  assert.ok(records.length >= 2, "CLI reads both initial and authoritative manifests through actual file extraction")
  for (const record of records) {
    assert.ok(record.directory.startsWith(`${cache}${path.sep}`))
    assert.ok(record.directory.includes(`${path.sep}tmp${path.sep}`))
    assert.deepEqual(record.files.map((file) => file.file).sort(), packageFiles)
    for (const file of record.files) assert.equal(file.digest, archiveIntegrity(files.get(file.file)).slice("sha512-".length))
  }
  assert.equal((await lstat(cache)).mode & 0o777, 0o700)
  await assert.rejects(lstat(marker), { code: "ENOENT" })
  assert.deepEqual(await readdir(home), [], "npm must not use a HOME-owned shared cache")
  assert.deepEqual(await readdir(cwd), [], "package extraction must not populate the working directory")
  assert.ok((await readFile(tarball)).equals(bytes), "CLI dry-run must leave the artifact unchanged")
})
