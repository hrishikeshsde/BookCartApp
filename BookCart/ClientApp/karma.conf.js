// Karma configuration, see https://karma-runner.github.io/latest/config/configuration-file.html
module.exports = function (config) {
  config.set({
    basePath: "",
    frameworks: ["jasmine"],
    plugins: [
      require("karma-jasmine"),
      require("karma-chrome-launcher"),
      require("karma-jasmine-html-reporter"),
      require("karma-coverage"),
    ],
    client: {
      jasmine: { random: true },
      clearContext: false, // leave the Jasmine spec runner output visible in the browser
    },
    jasmineHtmlReporter: { suppressAll: true }, // removes the duplicated traces
    coverageReporter: {
      dir: require("path").join(__dirname, "./coverage/bookcart"),
      subdir: ".",
      reporters: [{ type: "html" }, { type: "text-summary" }],
    },
    reporters: ["progress", "kjhtml"],
    // Headless by default, so `npm test` runs anywhere Chrome is installed. The CI launcher is for containers, where
    // Chrome cannot use its own sandbox.
    browsers: ["ChromeHeadless"],
    customLaunchers: {
      ChromeHeadlessCI: { base: "ChromeHeadless", flags: ["--no-sandbox"] },
    },
    restartOnFileChange: true,
  });
};
