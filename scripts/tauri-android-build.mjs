#!/usr/bin/env node

import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const sdkRoot = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;

if (!sdkRoot) {
  console.error("ANDROID_HOME or ANDROID_SDK_ROOT must point to the Android SDK.");
  process.exit(1);
}

const ndkRoot =
  process.env.ANDROID_NDK_HOME ||
  process.env.NDK_HOME ||
  findLatestNdk(path.join(sdkRoot, "ndk"));

if (!ndkRoot) {
  console.error("Android NDK was not found. Install it with sdkmanager or set ANDROID_NDK_HOME.");
  process.exit(1);
}

const hostTag = getHostTag();
const toolchainBin = path.join(ndkRoot, "toolchains", "llvm", "prebuilt", hostTag, "bin");
const ranlib = path.join(toolchainBin, process.platform === "win32" ? "llvm-ranlib.exe" : "llvm-ranlib");

if (!existsSync(ranlib)) {
  console.error(`NDK llvm-ranlib was not found: ${ranlib}`);
  process.exit(1);
}

const passthroughArgs = process.argv.slice(2);
const localTauriBin = path.join(
  process.cwd(),
  "node_modules",
  ".bin",
  process.platform === "win32" ? "tauri.cmd" : "tauri",
);
const tauriBin = existsSync(localTauriBin) ? localTauriBin : "tauri";

const result = spawnSync(tauriBin, ["android", "build", "--apk", "--target", "aarch64", ...passthroughArgs], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: {
    ...process.env,
    ANDROID_HOME: sdkRoot,
    ANDROID_SDK_ROOT: sdkRoot,
    ANDROID_NDK_HOME: ndkRoot,
    NDK_HOME: ndkRoot,
    TARGET_RANLIB: ranlib,
    RANLIB: ranlib,
    RANLIB_aarch64_linux_android: ranlib,
  },
});

if (result.error) {
  console.error(result.error.message);
}

process.exit(result.status ?? 1);

function findLatestNdk(ndkDir) {
  if (!existsSync(ndkDir)) {
    return undefined;
  }

  const versions = readdirSync(ndkDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort(compareVersions);

  return versions.length > 0 ? path.join(ndkDir, versions.at(-1)) : undefined;
}

function compareVersions(left, right) {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  const length = Math.max(a.length, b.length);

  for (let index = 0; index < length; index += 1) {
    const diff = (a[index] || 0) - (b[index] || 0);
    if (diff !== 0) {
      return diff;
    }
  }

  return 0;
}

function getHostTag() {
  if (process.platform === "linux") {
    return "linux-x86_64";
  }

  if (process.platform === "darwin") {
    return "darwin-x86_64";
  }

  if (process.platform === "win32") {
    return "windows-x86_64";
  }

  console.error(`Unsupported host platform for Android NDK: ${process.platform}`);
  process.exit(1);
}
