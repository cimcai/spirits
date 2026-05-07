import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./",
  testMatch: ["mastodon-interop.spec.ts"],
  timeout: 120_000, // generous: sidekiq must fetch the actor before we can assert
  use: {
    baseURL: "https://mastodon.test",
    ignoreHTTPSErrors: true, // self-signed local CA
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        browserName: "chromium",
        // Chromium needs to be told to ignore certificate errors for .test TLDs
        launchOptions: {
          args: ["--ignore-certificate-errors"],
        },
      },
    },
  ],
  // Store artifacts next to the spec file
  outputDir: "screenshots",
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
});
